/**
 * Cloud Functions — Peer Support Workforce Network platform.
 *
 * Consent machinery, export, deletion, aggregation — plus the Role
 * Kernel policy gateway (see gateway.ts / kernel.ts).
 *
 * Design rules (Phase 0 contract, frozen 2026-10-13):
 *  - The worker controls their own record. No function reads worker data
 *    except to serve that worker, or to write de-identified aggregates.
 *  - grantAccess is the ONLY path that adds a UID to a document's
 *    sharedWith array. It verifies a live consent grant first.
 *  - Consequential commands validate the caller's live role grant
 *    (server lookup — never trust claims alone), run the six-part
 *    authorization decision, and write business data + its access event
 *    atomically. "Best-effort" logging is not sufficient.
 *  - Clients NEVER write access events or audit entries. All audit
 *    records are server-authored here (Admin SDK bypasses rules).
 *  - Data region: northamerica-northeast1 (Montréal). The region pin
 *    below applies to every function in this file.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ region: 'northamerica-northeast1' });

initializeApp();
const db = getFirestore();
const storage = getStorage();

import {
  authorizeCommand,
  buildAccessEvent,
  deriveConsentScope,
  isValidIdempotencyKey,
} from './kernel';
import {
  callerFrom,
  resolveCommandContext,
  writeAccessEventInTx,
} from './gateway';

// Re-export the policy gateway callables (Role Kernel surface).
export {
  authorizeCommandFn as authorizeCommand,
  getMyGrantsFn as getMyGrants,
  requestRoleGrantFn as requestRoleGrant,
  createRoleGrantFn as createRoleGrant,
  resolveRoleGrantFn as resolveRoleGrant,
  revokeRoleGrantFn as revokeRoleGrant,
  declareConflictFn as declareConflict,
  createHandoffFn as createHandoff,
  respondHandoffFn as respondHandoff,
} from './gateway';

// Collections whose documents are owned by a worker (ownerId) and
// therefore included in an export / deleted on a deletion request.
const WORKER_OWNED = [
  'workers',
  'firstContactForms',
  'pathwaySteps',
  'certificationNavigation',
  'evaluationSubmissions',
  'opportunityApplications',
];

// Minimum cell size for published aggregates (k-anonymity).
const MIN_CELL = 5;

const ACCESS_EVENTS = 'accessEvents';
const IDEMPOTENCY = 'idempotencyKeys';

interface ConsentGrant {
  granterId: string;
  granteeId: string;
  tenantId: string;
  scope: string;
  resourceType: string;
  resourceId: string;
  grantedAt: Timestamp;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
  purpose: string;
}

interface ActingInput {
  actingGrantId?: string | null;
  actingRole?: string | null;
  purpose?: string;
  idempotencyKey?: string;
}

function correlationId(provided: string | undefined, fallback: string): string {
  return provided && isValidIdempotencyKey(provided) ? provided : fallback;
}

/**
 * Idempotency guard for pure-Firestore commands (grantAccess, deletion).
 * Runs inside the caller's transaction: if the key was already completed,
 * returns the stored result without re-applying. Otherwise marks the key
 * completed in the SAME transaction as the business write + audit event.
 */
async function checkIdempotencyInTx(
  tx: FirebaseFirestore.Transaction,
  key: string,
  command: string,
): Promise<{ seen: boolean; result: unknown }> {
  const ref = db.collection(IDEMPOTENCY).doc(key);
  const snap = await tx.get(ref);
  if (snap.exists) {
    const data = snap.data() as { status: string; result?: unknown; command?: string };
    if (data.status === 'done' && data.command === command) {
      return { seen: true, result: data.result ?? { ok: true } };
    }
    if (data.status === 'processing') {
      throw new HttpsError('aborted', 'This command is already in progress. Retry shortly.');
    }
  }
  return { seen: false, result: null };
}

function markIdempotencyDoneInTx(
  tx: FirebaseFirestore.Transaction,
  key: string,
  command: string,
  result: unknown,
): void {
  const ref = db.collection(IDEMPOTENCY).doc(key);
  tx.set(ref, {
    command,
    status: 'done',
    result,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Idempotency guard for commands with an external side effect
 * (requestExport uploads to Storage, which cannot run inside a
 * Firestore transaction). Uses a stale-lease: a 'processing' key older
 * than 10 minutes may be re-processed (crash recovery).
 */
async function checkIdempotencyWithLease(
  key: string,
  command: string,
): Promise<{ seen: boolean; result: unknown }> {
  const ref = db.collection(IDEMPOTENCY).doc(key);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() as { status: string; result?: unknown; command?: string; updatedAt?: Timestamp };
    if (data.status === 'done' && data.command === command) {
      return { seen: true, result: data.result ?? { ok: true } };
    }
    if (data.status === 'processing') {
      const ageMs = Date.now() - (data.updatedAt?.toMillis() ?? 0);
      if (ageMs < 10 * 60 * 1000) {
        throw new HttpsError('aborted', 'This command is already in progress. Retry shortly.');
      }
      // Stale lease: fall through and re-process.
    }
  }
  await ref.set({
    command,
    status: 'processing',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { seen: false, result: null };
}

async function markIdempotencyDone(key: string, command: string, result: unknown): Promise<void> {
  await db.collection(IDEMPOTENCY).doc(key).set({
    command,
    status: 'done',
    result,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * grantAccess — the ONLY path that adds a UID to sharedWith.
 * Caller must be the data owner; a live grant with matching scope
 * must exist. Callable by the worker, acting in the worker capacity.
 */
export const grantAccess = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as { consentId?: string } & ActingInput;
  if (typeof data.consentId !== 'string' || !data.consentId) {
    throw new HttpsError('invalid-argument', 'consentId is required.');
  }
  const consentSnap = await db.collection('consents').doc(data.consentId).get();
  if (!consentSnap.exists) {
    throw new HttpsError('not-found', 'Consent grant not found.');
  }
  const grant = consentSnap.data() as ConsentGrant;
  if (grant.granterId !== caller.uid) {
    throw new HttpsError('permission-denied', 'Only the granter may activate a grant.');
  }
  if (grant.revokedAt !== null) {
    throw new HttpsError('failed-precondition', 'Grant has been revoked.');
  }
  if (grant.expiresAt.toMillis() <= Timestamp.now().toMillis()) {
    throw new HttpsError('failed-precondition', 'Grant has expired.');
  }
  // Allowlist: only shareable collections may be sharing targets.
  const expectedScope = deriveConsentScope(grant.resourceType);
  if (expectedScope === null || grant.scope !== expectedScope) {
    throw new HttpsError(
      'failed-precondition',
      'Grant scope does not match an allowlisted shared document type.',
    );
  }
  const target = db.collection(grant.resourceType).doc(grant.resourceId);
  const targetSnap = await target.get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'Shared document not found.');
  }
  const targetData = targetSnap.data() as Record<string, unknown>;
  // The caller must own the target document (or be a participant, for
  // mentorships). Without this, a caller could point a grant at
  // someone else's document and share it.
  const ownsTarget =
    targetData.ownerId === caller.uid ||
    (Array.isArray(targetData.participantIds) &&
      targetData.participantIds.includes(caller.uid));
  if (!ownsTarget) {
    throw new HttpsError(
      'permission-denied',
      'You do not own the document this grant points to.',
    );
  }
  // Six-part authorization: identity + acting grant + scope +
  // relationship (owner) + purpose + live consent.
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: grant.tenantId },
    true,
    true, // migration bridge: audited claims fallback until grant backfill
  );
  const decision = authorizeCommand({
    authenticated: true,
    uid: caller.uid,
    actingGrant: ctx.actingGrant,
    claimsRoles: caller.claimsRoles,
    useClaimsFallback: ctx.migrationFallback,
    command: 'grantAccess',
    highRisk: true,
    scope: { tenantId: grant.tenantId, scopeType: 'self', scopeId: caller.uid },
    relationship: 'owner',
    relationshipRequired: true,
    purpose: data.purpose ?? grant.purpose ?? 'share a record',
    consentRequired: true,
    consentLive: true,
  });
  if (!decision.allowed) {
    throw new HttpsError('permission-denied', decision.reason);
  }
  const corr = correlationId(data.idempotencyKey, `grantAccess:${data.consentId}:${grant.granteeId}`);
  const result = await db.runTransaction(async (tx) => {
    const idem = await checkIdempotencyInTx(tx, corr, 'grantAccess');
    if (idem.seen) return idem.result;
    tx.update(target, {
      sharedWith: FieldValue.arrayUnion(grant.granteeId),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: grant.granterId,
      actorId: caller.uid,
      action: 'grantAccess',
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      actingRole: ctx.actingGrant?.role ?? 'worker (claims fallback)',
      actingGrantId: ctx.actingGrant?.id ?? null,
      purpose: data.purpose ?? grant.purpose ?? 'share a record',
      correlationId: corr,
      result: 'allowed',
      migrationFallback: ctx.migrationFallback,
    });
    markIdempotencyDoneInTx(tx, corr, 'grantAccess', { ok: true });
    return { ok: true };
  });
  return result;
});

/**
 * requestExport — bundle every document the caller owns, return a
 * signed download URL valid 7 days. Callable by the worker.
 * Includes the worker's own grants, memberships, assignments, and
 * handoffs (portability covers shared relationships, not just owned docs).
 */
export const requestExport = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as ActingInput;
  const uid = caller.uid;
  const corr = correlationId(data.idempotencyKey, `requestExport:${uid}:${Date.now()}`);
  const idem = await checkIdempotencyWithLease(corr, 'requestExport');
  if (idem.seen) return idem.result;
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: caller.claimsTenantId ?? 'demo-hub' },
    true,
    true, // migration bridge
  );
  const decision = authorizeCommand({
    authenticated: true,
    uid,
    actingGrant: ctx.actingGrant,
    claimsRoles: caller.claimsRoles,
    useClaimsFallback: ctx.migrationFallback,
    command: 'requestExport',
    highRisk: true,
    scope: { tenantId: caller.claimsTenantId ?? 'demo-hub', scopeType: 'self', scopeId: uid },
    relationship: 'owner',
    relationshipRequired: true,
    purpose: data.purpose ?? 'export my data',
    consentRequired: false,
    consentLive: null,
  });
  if (!decision.allowed) {
    throw new HttpsError('permission-denied', decision.reason);
  }
  const bundle: Record<string, unknown[]> = {};
  for (const coll of WORKER_OWNED) {
    const snap = await db.collection(coll).where('ownerId', '==', uid).get();
    bundle[coll] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  // Consent grants the worker gave or received.
  const granted = await db.collection('consents').where('granterId', '==', uid).get();
  const received = await db.collection('consents').where('granteeId', '==', uid).get();
  bundle['consents'] = [
    ...granted.docs.map((d) => ({ id: d.id, ...d.data() })),
    ...received.docs.map((d) => ({ id: d.id, ...d.data() })),
  ];
  // Own role grants, memberships, assignments, handoffs (as a party).
  const roleGrants = await db.collection('roleGrants').where('granteeId', '==', uid).get();
  bundle['roleGrants'] = roleGrants.docs.map((d) => ({ id: d.id, ...d.data() }));
  const memberships = await db.collection('memberships').where('personId', '==', uid).get();
  bundle['memberships'] = memberships.docs.map((d) => ({ id: d.id, ...d.data() }));
  const assignments = await db
    .collection('assignments')
    .where('workerId', '==', uid)
    .get();
  const heldAssignments = await db
    .collection('assignments')
    .where('holderId', '==', uid)
    .get();
  bundle['assignments'] = [
    ...assignments.docs.map((d) => ({ id: d.id, ...d.data() })),
    ...heldAssignments.docs.map((d) => ({ id: d.id, ...d.data() })),
  ];
  const handoffs = await db.collection('handoffs').where('workerId', '==', uid).get();
  bundle['handoffs'] = handoffs.docs.map((d) => ({ id: d.id, ...d.data() }));
  const payload = JSON.stringify(
    { exportedAt: new Date().toISOString(), ownerId: uid, data: bundle },
    null,
    2,
  );
  const file = storage
    .bucket()
    .file(`exports/${uid}/export-${Date.now()}.json`);
  await file.save(payload, { contentType: 'application/json' });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  const result = { url };
  await db.runTransaction(async (tx) => {
    writeAccessEventInTx(tx, {
      subjectId: uid,
      actorId: uid,
      action: 'requestExport',
      resourceType: 'export',
      resourceId: file.name,
      actingRole: ctx.actingGrant?.role ?? 'worker (claims fallback)',
      actingGrantId: ctx.actingGrant?.id ?? null,
      purpose: data.purpose ?? 'export my data',
      correlationId: corr,
      result: 'allowed',
      migrationFallback: ctx.migrationFallback,
    });
  });
  await markIdempotencyDone(corr, 'requestExport', result);
  return result;
});

/**
 * requestDeletion — delete owned documents; anonymise shared ones.
 * Audit / access-event records are kept as the system's accountability
 * record. Callable by the worker. Idempotent: repeating the same
 * idempotency key returns the stored result without re-processing.
 * NOTE (500-op limit): very large accounts may exceed one transaction;
 * the resumable job-based deletion is a Phase 2 refinement.
 */
export const requestDeletion = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as ActingInput;
  const uid = caller.uid;
  const corr = correlationId(data.idempotencyKey, `requestDeletion:${uid}`);
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: caller.claimsTenantId ?? 'demo-hub' },
    true,
    true, // migration bridge
  );
  const decision = authorizeCommand({
    authenticated: true,
    uid,
    actingGrant: ctx.actingGrant,
    claimsRoles: caller.claimsRoles,
    useClaimsFallback: ctx.migrationFallback,
    command: 'requestDeletion',
    highRisk: true,
    scope: { tenantId: caller.claimsTenantId ?? 'demo-hub', scopeType: 'self', scopeId: uid },
    relationship: 'owner',
    relationshipRequired: true,
    purpose: data.purpose ?? 'delete my data',
    consentRequired: false,
    consentLive: null,
  });
  if (!decision.allowed) {
    throw new HttpsError('permission-denied', decision.reason);
  }
  const TOMBSTONE = 'anonymised';
  const result = await db.runTransaction(async (tx) => {
    const idem = await checkIdempotencyInTx(tx, corr, 'requestDeletion');
    if (idem.seen) return idem.result as { ok: boolean };

    // 1. Delete worker-owned documents.
    for (const coll of WORKER_OWNED) {
      const snap = await tx.get(db.collection(coll).where('ownerId', '==', uid));
      for (const docSnap of snap.docs) tx.delete(docSnap.ref);
    }
    // 2. Anonymise shared documents the worker participated in.
    const mentorships = await tx.get(
      db.collection('mentorships').where('participantIds', 'array-contains', uid),
    );
    for (const docSnap of mentorships.docs) {
      tx.update(docSnap.ref, {
        participantIds: FieldValue.arrayRemove(uid),
        sharedWith: FieldValue.arrayRemove(uid),
      });
    }
    const supervised = await tx.get(
      db.collection('supervisionSessions').where('supervisorId', '==', uid),
    );
    for (const docSnap of supervised.docs) {
      tx.update(docSnap.ref, { supervisorId: TOMBSTONE });
    }
    const authored = await tx.get(
      db.collection('adaptationLogs').where('authorId', '==', uid),
    );
    for (const docSnap of authored.docs) {
      tx.update(docSnap.ref, { authorId: TOMBSTONE });
    }
    const complaints = await tx.get(
      db.collection('complaints').where('complainantId', '==', uid),
    );
    for (const docSnap of complaints.docs) {
      tx.update(docSnap.ref, { complainantId: TOMBSTONE });
    }
    // Assignments: remove the worker from both sides.
    const asWorker = await tx.get(
      db.collection('assignments').where('workerId', '==', uid),
    );
    for (const docSnap of asWorker.docs) {
      tx.update(docSnap.ref, { workerId: TOMBSTONE, status: 'closed' });
    }
    const asHolder = await tx.get(
      db.collection('assignments').where('holderId', '==', uid),
    );
    for (const docSnap of asHolder.docs) {
      tx.update(docSnap.ref, { holderId: TOMBSTONE, status: 'closed' });
    }
    // Handoffs: anonymise the worker as a party.
    const handoffs = await tx.get(
      db.collection('handoffs').where('workerId', '==', uid),
    );
    for (const docSnap of handoffs.docs) {
      tx.update(docSnap.ref, { workerId: TOMBSTONE, status: 'closed' });
    }
    // Memberships + person profile: deleted (the person leaves).
    const memberships = await tx.get(
      db.collection('memberships').where('personId', '==', uid),
    );
    for (const docSnap of memberships.docs) tx.delete(docSnap.ref);
    tx.delete(db.collection('persons').doc(uid));
    // Role grants: revoked, not deleted (accountability record).
    const grants = await tx.get(
      db.collection('roleGrants').where('granteeId', '==', uid),
    );
    for (const docSnap of grants.docs) {
      tx.update(docSnap.ref, {
        status: 'revoked',
        reviewReason: 'account-deletion',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    // 3. Close the worker's consent grants (revoke) and strip access.
    const stripSharedWithInTx = async (collection: string, docId: string, uidToRemove: string) => {
      const ref = db.collection(collection).doc(docId);
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      tx.update(ref, {
        sharedWith: FieldValue.arrayRemove(uidToRemove),
        updatedAt: FieldValue.serverTimestamp(),
      });
    };
    const grantsOut = await tx.get(
      db.collection('consents').where('granterId', '==', uid).where('revokedAt', '==', null),
    );
    for (const docSnap of grantsOut.docs) {
      const g = docSnap.data() as ConsentGrant;
      tx.update(docSnap.ref, {
        revokedAt: FieldValue.serverTimestamp(),
        revokeReason: 'account-deletion',
      });
      await stripSharedWithInTx(g.resourceType, g.resourceId, g.granteeId);
    }
    const grantsIn = await tx.get(
      db.collection('consents').where('granteeId', '==', uid).where('revokedAt', '==', null),
    );
    for (const docSnap of grantsIn.docs) {
      const g = docSnap.data() as ConsentGrant;
      tx.update(docSnap.ref, {
        revokedAt: FieldValue.serverTimestamp(),
        revokeReason: 'account-deletion',
      });
      await stripSharedWithInTx(g.resourceType, g.resourceId, uid);
    }
    // 4. Record the deletion request as processed.
    const reqRef = db.collection('deletionRequests').doc();
    tx.set(reqRef, {
      ownerId: uid,
      tenantId: caller.claimsTenantId ?? null,
      status: 'processed',
      createdAt: FieldValue.serverTimestamp(),
    });
    // 5. Access event (accountability record, kept) + idempotency mark.
    writeAccessEventInTx(tx, {
      subjectId: uid,
      actorId: uid,
      action: 'requestDeletion',
      resourceType: 'account',
      resourceId: uid,
      actingRole: ctx.actingGrant?.role ?? 'worker (claims fallback)',
      actingGrantId: ctx.actingGrant?.id ?? null,
      purpose: data.purpose ?? 'delete my data',
      correlationId: corr,
      result: 'allowed',
      migrationFallback: ctx.migrationFallback,
    });
    markIdempotencyDoneInTx(tx, corr, 'requestDeletion', { ok: true });
    return { ok: true };
  });
  return result;
});

/**
 * aggregateEvaluation — weekly. Reads raw evaluation submissions and
 * writes de-identified aggregates. Cells smaller than MIN_CELL are
 * suppressed (never written) to prevent re-identification.
 * The backbone never sees raw submissions. A release record documents
 * what was published, what was suppressed, and when.
 */
export const aggregateEvaluation = onSchedule(
  { schedule: 'every monday 02:00', timeZone: 'America/Toronto' },
  async () => {
    const snap = await db.collection('evaluationSubmissions').get();
    // Group counts by tenant + question + answer value.
    const cells = new Map<string, number>();
    for (const doc of snap.docs) {
      const data = doc.data() as {
        tenantId: string;
        responses: Record<string, string>;
      };
      const responses = data.responses ?? {};
      for (const [question, answer] of Object.entries(responses)) {
        const key = `${data.tenantId}||${question}||${answer}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
    }
    const period = new Date().toISOString().slice(0, 10);
    const batch = db.batch();
    let published = 0;
    let suppressed = 0;
    const tenants = new Set<string>();
    for (const [key, count] of cells) {
      const [tenantId] = key.split('||');
      tenants.add(tenantId);
      if (count < MIN_CELL) {
        suppressed += 1;
        continue; // suppress small cells
      }
      const [t, question, answer] = key.split('||');
      const ref = db.collection('aggregates').doc();
      batch.set(ref, {
        tenantId: t,
        metric: `evaluation:${question}`,
        period,
        value: count,
        breakdown: { answer },
        createdAt: FieldValue.serverTimestamp(),
      });
      published += 1;
    }
    // Release record: suppression + review metadata (per tenant).
    for (const tenantId of tenants) {
      const releaseRef = db.collection('aggregateReleases').doc();
      batch.set(releaseRef, {
        tenantId,
        metric: 'evaluation',
        period,
        published,
        suppressed,
        minCell: MIN_CELL,
        reviewedBy: null,
        releasedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  },
);

/**
 * expireConsents — daily. Closes expired grants and strips access.
 * Each expiry writes a server-authored access event in the same batch.
 */
export const expireConsents = onSchedule(
  { schedule: 'every day 03:00', timeZone: 'America/Toronto' },
  async () => {
    const now = Timestamp.now();
    const snap = await db
      .collection('consents')
      .where('revokedAt', '==', null)
      .where('expiresAt', '<=', now)
      .get();
    // Per-grant transactions: one missing target must not block the rest.
    for (const doc of snap.docs) {
      const g = doc.data() as ConsentGrant;
      const target = db.collection(g.resourceType).doc(g.resourceId);
      const targetSnap = await target.get();
      await db.runTransaction(async (tx) => {
        tx.update(doc.ref, {
          revokedAt: FieldValue.serverTimestamp(),
          revokeReason: 'expired',
        });
        if (targetSnap.exists) {
          tx.update(target, {
            sharedWith: FieldValue.arrayRemove(g.granteeId),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        const eventRef = db.collection(ACCESS_EVENTS).doc();
        tx.set(
          eventRef,
          buildAccessEvent(
            {
              subjectId: g.granterId,
              actorId: 'system:expireConsents',
              action: 'expireConsent',
              resourceType: g.resourceType,
              resourceId: g.resourceId,
              actingRole: 'system',
              actingGrantId: null,
              purpose: 'consent expiry',
              correlationId: doc.id,
              result: 'allowed',
              detail: targetSnap.exists ? undefined : { targetMissing: true },
            },
            FieldValue.serverTimestamp(),
          ),
        );
      });
    }
  },
);

/**
 * onConsentRevoke — when a grant is revoked, strip the grantee's
 * access from the shared document immediately, and audit it.
 * The trigger has no caller; the event is stamped actingRole 'system'.
 */
export const onConsentRevoke = onDocumentUpdated(
  'consents/{consentId}',
  async (event) => {
    const before = event.data?.before.data() as ConsentGrant | undefined;
    const after = event.data?.after.data() as ConsentGrant | undefined;
    if (!before || !after) return;
    if (before.revokedAt === null && after.revokedAt !== null) {
      const target = db.collection(after.resourceType).doc(after.resourceId);
      const targetSnap = await target.get();
      const batch = db.batch();
      if (targetSnap.exists) {
        batch.update(target, {
          sharedWith: FieldValue.arrayRemove(after.granteeId),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      const eventRef = db.collection(ACCESS_EVENTS).doc();
      batch.set(
        eventRef,
        buildAccessEvent(
          {
            subjectId: after.granterId,
            actorId: after.granterId,
            action: 'revokeConsent',
            resourceType: after.resourceType,
            resourceId: after.resourceId,
            actingRole: 'system',
            actingGrantId: null,
            purpose: 'consent revocation',
            correlationId: event.params.consentId,
            result: 'allowed',
          },
          FieldValue.serverTimestamp(),
        ),
      );
      await batch.commit();
    }
  },
);

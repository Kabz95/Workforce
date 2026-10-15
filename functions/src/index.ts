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
import { getFirestore, FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
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
  DELETION_PLAN,
  deriveConsentScope,
  isValidIdempotencyKey,
  type DeletionPlanStep,
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
  closeHandoffFn as closeHandoff,
  inviteMemberFn as inviteMember,
  ensureMyPersonFn as ensureMyPerson,
  createSupervisionSessionFn as createSupervisionSession,
  createMentorshipFn as createMentorship,
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
 * Build the export bundle for one person: every document they own,
 * consent grants they gave or received, and their own grants,
 * memberships, assignments, and handoffs (portability covers shared
 * relationships, not just owned docs). Shared by requestExport and the
 * deletion job's pre-deletion export step.
 */
async function buildExportBundle(uid: string): Promise<Record<string, unknown[]>> {
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
  return bundle;
}
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
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: caller.claimsTenantId ?? '' },
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
    scope: { tenantId: caller.claimsTenantId ?? '', scopeType: 'self', scopeId: uid },
    relationship: 'owner',
    relationshipRequired: true,
    purpose: data.purpose ?? 'export my data',
    consentRequired: false,
    consentLive: null,
  });
  if (!decision.allowed) {
    throw new HttpsError('permission-denied', decision.reason);
  }
  const bundle = await buildExportBundle(uid);
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
  // The file path is returned alongside the URL so callers (and tests)
  // can verify the stored object without parsing the signed URL.
  const result = { url, file: file.name, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
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
 * Deletion jobs (Phase 2) — resumable, job-based deletion.
 *
 * requestDeletion creates a deletionRequests job (status 'queued') and
 * returns its id. processDeletion advances the job one bounded pass
 * (the export step once, then one batch of deletion-plan steps). The
 * client calls processDeletion until the job is 'done'; the hourly
 * sweeper (processDeletionQueue) finishes jobs whose client
 * disconnected. A second requestDeletion while a job is unfinished
 * returns the existing job (resume), never a duplicate.
 *
 * Each pass is a single Firestore batch (≤ ~200 writes) + one job-doc
 * update, so a large account never hits the 500-op transaction limit.
 * The job carries a cursor { stepIndex, lastDocId } — an interrupted
 * pass resumes from the cursor; re-running a pass never double-applies
 * (each document is visited once, by cursor). A soft lease (a fresh
 * 'running' job) stops two passes colliding.
 */

const DELETION_TOMBSTONE = 'anonymised';
/** Max documents processed in one pass (keeps the batch well under 500 ops). */
const DELETION_BATCH_DOCS = 100;
/** A 'running' job newer than this is treated as a pass in progress. */
const DELETION_LEASE_MS = 5 * 60 * 1000;

interface DeletionJobData {
  ownerId: string;
  tenantId: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  stepIndex: number;
  lastDocId: string | null;
  processed: number;
  deleted: number;
  anonymised: number;
  exportUrl: string | null;
  exportError: string | null;
  error: string | null;
  updatedAt?: Timestamp;
}

function deletionJobFrom(data: FirebaseFirestore.DocumentData): DeletionJobData {
  return {
    ownerId: data.ownerId as string,
    tenantId: (data.tenantId as string | null) ?? null,
    status: data.status as DeletionJobData['status'],
    stepIndex: (data.stepIndex as number) ?? 0,
    lastDocId: (data.lastDocId as string | null) ?? null,
    processed: (data.processed as number) ?? 0,
    deleted: (data.deleted as number) ?? 0,
    anonymised: (data.anonymised as number) ?? 0,
    exportUrl: (data.exportUrl as string | null) ?? null,
    exportError: (data.exportError as string | null) ?? null,
    error: (data.error as string | null) ?? null,
    updatedAt: data.updatedAt as Timestamp | undefined,
  };
}

/** Fetch one page of documents for a deletion-plan step, after the cursor. */
async function fetchStepDocs(
  step: DeletionPlanStep,
  uid: string,
  lastDocId: string | null,
  limit: number,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const coll = db.collection(step.collection);
  if (step.match === 'docId') {
    // Single doc (persons/{uid}, users/{uid}): visited once, then the
    // cursor moves past it — a non-null cursor means it was done.
    if (lastDocId !== null) return [];
    const snap = await coll.doc(uid).get();
    return snap.exists ? [snap as unknown as FirebaseFirestore.QueryDocumentSnapshot] : [];
  }
  let q: FirebaseFirestore.Query = coll;
  if (step.match === 'participantIds' || step.match === 'sharedWith') {
    q = q.where(step.match, 'array-contains', uid);
  } else {
    q = q.where(step.match, '==', uid);
  }
  if (step.action === 'revokeConsent') {
    q = q.where('revokedAt', '==', null);
  }
  q = q.orderBy(FieldPath.documentId());
  if (lastDocId !== null) q = q.startAfter(lastDocId);
  const snap = await q.limit(limit).get();
  return snap.docs;
}

/**
 * Apply one deletion-plan step to one document, inside the pass batch.
 * revokeConsent also strips the other party from the target's
 * sharedWith (the target is read first; a missing target is skipped,
 * never fails the pass).
 */
async function applyDeletionStep(
  batch: FirebaseFirestore.WriteBatch,
  step: DeletionPlanStep,
  docSnap: FirebaseFirestore.QueryDocumentSnapshot,
  uid: string,
): Promise<void> {
  const ref = docSnap.ref;
  const stamp = { updatedAt: FieldValue.serverTimestamp() };
  switch (step.action) {
    case 'delete':
      batch.delete(ref);
      return;
    case 'anonymiseField': {
      const update: Record<string, unknown> = { ...stamp };
      for (const f of step.fields ?? []) update[f] = DELETION_TOMBSTONE;
      batch.update(ref, update);
      return;
    }
    case 'closeLink': {
      const update: Record<string, unknown> = { ...stamp, ...(step.extra ?? {}) };
      for (const f of step.fields ?? []) update[f] = DELETION_TOMBSTONE;
      batch.update(ref, update);
      return;
    }
    case 'stripUid': {
      const update: Record<string, unknown> = { ...stamp };
      for (const f of step.fields ?? []) update[f] = FieldValue.arrayRemove(uid);
      batch.update(ref, update);
      return;
    }
    case 'revokeGrant':
      batch.update(ref, {
        status: 'revoked',
        reviewReason: 'account-deletion',
        ...stamp,
      });
      return;
    case 'revokeConsent': {
      batch.update(ref, {
        revokedAt: FieldValue.serverTimestamp(),
        revokeReason: 'account-deletion',
      });
      const consent = docSnap.data() as ConsentGrant;
      const stripUid =
        step.stripTargetSharedWith === 'granteeId' ? consent.granteeId : uid;
      const target = db.collection(consent.resourceType).doc(consent.resourceId);
      const targetSnap = await target.get();
      if (targetSnap.exists) {
        batch.update(target, {
          sharedWith: FieldValue.arrayRemove(stripUid),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Run one bounded deletion pass for a job: the export step (once),
 * then deletion-plan steps from the cursor until the doc budget is
 * spent. Updates the job doc (progress + cursor) in the same batch as
 * the deletions; on completion, writes the accountability access event.
 */
async function runDeletionPass(
  jobRef: FirebaseFirestore.DocumentReference,
  job: DeletionJobData,
): Promise<{ status: string; processed: number; deleted: number; anonymised: number; exportUrl: string | null; exportError: string | null }> {
  const uid = job.ownerId;

  // 1. Export step (once). Best-effort: deletion is the critical path.
  // The worker is told to export first; a failed auto-export is
  // recorded on the job, never blocks deletion.
  if (job.exportUrl === null && job.exportError === null) {
    try {
      const bundle = await buildExportBundle(uid);
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
      job.exportUrl = url;
      await jobRef.update({ exportUrl: url, updatedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      job.exportError = err instanceof Error ? err.message : 'export failed';
      await jobRef.update({ exportError: job.exportError, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  // 2. Deletion steps from the cursor, within the doc budget.
  let { stepIndex, lastDocId, processed, deleted, anonymised } = job;
  const batch = db.batch();
  let docsInPass = 0;
  while (stepIndex < DELETION_PLAN.length && docsInPass < DELETION_BATCH_DOCS) {
    const step = DELETION_PLAN[stepIndex];
    const remaining = DELETION_BATCH_DOCS - docsInPass;
    const docs = await fetchStepDocs(step, uid, lastDocId, remaining);
    if (docs.length === 0) {
      stepIndex += 1;
      lastDocId = null;
      continue;
    }
    for (const docSnap of docs) {
      await applyDeletionStep(batch, step, docSnap, uid);
      lastDocId = docSnap.id;
      if (step.action === 'delete') deleted += 1;
      else anonymised += 1;
    }
    processed += docs.length;
    docsInPass += docs.length;
    if (docs.length < remaining) {
      // Step exhausted — advance to the next step in this same pass.
      stepIndex += 1;
      lastDocId = null;
    }
    // A full page means the budget is spent; the loop exits and the
    // next pass resumes this step from the cursor.
  }
  const done = stepIndex >= DELETION_PLAN.length;

  // 3. Job update (+ accountability event on completion) in the same batch.
  batch.update(jobRef, {
    status: done ? 'done' : 'running',
    stepIndex,
    lastDocId,
    processed,
    deleted,
    anonymised,
    updatedAt: FieldValue.serverTimestamp(),
    ...(done ? { completedAt: FieldValue.serverTimestamp() } : {}),
  });
  if (done) {
    const eventRef = db.collection(ACCESS_EVENTS).doc();
    batch.set(
      eventRef,
      buildAccessEvent(
        {
          subjectId: uid,
          actorId: uid,
          action: 'requestDeletion',
          resourceType: 'account',
          resourceId: uid,
          actingRole: 'worker',
          actingGrantId: null,
          purpose: 'delete my data',
          correlationId: jobRef.id,
          result: 'allowed',
        },
        FieldValue.serverTimestamp(),
      ),
    );
  }
  await batch.commit();
  return {
    status: done ? 'done' : 'running',
    processed,
    deleted,
    anonymised,
    exportUrl: job.exportUrl,
    exportError: job.exportError,
  };
}

/**
 * requestDeletion — create a resumable deletion job. Callable by the
 * worker. The job (not a single transaction) does the work, so a large
 * account never hits the 500-op limit. Audit / access-event records
 * are kept as the system's accountability record.
 */
export const requestDeletion = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as ActingInput;
  const uid = caller.uid;
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: caller.claimsTenantId ?? '' },
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
    scope: { tenantId: caller.claimsTenantId ?? '', scopeType: 'self', scopeId: uid },
    relationship: 'owner',
    relationshipRequired: true,
    purpose: data.purpose ?? 'delete my data',
    consentRequired: false,
    consentLive: null,
  });
  if (!decision.allowed) {
    throw new HttpsError('permission-denied', decision.reason);
  }
  // Resume: an unfinished job for this uid is returned, never duplicated.
  const existing = await db
    .collection('deletionRequests')
    .where('ownerId', '==', uid)
    .where('status', 'in', ['queued', 'running'])
    .limit(1)
    .get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    return { ok: true, requestId: doc.id, status: doc.data().status as string, resumed: true };
  }
  const ref = db.collection('deletionRequests').doc();
  await ref.set({
    ownerId: uid,
    tenantId: caller.claimsTenantId ?? null,
    status: 'queued',
    stepIndex: 0,
    lastDocId: null,
    processed: 0,
    deleted: 0,
    anonymised: 0,
    exportUrl: null,
    exportError: null,
    error: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    completedAt: null,
  });
  return { ok: true, requestId: ref.id, status: 'queued', resumed: false };
});

/**
 * processDeletion — advance one deletion job by one bounded pass.
 * The job owner calls it repeatedly until the job is 'done'. The
 * scheduled sweeper finishes jobs whose client disconnected.
 */
export const processDeletion = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as { requestId?: string } & ActingInput;
  if (!data.requestId) {
    throw new HttpsError('invalid-argument', 'requestId is required.');
  }
  const ref = db.collection('deletionRequests').doc(data.requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Deletion job not found.');
  const job = deletionJobFrom(snap.data() as FirebaseFirestore.DocumentData);
  if (job.ownerId !== caller.uid) {
    throw new HttpsError('permission-denied', 'Only the job owner may advance their deletion.');
  }
  if (job.status === 'done') {
    return { ok: true, requestId: ref.id, status: 'done', processed: job.processed, deleted: job.deleted, anonymised: job.anonymised, exportUrl: job.exportUrl, exportError: job.exportError };
  }
  if (job.status === 'failed') {
    throw new HttpsError('failed-precondition', `Deletion job failed: ${job.error ?? 'unknown error'}.`);
  }
  // Soft lease: a fresh 'running' job means another pass is in progress.
  if (
    job.status === 'running' &&
    job.updatedAt &&
    Date.now() - job.updatedAt.toMillis() < DELETION_LEASE_MS
  ) {
    throw new HttpsError('aborted', 'A deletion pass is already in progress. Retry shortly.');
  }
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: caller.claimsTenantId ?? '' },
    true,
    true, // migration bridge
  );
  const decision = authorizeCommand({
    authenticated: true,
    uid: caller.uid,
    actingGrant: ctx.actingGrant,
    claimsRoles: caller.claimsRoles,
    useClaimsFallback: ctx.migrationFallback,
    command: 'processDeletion',
    highRisk: true,
    scope: { tenantId: caller.claimsTenantId ?? '', scopeType: 'self', scopeId: caller.uid },
    relationship: 'owner',
    relationshipRequired: true,
    purpose: data.purpose ?? 'delete my data',
    consentRequired: false,
    consentLive: null,
  });
  if (!decision.allowed) {
    throw new HttpsError('permission-denied', decision.reason);
  }
  try {
    const result = await runDeletionPass(ref, job);
    return { ok: true, requestId: ref.id, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'deletion pass failed';
    await ref.update({ status: 'failed', error: message, updatedAt: FieldValue.serverTimestamp() });
    throw new HttpsError('internal', message);
  }
});

/**
 * processDeletionQueue — hourly sweeper. Finishes deletion jobs whose
 * client disconnected. Skips fresh 'running' jobs (a pass may be in
 * progress) and failed jobs (they need human review, not auto-retry).
 */
export const processDeletionQueue = onSchedule(
  { schedule: 'every hour', timeZone: 'America/Toronto' },
  async () => {
    const snap = await db
      .collection('deletionRequests')
      .where('status', 'in', ['queued', 'running'])
      .limit(5)
      .get();
    for (const doc of snap.docs) {
      const job = deletionJobFrom(doc.data());
      if (
        job.status === 'running' &&
        job.updatedAt &&
        Date.now() - job.updatedAt.toMillis() < DELETION_LEASE_MS
      ) {
        continue;
      }
      try {
        await runDeletionPass(doc.ref, job);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'deletion pass failed';
        await doc.ref.update({ status: 'failed', error: message, updatedAt: FieldValue.serverTimestamp() });
      }
    }
  },
);

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

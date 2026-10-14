/**
 * Policy gateway — Firestore-backed authorization.
 *
 * Server authority for: grant resolution, claims sync, grant
 * lifecycle (request / create / resolve / revoke), conflict
 * declarations, and the minimal handoff commands for the Phase 2 slice.
 *
 * Rules the gateway enforces:
 * - High-risk commands are authorized from grant DOCUMENTS, never from
 *   claims alone — except the audited migration fallback (a user with
 *   claims but no grant docs yet, flagged in the decision + audit).
 * - Server grant lookup on every sensitive command (stale-authority
 *   control): a revoked grant in a long-lived token cannot be used.
 * - No self-approval. High-risk combinations need review.
 * - Business data + its access event succeed together or fail together
 *   (Firestore transaction). "Best-effort" logging is not sufficient.
 */

import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  authorizeCommand,
  buildAccessEvent,
  commandAllowsRole,
  evaluateGrantRequest,
  grantCoversScope,
  isGrantLive,
  isValidPurpose,
  mayAuthorizeGrant,
  selectDefaultGrant,
  transitionHandoff,
  validateGrantTransition,
  validateHandoffParties,
  type AnyRole,
  type GrantStatus,
  type Handoff,
  type PolicyScope,
  type RoleGrant,
  type ScopeType,
} from './kernel';

const db: Firestore = getFirestore();

const GRANTS = 'roleGrants';
const PERSONS = 'persons';
const CONFLICTS = 'conflictDeclarations';
const HANDOFFS = 'handoffs';
const ACCESS_EVENTS = 'accessEvents';
const IDEMPOTENCY = 'idempotencyKeys';

type Tx = Transaction;

export interface Caller {
  uid: string;
  claimsRoles: AnyRole[];
  claimsTenantId: string | null;
}

export function callerFrom(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }): Caller {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign-in required.');
  }
  const token = (request.auth.token ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(token.roles)
    ? (token.roles as string[])
    : typeof token.role === 'string'
      ? [token.role]
      : [];
  return {
    uid: request.auth.uid,
    claimsRoles: roles as AnyRole[],
    claimsTenantId: typeof token.tenantId === 'string' ? token.tenantId : null,
  };
}

function grantFromDoc(doc: DocumentData): RoleGrant {
  const d = doc.data();
  const toMs = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    if (typeof (v as Timestamp)?.toMillis === 'function') return (v as Timestamp).toMillis();
    return null;
  };
  return {
    id: doc.id,
    granteeId: d.granteeId,
    granteeEmail: typeof d.granteeEmail === 'string' ? d.granteeEmail : undefined,
    role: d.role,
    scopeType: d.scopeType,
    scopeId: d.scopeId,
    tenantId: d.tenantId,
    status: d.status,
    validFrom: toMs(d.validFrom) ?? 0,
    validUntil: toMs(d.validUntil),
    grantedBy: d.grantedBy,
    basis: d.basis ?? '',
    needsReview: d.needsReview ?? false,
    reviewReason: d.reviewReason ?? undefined,
    createdAt: toMs(d.createdAt) ?? undefined,
    updatedAt: toMs(d.updatedAt) ?? undefined,
  };
}

async function resolveCallerGrants(uid: string): Promise<RoleGrant[]> {
  const snap = await db.collection(GRANTS).where('granteeId', '==', uid).get();
  return snap.docs.map(grantFromDoc);
}

async function liveGrantsFor(uid: string, nowMs = Date.now()): Promise<RoleGrant[]> {
  const grants = await resolveCallerGrants(uid);
  return grants.filter((g) => isGrantLive(g, nowMs));
}

/** Find a live grant for the caller's acting capacity, or null. */
async function resolveActingGrant(
  caller: Caller,
  actingGrantId: string | null | undefined,
  actingRole: string | null | undefined,
): Promise<RoleGrant | null> {
  const live = await liveGrantsFor(caller.uid);
  if (actingGrantId) {
    return live.find((g) => g.id === actingGrantId) ?? null;
  }
  if (actingRole) {
    return live.find((g) => g.role === actingRole) ?? null;
  }
  return selectDefaultGrant(live);
}

export function writeAccessEventInTx(
  tx: Tx,
  event: Parameters<typeof buildAccessEvent>[0],
): void {
  const ref = db.collection(ACCESS_EVENTS).doc();
  tx.set(ref, buildAccessEvent(event, FieldValue.serverTimestamp()));
}

/**
 * Rebuild a user's custom claims from their ACTIVE grants.
 * Claims are a cache of grants, never the authority. Preserves tenantId.
 */
export async function syncClaimsForUser(uid: string): Promise<void> {
  const live = await liveGrantsFor(uid);
  const roles = [...new Set(live.map((g) => g.role))];
  const user = await getAuth().getUser(uid);
  const existing = (user.customClaims ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof existing.tenantId === 'string' ? existing.tenantId : null;
  const person = await db.collection(PERSONS).doc(uid).get();
  const personTenant = person.exists
    ? (person.data()?.tenantId as string | undefined) ?? null
    : null;
  await getAuth().setCustomUserClaims(uid, {
    ...existing,
    roles,
    tenantId: tenantId ?? personTenant ?? null,
  });
}

export interface CommandContext {
  caller: Caller;
  actingGrant: RoleGrant | null;
  migrationFallback: boolean;
}

/**
 * Resolve the caller's acting grant for a command.
 * High-risk commands: grants only (no claims fallback), unless
 * `allowMigrationFallback` is set — the audited migration bridge for
 * existing users who have claims but no grant documents yet (worker
 * commands only; never for grant administration).
 * Other commands: grants preferred, audited claims fallback allowed.
 */
export async function resolveCommandContext(
  caller: Caller,
  data: {
    actingGrantId?: string | null;
    actingRole?: string | null;
    tenantId?: string;
  },
  highRisk: boolean,
  allowMigrationFallback = false,
): Promise<CommandContext> {
  const actingGrant = await resolveActingGrant(caller, data.actingGrantId ?? null, data.actingRole ?? null);
  if (actingGrant) return { caller, actingGrant, migrationFallback: false };
  if (highRisk && !allowMigrationFallback) {
    throw new HttpsError(
      'permission-denied',
      'A live role grant is required for this command.',
    );
  }
  // Migration bridge: claims fallback, audited by the caller of authorizeCommand.
  return { caller, actingGrant: null, migrationFallback: caller.claimsRoles.length > 0 };
}

function denyIfNotAllowed(
  decision: ReturnType<typeof authorizeCommand>,
): void {
  if (!decision.allowed) {
    throw new HttpsError('permission-denied', decision.reason);
  }
}

/**
 * Gateway purpose validation (Phase 2). Handlers that do NOT run the
 * kernel's authorizeCommand must still validate their purpose against
 * the central taxonomy — the gateway validates purpose, the kernel
 * owns the vocabulary. Returns the validated purpose (or the fallback
 * when the caller sent none).
 */
function validatePurpose(purpose: unknown, fallback: string): string {
  if (purpose === undefined || purpose === null) return fallback;
  if (!isValidPurpose(purpose)) {
    throw new HttpsError(
      'invalid-argument',
      `Purpose "${String(purpose)}" is not in the purpose taxonomy.`,
    );
  }
  return purpose;
}

// ---------------------------------------------------------------------------
// authorizeCommand — policy gateway callable (defense in depth).
// The real enforcement is in each command handler, which re-runs this.
// ---------------------------------------------------------------------------

export const authorizeCommandFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    command?: string;
    highRisk?: boolean;
    scope?: PolicyScope;
    relationship?: string;
    purpose?: string | null;
    consentRequired?: boolean;
    consentLive?: boolean | null;
    actingGrantId?: string | null;
    actingRole?: string | null;
  };
  const scope: PolicyScope = data.scope ?? {
    tenantId: caller.claimsTenantId ?? '',
    scopeType: 'hub',
    scopeId: caller.claimsTenantId ?? '',
  };
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: scope.tenantId },
    data.highRisk === true,
  );
  const decision = authorizeCommand(
    {
      authenticated: true,
      uid: caller.uid,
      actingGrant: ctx.actingGrant,
      claimsRoles: caller.claimsRoles,
      useClaimsFallback: ctx.migrationFallback,
      command: data.command ?? 'unknown',
      highRisk: data.highRisk === true,
      scope,
      relationship: (data.relationship as 'owner' | 'participant' | 'assigned' | 'member' | 'none' | 'public') ?? 'none',
      relationshipRequired: false,
      purpose: data.purpose ?? null,
      consentRequired: data.consentRequired === true,
      consentLive: data.consentLive ?? null,
    },
  );
  return {
    allowed: decision.allowed,
    reason: decision.reason,
    checks: decision.checks,
    migrationFallback: decision.migrationFallback,
    actingGrantId: decision.actingGrantId,
  };
});

// ---------------------------------------------------------------------------
// getMyGrants — server authority for the switcher.
// ---------------------------------------------------------------------------

export const getMyGrantsFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const grants = await resolveCallerGrants(caller.uid);
  const now = Date.now();
  return {
    grants: grants.map((g) => ({
      ...g,
      live: isGrantLive(g, now),
    })),
    defaultGrantId: selectDefaultGrant(grants, now)?.id ?? null,
  };
});

// ---------------------------------------------------------------------------
// requestRoleGrant — a user asks for a role (proposal, not approval).
// ---------------------------------------------------------------------------

export const requestRoleGrantFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    role?: string;
    scopeType?: ScopeType;
    scopeId?: string;
    tenantId?: string;
    validUntil?: string;
    justification?: string;
  };
  if (!data.role || !data.scopeType || !data.scopeId || !data.tenantId) {
    throw new HttpsError('invalid-argument', 'role, scopeType, scopeId, tenantId are required.');
  }
  if (data.role === 'systemAdmin') {
    throw new HttpsError(
      'permission-denied',
      'Operational (systemAdmin) grants cannot be self-requested.',
    );
  }
  const validUntilMs = data.validUntil ? Date.parse(data.validUntil) : null;
  if (validUntilMs !== null && Number.isNaN(validUntilMs)) {
    throw new HttpsError('invalid-argument', 'validUntil must be an ISO date.');
  }
  const grant: Omit<RoleGrant, 'id'> = {
    granteeId: caller.uid,
    role: data.role as AnyRole,
    scopeType: data.scopeType,
    scopeId: data.scopeId,
    tenantId: data.tenantId,
    status: 'proposed',
    validFrom: Date.now(),
    validUntil: validUntilMs,
    grantedBy: caller.uid,
    basis: data.justification ?? 'self-request',
    needsReview: false,
  };
  const ref = await db.collection(GRANTS).add({
    ...grant,
    validFrom: Timestamp.fromMillis(grant.validFrom),
    validUntil: grant.validUntil === null ? null : Timestamp.fromMillis(grant.validUntil),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.runTransaction(async (tx) => {
    writeAccessEventInTx(tx, {
      subjectId: caller.uid,
      actorId: caller.uid,
      action: 'requestRoleGrant',
      resourceType: 'roleGrant',
      resourceId: ref.id,
      actingRole: 'self-request',
      actingGrantId: null,
      purpose: 'request a role grant',
      correlationId: ref.id,
      result: 'allowed',
    });
  });
  return { ok: true, grantId: ref.id, status: 'proposed' };
});

// ---------------------------------------------------------------------------
// createRoleGrant — direct grant by a grant authority (governance).
// ---------------------------------------------------------------------------

export const createRoleGrantFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    subjectId?: string;
    role?: string;
    scopeType?: ScopeType;
    scopeId?: string;
    tenantId?: string;
    validUntil?: string;
    basis?: string;
    purpose?: string;
    idempotencyKey?: string;
    actingGrantId?: string | null;
    actingRole?: string | null;
  };
  if (!data.subjectId || !data.role || !data.scopeType || !data.scopeId || !data.tenantId || !data.basis) {
    throw new HttpsError(
      'invalid-argument',
      'subjectId, role, scopeType, scopeId, tenantId, basis are required.',
    );
  }
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: data.tenantId },
    true,
  );
  const actingGrant = ctx.actingGrant;
  if (!actingGrant) {
    throw new HttpsError('permission-denied', 'A live grant is required to create grants.');
  }
  if (!mayAuthorizeGrant(actingGrant.role, actingGrant.tenantId, data.tenantId)) {
    throw new HttpsError(
      'permission-denied',
      'The acting grant does not authorize creating grants in this scope.',
    );
  }
  const decision = authorizeCommand({
    authenticated: true,
    uid: caller.uid,
    actingGrant,
    claimsRoles: caller.claimsRoles,
    useClaimsFallback: false,
    command: 'createRoleGrant',
    highRisk: true,
    scope: { tenantId: data.tenantId, scopeType: data.scopeType, scopeId: data.scopeId },
    relationship: 'member',
    relationshipRequired: false,
    purpose: data.purpose ?? 'grant a role',
    consentRequired: false,
    consentLive: null,
  });
  denyIfNotAllowed(decision);

  // Separation of duties.
  const subjectGrants = await liveGrantsFor(data.subjectId);
  const evaluation = evaluateGrantRequest({
    subjectId: data.subjectId,
    approverId: caller.uid,
    requestedRole: data.role as AnyRole,
    subjectHeldRoles: subjectGrants.map((g) => g.role),
  });
  if (evaluation.decision === 'deny') {
    throw new HttpsError('permission-denied', evaluation.reason);
  }
  const validUntilMs = data.validUntil ? Date.parse(data.validUntil) : null;
  if (data.role === 'systemAdmin') {
    if (validUntilMs === null) {
      throw new HttpsError('invalid-argument', 'Operational (systemAdmin) grants require validUntil.');
    }
    if (validUntilMs - Date.now() > 7 * 24 * 60 * 60 * 1000) {
      throw new HttpsError('invalid-argument', 'Operational grants are limited to 7 days.');
    }
  }
  const status: GrantStatus = evaluation.decision === 'needsReview' ? 'proposed' : 'active';
  const ref = db.collection(GRANTS).doc();
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      granteeId: data.subjectId,
      role: data.role,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      tenantId: data.tenantId,
      status,
      validFrom: FieldValue.serverTimestamp(),
      validUntil: validUntilMs === null ? null : Timestamp.fromMillis(validUntilMs),
      grantedBy: caller.uid,
      basis: data.basis,
      needsReview: evaluation.decision === 'needsReview',
      reviewReason: evaluation.decision === 'needsReview' ? evaluation.reason : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: data.subjectId ?? '',
      actorId: caller.uid,
      action: status === 'active' ? 'createRoleGrant' : 'createRoleGrant-needsReview',
      resourceType: 'roleGrant',
      resourceId: ref.id,
      actingRole: actingGrant.role,
      actingGrantId: actingGrant.id ?? null,
      purpose: data.purpose ?? 'grant a role',
      correlationId: data.idempotencyKey ?? ref.id,
      result: 'allowed',
      detail: { role: data.role, evaluation: evaluation.decision },
    });
  });
  if (status === 'active') {
    await syncClaimsForUser(data.subjectId);
  }
  return { ok: true, grantId: ref.id, status, evaluation: evaluation.decision };
});

// ---------------------------------------------------------------------------
// inviteMember — an organisation admin invites a person by email.
//
// Creates a PENDING invitation: granteeEmail set (lowercased),
// granteeId '' (no account yet), status 'pending'. The invitation
// confers NOTHING until the invitee signs in with that email and
// ensureMyPerson claims it (→ active, or → proposed when the
// invitation needs review). Invitations expire after 30 days unless
// the inviter sets a validUntil.
//
// Separation of duties: no self-invite (the inviter cannot invite
// their own email), no systemAdmin invitations, and the SoD
// evaluation runs against the invitee's existing grants when the
// email already belongs to an account. Inviting the same
// email+role+scope twice is idempotent (the existing invitation is
// returned, no duplicate is created).
// ---------------------------------------------------------------------------

export const inviteMemberFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    granteeEmail?: string;
    role?: string;
    scopeType?: ScopeType;
    scopeId?: string;
    tenantId?: string;
    validUntil?: string;
    basis?: string;
    purpose?: string;
    actingGrantId?: string | null;
    actingRole?: string | null;
  };
  if (!data.granteeEmail || !data.role || !data.scopeType || !data.scopeId || !data.tenantId || !data.basis) {
    throw new HttpsError(
      'invalid-argument',
      'granteeEmail, role, scopeType, scopeId, tenantId, basis are required.',
    );
  }
  const granteeEmail = data.granteeEmail.trim().toLowerCase();
  if (!granteeEmail.includes('@')) {
    throw new HttpsError('invalid-argument', 'granteeEmail must be an email address.');
  }
  if (data.role === 'systemAdmin') {
    throw new HttpsError(
      'permission-denied',
      'Operational (systemAdmin) grants are never invited; they go through direct grant creation.',
    );
  }
  // No self-invite: the inviter cannot invite their own email.
  const callerUser = await getAuth().getUser(caller.uid);
  if (typeof callerUser.email === 'string' && callerUser.email.toLowerCase() === granteeEmail) {
    throw new HttpsError('permission-denied', 'You cannot invite yourself.');
  }
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: data.tenantId },
    true,
  );
  const actingGrant = ctx.actingGrant;
  if (!actingGrant) {
    throw new HttpsError('permission-denied', 'A live grant is required to invite members.');
  }
  if (!mayAuthorizeGrant(actingGrant.role, actingGrant.tenantId, data.tenantId)) {
    throw new HttpsError(
      'permission-denied',
      'The acting grant does not authorize inviting members in this scope.',
    );
  }
  const decision = authorizeCommand({
    authenticated: true,
    uid: caller.uid,
    actingGrant,
    claimsRoles: caller.claimsRoles,
    useClaimsFallback: false,
    command: 'inviteMember',
    highRisk: true,
    scope: { tenantId: data.tenantId, scopeType: data.scopeType, scopeId: data.scopeId },
    relationship: 'member',
    relationshipRequired: false,
    purpose: data.purpose ?? 'invite a member',
    consentRequired: false,
    consentLive: null,
  });
  denyIfNotAllowed(decision);

  // SoD against the invitee's existing grants when the email already
  // belongs to an account; a brand-new email holds nothing.
  let existingUid: string | null = null;
  try {
    existingUid = (await getAuth().getUserByEmail(granteeEmail)).uid;
  } catch {
    existingUid = null;
  }
  const subjectHeldRoles = existingUid ? (await liveGrantsFor(existingUid)).map((g) => g.role) : [];
  const evaluation = evaluateGrantRequest({
    subjectId: existingUid ?? '',
    approverId: caller.uid,
    requestedRole: data.role as AnyRole,
    subjectHeldRoles,
  });
  if (evaluation.decision === 'deny') {
    throw new HttpsError('permission-denied', evaluation.reason);
  }
  // Idempotent: an identical pending invitation is returned, not duplicated.
  const dupSnap = await db
    .collection(GRANTS)
    .where('granteeEmail', '==', granteeEmail)
    .where('role', '==', data.role)
    .where('scopeType', '==', data.scopeType)
    .where('scopeId', '==', data.scopeId)
    .where('tenantId', '==', data.tenantId)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (!dupSnap.empty) {
    return { ok: true, grantId: dupSnap.docs[0].id, status: 'pending', duplicate: true };
  }
  const validUntilMs = data.validUntil ? Date.parse(data.validUntil) : null;
  if (data.validUntil && Number.isNaN(validUntilMs)) {
    throw new HttpsError('invalid-argument', 'validUntil must be an ISO date.');
  }
  const effectiveValidUntilMs = validUntilMs ?? Date.now() + 30 * 24 * 60 * 60 * 1000;
  const ref = db.collection(GRANTS).doc();
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      granteeEmail,
      granteeId: '',
      role: data.role,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      tenantId: data.tenantId,
      status: 'pending',
      validFrom: FieldValue.serverTimestamp(),
      validUntil: Timestamp.fromMillis(effectiveValidUntilMs),
      grantedBy: caller.uid,
      basis: data.basis,
      needsReview: evaluation.decision === 'needsReview',
      reviewReason: evaluation.decision === 'needsReview' ? evaluation.reason : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: '',
      actorId: caller.uid,
      action: 'inviteMember',
      resourceType: 'roleGrant',
      resourceId: ref.id,
      actingRole: actingGrant.role,
      actingGrantId: actingGrant.id ?? null,
      purpose: data.purpose ?? 'invite a member',
      correlationId: ref.id,
      result: 'allowed',
      detail: { granteeEmail, role: data.role, evaluation: evaluation.decision },
    });
  });
  return { ok: true, grantId: ref.id, status: 'pending', needsReview: evaluation.decision === 'needsReview' };
});

// ---------------------------------------------------------------------------
// resolveRoleGrant — approve / deny a proposed grant.
// ---------------------------------------------------------------------------

export const resolveRoleGrantFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    grantId?: string;
    decision?: 'approve' | 'deny';
    reason?: string;
    purpose?: string;
    actingGrantId?: string | null;
    actingRole?: string | null;
  };
  if (!data.grantId || (data.decision !== 'approve' && data.decision !== 'deny')) {
    throw new HttpsError('invalid-argument', 'grantId and decision approve|deny are required.');
  }
  const purpose = validatePurpose(data.purpose, 'resolve a proposed grant');
  const ref = db.collection(GRANTS).doc(data.grantId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Grant not found.');
  const grant = grantFromDoc(snap);
  if (grant.status !== 'proposed') {
    throw new HttpsError('failed-precondition', `Grant is ${grant.status}, not proposed.`);
  }
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: grant.tenantId },
    true,
  );
  const actingGrant = ctx.actingGrant;
  if (!actingGrant) {
    throw new HttpsError('permission-denied', 'A live grant is required to resolve grants.');
  }
  if (!mayAuthorizeGrant(actingGrant.role, actingGrant.tenantId, grant.tenantId)) {
    throw new HttpsError('permission-denied', 'The acting grant does not authorize resolving grants in this scope.');
  }
  if (grant.needsReview && actingGrant.role !== 'council') {
    throw new HttpsError(
      'permission-denied',
      'Grants flagged for review may only be resolved by council.',
    );
  }
  const to: GrantStatus = data.decision === 'approve' ? 'active' : 'revoked';
  const transition = validateGrantTransition('proposed', to, caller.uid, grant);
  if (!transition.ok) throw new HttpsError('permission-denied', transition.reason);
  await db.runTransaction(async (tx) => {
    tx.update(ref, {
      status: to,
      needsReview: false,
      reviewReason: data.reason ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: grant.granteeId,
      actorId: caller.uid,
      action: data.decision === 'approve' ? 'approveRoleGrant' : 'denyRoleGrant',
      resourceType: 'roleGrant',
      resourceId: ref.id,
      actingRole: actingGrant.role,
      actingGrantId: actingGrant.id ?? null,
      purpose,
      correlationId: ref.id,
      result: 'allowed',
      detail: { role: grant.role, reason: data.reason ?? null },
    });
  });
  if (to === 'active') await syncClaimsForUser(grant.granteeId);
  return { ok: true, grantId: ref.id, status: to };
});

// ---------------------------------------------------------------------------
// revokeRoleGrant — revoke a live grant (authority, or self-relinquish).
// ---------------------------------------------------------------------------

export const revokeRoleGrantFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    grantId?: string;
    reason?: string;
    purpose?: string;
    actingGrantId?: string | null;
    actingRole?: string | null;
  };
  if (!data.grantId) throw new HttpsError('invalid-argument', 'grantId is required.');
  const purpose = validatePurpose(data.purpose, 'revoke a role grant');
  const ref = db.collection(GRANTS).doc(data.grantId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Grant not found.');
  const grant = grantFromDoc(snap);
  if (grant.status !== 'active' && grant.status !== 'suspended' && grant.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Grant is ${grant.status}; nothing to revoke.`);
  }
  const selfRelinquish = grant.granteeId === caller.uid;
  let actingGrant: RoleGrant | null = null;
  if (!selfRelinquish) {
    const ctx = await resolveCommandContext(
      caller,
      { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: grant.tenantId },
      true,
    );
    actingGrant = ctx.actingGrant;
    if (!actingGrant || !mayAuthorizeGrant(actingGrant.role, actingGrant.tenantId, grant.tenantId)) {
      throw new HttpsError('permission-denied', 'The acting grant does not authorize revoking grants in this scope.');
    }
  }
  const transition = validateGrantTransition(grant.status, 'revoked', caller.uid, grant);
  if (!transition.ok) throw new HttpsError('permission-denied', transition.reason);
  await db.runTransaction(async (tx) => {
    tx.update(ref, {
      status: 'revoked',
      reviewReason: data.reason ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: grant.granteeId,
      actorId: caller.uid,
      action: 'revokeRoleGrant',
      resourceType: 'roleGrant',
      resourceId: ref.id,
      actingRole: actingGrant?.role ?? 'self-relinquish',
      actingGrantId: actingGrant?.id ?? null,
      purpose,
      correlationId: ref.id,
      result: 'allowed',
      detail: { role: grant.role, reason: data.reason ?? null },
    });
  });
  // A pending invitation has no granteeId yet (''), so there are no
  // claims to sync — guard the lookup.
  if (grant.granteeId) await syncClaimsForUser(grant.granteeId);
  return { ok: true, grantId: ref.id, status: 'revoked' };
});

// ---------------------------------------------------------------------------
// declareConflict — a person declares a conflict (own declaration).
// ---------------------------------------------------------------------------

export const declareConflictFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    grantId?: string;
    description?: string;
    mitigation?: string;
    tenantId?: string;
    purpose?: string;
  };
  if (!data.description) {
    throw new HttpsError('invalid-argument', 'description is required.');
  }
  const purpose = validatePurpose(data.purpose, 'declare a conflict');
  const tenantId = data.tenantId ?? caller.claimsTenantId;
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required (pass it explicitly or sign in with a tenant claim).');
  }
  const ref = db.collection(CONFLICTS).doc();
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      declarerId: caller.uid,
      grantId: data.grantId ?? null,
      description: data.description,
      mitigation: data.mitigation ?? null,
      tenantId,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: caller.uid,
      actorId: caller.uid,
      action: 'declareConflict',
      resourceType: 'conflictDeclaration',
      resourceId: ref.id,
      actingRole: 'self',
      actingGrantId: null,
      purpose,
      correlationId: ref.id,
      result: 'allowed',
    });
  });
  return { ok: true, id: ref.id };
});

// ---------------------------------------------------------------------------
// Handoffs (minimal, Phase 2 slice shape)
// ---------------------------------------------------------------------------

export const createHandoffFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    workerId?: string;
    recipientId?: string;
    recipientRole?: string;
    purpose?: string;
    payloadSummary?: string;
    tenantId?: string;
    actingGrantId?: string | null;
    actingRole?: string | null;
    idempotencyKey?: string;
  };
  if (!data.workerId || !data.recipientId || !data.recipientRole || !data.purpose || !data.tenantId) {
    throw new HttpsError(
      'invalid-argument',
      'workerId, recipientId, recipientRole, purpose, tenantId are required.',
    );
  }
  // Narrowed locals (property narrowing does not survive awaits).
  const workerId = data.workerId;
  const recipientId = data.recipientId;
  const recipientRole = data.recipientRole;
  const handoffPurpose = data.purpose;
  const handoffTenantId = data.tenantId;
  const ctx = await resolveCommandContext(
    caller,
    { actingGrantId: data.actingGrantId ?? null, actingRole: data.actingRole ?? null, tenantId: handoffTenantId },
    true,
  );
  const actingGrant = ctx.actingGrant;
  // Sender roles come from the central command matrix (kernel.ts) —
  // there is exactly one list of handoff senders in the system.
  if (!actingGrant || !commandAllowsRole('createHandoff', actingGrant.role)) {
    throw new HttpsError(
      'permission-denied',
      'Only navigator, hubCoordinator, supervisor, or mentor grants may send handoffs.',
    );
  }
  const decision = authorizeCommand({
    authenticated: true,
    uid: caller.uid,
    actingGrant,
    claimsRoles: caller.claimsRoles,
    useClaimsFallback: false,
    command: 'createHandoff',
    highRisk: false,
    scope: { tenantId: handoffTenantId, scopeType: 'hub', scopeId: handoffTenantId },
    relationship: 'assigned',
    relationshipRequired: true,
    purpose: handoffPurpose,
    consentRequired: false,
    consentLive: null,
  });
  if (!decision.allowed) throw new HttpsError('permission-denied', decision.reason);
  // Relationship proof: an active assignment must link the sender to the
  // worker, unless the sender is the hub coordinator (member relationship
  // to the hub itself). The relationship is verified, never asserted.
  if (actingGrant.role !== 'hubCoordinator') {
    const assignmentSnap = await db
      .collection('assignments')
      .where('workerId', '==', workerId)
      .where('holderId', '==', caller.uid)
      .where('status', '==', 'active')
      .where('tenantId', '==', handoffTenantId)
      .limit(1)
      .get();
    if (assignmentSnap.empty) {
      throw new HttpsError(
        'permission-denied',
        'No active assignment links the sender to this worker.',
      );
    }
  }
  const parties = validateHandoffParties({
    workerId: workerId,
    senderId: caller.uid,
    recipientId: recipientId,
  });
  if (!parties.ok) throw new HttpsError('invalid-argument', parties.reason);
  // Recipient must hold a live grant for the recipient role in scope.
  const recipientGrants = await liveGrantsFor(recipientId);
  const recipientOk = recipientGrants.some(
    (g) => g.role === recipientRole && grantCoversScope(g, { tenantId: handoffTenantId, scopeType: 'hub', scopeId: handoffTenantId }),
  );
  if (!recipientOk) {
    throw new HttpsError(
      'failed-precondition',
      'The recipient does not hold a live grant for the recipient role in this scope.',
    );
  }
  const handoff: Omit<Handoff, 'id'> = {
    workerId: workerId,
    senderId: caller.uid,
    senderRole: actingGrant.role,
    recipientId: recipientId,
    recipientRole: recipientRole as AnyRole,
    purpose: handoffPurpose,
    payloadSummary: data.payloadSummary ?? '',
    tenantId: handoffTenantId,
    status: 'offered',
  };
  const ref = db.collection(HANDOFFS).doc();
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      ...handoff,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: workerId,
      actorId: caller.uid,
      action: 'createHandoff',
      resourceType: 'handoff',
      resourceId: ref.id,
      actingRole: actingGrant.role,
      actingGrantId: actingGrant.id ?? null,
      purpose: handoffPurpose,
      correlationId: data.idempotencyKey ?? ref.id,
      result: 'allowed',
      detail: { recipientRole: recipientRole },
    });
  });
  return { ok: true, handoffId: ref.id, status: 'offered' };
});

export const respondHandoffFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    handoffId?: string;
    decision?: 'accept' | 'decline';
    purpose?: string;
    actingGrantId?: string | null;
    actingRole?: string | null;
  };
  if (!data.handoffId || (data.decision !== 'accept' && data.decision !== 'decline')) {
    throw new HttpsError('invalid-argument', 'handoffId and decision accept|decline are required.');
  }
  const purpose = validatePurpose(data.purpose, 'respond to a handoff');
  const ref = db.collection(HANDOFFS).doc(data.handoffId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Handoff not found.');
  const h = snap.data() as Handoff & { status: Handoff['status'] };
  if (h.status !== 'offered') {
    throw new HttpsError('failed-precondition', `Handoff is ${h.status}, not offered.`);
  }
  // Only the RECIPIENT may respond (sender offers → recipient accepts).
  // The recipient is verified against a live grant for the recipient
  // role in the handoff's scope. The worker is the subject of the
  // handoff, not its responder.
  if (h.recipientId !== caller.uid) {
    throw new HttpsError('permission-denied', 'Only the handoff recipient may respond.');
  }
  const recipientGrants = await liveGrantsFor(caller.uid);
  const recipientGrant = recipientGrants.find(
    (g) =>
      g.role === h.recipientRole &&
      grantCoversScope(g, { tenantId: h.tenantId, scopeType: 'hub', scopeId: h.tenantId }),
  );
  if (!recipientGrant) {
    throw new HttpsError(
      'permission-denied',
      'The recipient does not hold a live grant for the recipient role in this scope.',
    );
  }
  const action = data.decision === 'accept' ? 'accept' : 'decline';
  const transition = transitionHandoff('offered', action);
  if (!transition.ok || !transition.to) {
    throw new HttpsError('failed-precondition', transition.reason);
  }
  await db.runTransaction(async (tx) => {
    tx.update(ref, { status: transition.to, updatedAt: FieldValue.serverTimestamp() });
    writeAccessEventInTx(tx, {
      subjectId: h.workerId,
      actorId: caller.uid,
      action: data.decision === 'accept' ? 'acceptHandoff' : 'declineHandoff',
      resourceType: 'handoff',
      resourceId: ref.id,
      actingRole: recipientGrant.role,
      actingGrantId: recipientGrant.id ?? null,
      purpose,
      correlationId: ref.id,
      result: 'allowed',
    });
  });
  return { ok: true, handoffId: ref.id, status: transition.to };
});

// ---------------------------------------------------------------------------
// closeHandoff — the recipient closes an offered or accepted handoff.
// The worker is the subject, not the closer. Closing writes the audit
// event; it does not itself remove access (access ends when the
// underlying consent is revoked or expires — the worker controls that).
// ---------------------------------------------------------------------------

export const closeHandoffFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as {
    handoffId?: string;
    purpose?: string;
    actingGrantId?: string | null;
    actingRole?: string | null;
  };
  if (!data.handoffId) {
    throw new HttpsError('invalid-argument', 'handoffId is required.');
  }
  const purpose = validatePurpose(data.purpose, 'handoff coordination');
  const ref = db.collection(HANDOFFS).doc(data.handoffId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Handoff not found.');
  const h = snap.data() as Handoff & { status: Handoff['status'] };
  if (h.status !== 'offered' && h.status !== 'accepted') {
    throw new HttpsError('failed-precondition', `Handoff is ${h.status}, not offered or accepted.`);
  }
  // Only the RECIPIENT may close (same rule as responding).
  if (h.recipientId !== caller.uid) {
    throw new HttpsError('permission-denied', 'Only the handoff recipient may close it.');
  }
  const recipientGrants = await liveGrantsFor(caller.uid);
  const recipientGrant = recipientGrants.find(
    (g) =>
      g.role === h.recipientRole &&
      grantCoversScope(g, { tenantId: h.tenantId, scopeType: 'hub', scopeId: h.tenantId }),
  );
  if (!recipientGrant) {
    throw new HttpsError(
      'permission-denied',
      'The recipient does not hold a live grant for the recipient role in this scope.',
    );
  }
  const transition = transitionHandoff(h.status, 'close');
  if (!transition.ok || !transition.to) {
    throw new HttpsError('failed-precondition', transition.reason);
  }
  await db.runTransaction(async (tx) => {
    tx.update(ref, { status: transition.to, updatedAt: FieldValue.serverTimestamp() });
    writeAccessEventInTx(tx, {
      subjectId: h.workerId,
      actorId: caller.uid,
      action: 'closeHandoff',
      resourceType: 'handoff',
      resourceId: ref.id,
      actingRole: recipientGrant.role,
      actingGrantId: recipientGrant.id ?? null,
      purpose,
      correlationId: ref.id,
      result: 'allowed',
    });
  });
  return { ok: true, handoffId: ref.id, status: transition.to };
});

// ---------------------------------------------------------------------------
// ensureMyPerson — claim pending invitations + ensure the caller's own
// persons doc, exactly once.
//
// Production onboarding (invitation model):
// 1. Claim: any PENDING invitation whose granteeEmail matches the
//    caller's Auth email is claimed in a transaction — granteeId is
//    set to the caller's uid and the status moves to active (or to
//    proposed when the invitation needs review). Expired invitations
//    are marked expired, never claimed. The transaction's
//    status re-check makes claiming exactly-once under concurrent
//    sign-ins: the first claim wins; a second caller finds no
//    pending invitation for that email.
// 2. Persons doc: created exactly once (transaction existence check).
//    Its tenantId comes from the first claimed grant, else from the
//    caller's claim tenant (a hint, not authority), else null — a
//    bare record with NO roles and NO tenant. A bare record confers
//    no access: the user exists but cannot act until the organisation
//    grants them a role (via a new invitation, claimed on next sign-in).
// 3. Claims sync: after a claim, claims are rebuilt from the now-live
//    grants so the session picks the roles up immediately.
//
// The persons doc is created by the SERVER (Admin SDK), not by the
// client: client creation of persons/users docs is denied by the
// rules. This callable is the one path that works for every sign-in.
// ---------------------------------------------------------------------------

export const ensureMyPersonFn = onCall(async (request) => {
  const caller = callerFrom(request);
  const data = (request.data ?? {}) as { purpose?: string };
  const purpose = validatePurpose(data.purpose, 'person record setup');
  const user = await getAuth().getUser(caller.uid);
  const displayName = user.displayName ?? '';
  const email = user.email ?? '';
  const emailLower = email.toLowerCase();
  const ref = db.collection(PERSONS).doc(caller.uid);
  // NOTE: `claimed` is built inside the transaction callback and
  // returned with it — never accumulated in a closure — because
  // Firestore may retry the callback on contention, and a closure
  // variable would duplicate entries across retries.
  const result = await db.runTransaction(async (tx) => {
    const claimedInTx: Array<{ grantId: string; role: string; tenantId: string }> = [];
    // Claim pending invitations for this email (re-checked inside the
    // transaction so concurrent sign-ins cannot double-claim).
    if (emailLower.length > 0) {
      const pendingSnap = await tx.get(
        db.collection(GRANTS)
          .where('granteeEmail', '==', emailLower)
          .where('status', '==', 'pending'),
      );
      for (const doc of pendingSnap.docs) {
        const inv = doc.data() as {
          role?: string;
          tenantId?: string;
          needsReview?: boolean;
          validUntil?: Timestamp | null;
        };
        const grantRef = db.collection(GRANTS).doc(doc.id);
        if (
          inv.validUntil &&
          typeof (inv.validUntil as Timestamp).toMillis === 'function' &&
          (inv.validUntil as Timestamp).toMillis() < Date.now()
        ) {
          // Expired invitation: mark it dead, never claim it.
          tx.update(grantRef, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
          continue;
        }
        const toStatus = inv.needsReview ? 'proposed' : 'active';
        tx.update(grantRef, {
          granteeId: caller.uid,
          status: toStatus,
          updatedAt: FieldValue.serverTimestamp(),
        });
        writeAccessEventInTx(tx, {
          subjectId: caller.uid,
          actorId: caller.uid,
          action: 'claimInvitation',
          resourceType: 'roleGrant',
          resourceId: doc.id,
          actingRole: 'self',
          actingGrantId: null,
          purpose: 'claim an invitation',
          correlationId: doc.id,
          result: 'allowed',
          detail: { role: inv.role ?? null, tenantId: inv.tenantId ?? null, toStatus },
        });
        claimedInTx.push({
          grantId: doc.id,
          role: typeof inv.role === 'string' ? inv.role : '',
          tenantId: typeof inv.tenantId === 'string' ? inv.tenantId : '',
        });
      }
    }
    const snap = await tx.get(ref);
    if (snap.exists) {
      // Adopt the claimed tenant onto a bare record (tenantId null)
      // so the persons doc reflects the user's organisation.
      if (claimedInTx.length > 0 && (snap.data()?.tenantId ?? null) === null) {
        tx.update(ref, {
          tenantId: claimedInTx[0].tenantId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { created: false, claimed: claimedInTx };
    }
    tx.set(ref, {
      displayName,
      email,
      tenantId: claimedInTx.length > 0 ? claimedInTx[0].tenantId : (caller.claimsTenantId ?? null),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAccessEventInTx(tx, {
      subjectId: caller.uid,
      actorId: caller.uid,
      action: 'ensurePerson',
      resourceType: 'person',
      resourceId: caller.uid,
      actingRole: 'self',
      actingGrantId: null,
      purpose,
      correlationId: caller.uid,
      result: 'allowed',
    });
    return { created: true, claimed: claimedInTx };
  });
  if (result.claimed.length > 0) {
    await syncClaimsForUser(caller.uid);
  }
  return { ok: true, ...result };
});

export { IDEMPOTENCY, ACCESS_EVENTS };

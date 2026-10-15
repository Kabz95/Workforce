import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import type {
  AccessEvent,
  AdaptationLog,
  Aggregate,
  Assignment,
  CertificationNavigation,
  Complaint,
  ConflictDeclaration,
  Consent,
  DeletionPassResult,
  DeletionRequest,
  Employer,
  FirstContactForm,
  GovernanceDecision,
  Handoff,
  Membership,
  Mentorship,
  Opportunity,
  OpportunityApplication,
  PathwayStep,
  ReadinessAssessment,
  RoleGrant,
  Aggregate,
  SupervisionSession,
  WithId,
  Worker,
} from './types';

/**
 * Typed Firestore helpers.
 *
 * HARD RULES (spec §8, enforced here by construction):
 * - Every query is tenant-scoped.
 * - Worker-owned data is queried only by ownerId == current user.
 * - No function lists worker records for anyone but their owner.
 * - Permission-denied errors are left to callers to render gracefully.
 * - The client NEVER writes a document's `sharedWith` array. Sharing is
 *   done only by the `grantAccess` Cloud Function (which verifies the
 *   live grant, the scope, and the caller's ownership of the target),
 *   and un-sharing only by the `onConsentRevoke` trigger / `expireConsents`.
 *   Security rules enforce this: client updates may not change `sharedWith`.
 * - The client NEVER writes audit / access-event entries. Access events
 *   are server-authored by Cloud Functions in the same transaction as
 *   the business change they record.
 * - Consequential commands send the caller's acting capacity
 *   (actingGrantId + actingRole) so the server can verify the live
 *   grant and stamp the access event. The server re-verifies; the
 *   client-sent values are a hint, never authority.
 * - Consequential commands carry a fresh idempotency key so a retried
 *   tap never double-applies.
 */

/** Acting-capacity context sent with consequential commands. */
export interface ActingInput {
  actingGrantId?: string | null;
  actingRole?: string | null;
  purpose?: string;
}

/** Fresh idempotency key for one command attempt. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toDoc<T extends DocumentData>(snap: QueryDocumentSnapshot): WithId<T> {
  return { id: snap.id, ...(snap.data() as T) };
}

// --- Workers (owner only) ---

export async function getMyWorker(uid: string, tenantId: string): Promise<WithId<Worker> | null> {
  const q = query(
    collection(db, 'workers'),
    where('ownerId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return toDoc<Worker>(snap.docs[0]);
}

export async function createWorker(
  uid: string,
  tenantId: string,
  displayName: string,
  status: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'workers'), {
    ownerId: uid,
    tenantId,
    displayName,
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateWorker(id: string, patch: Partial<Worker>): Promise<void> {
  await updateDoc(doc(db, 'workers', id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteWorker(id: string): Promise<void> {
  await deleteDoc(doc(db, 'workers', id));
}

// --- First-contact forms (owner only) ---

export async function listMyForms(uid: string, tenantId: string): Promise<WithId<FirstContactForm>[]> {
  const q = query(
    collection(db, 'firstContactForms'),
    where('ownerId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<FirstContactForm>(d));
}

export async function createForm(
  uid: string,
  tenantId: string,
  data: Omit<FirstContactForm, 'ownerId' | 'tenantId' | 'sharedWith' | 'createdAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'firstContactForms'), {
    ...data,
    ownerId: uid,
    tenantId,
    sharedWith: [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateForm(id: string, patch: Partial<FirstContactForm>): Promise<void> {
  await updateDoc(doc(db, 'firstContactForms', id), patch);
}

export async function deleteForm(id: string): Promise<void> {
  await deleteDoc(doc(db, 'firstContactForms', id));
}

// --- Pathway steps (owner only) ---

export async function listMyPathwaySteps(uid: string, tenantId: string): Promise<WithId<PathwayStep>[]> {
  const q = query(
    collection(db, 'pathwaySteps'),
    where('ownerId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<PathwayStep>(d));
}

export async function addPathwayStep(
  uid: string,
  tenantId: string,
  data: Pick<PathwayStep, 'type' | 'title' | 'status'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'pathwaySteps'), {
    ...data,
    ownerId: uid,
    tenantId,
    sharedWith: [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updatePathwayStep(id: string, patch: Partial<PathwayStep>): Promise<void> {
  await updateDoc(doc(db, 'pathwaySteps', id), patch);
}

export async function deletePathwayStep(id: string): Promise<void> {
  await deleteDoc(doc(db, 'pathwaySteps', id));
}

// --- Certification navigation (owner only) ---

export async function listMyCertNavigation(uid: string, tenantId: string): Promise<WithId<CertificationNavigation>[]> {
  const q = query(
    collection(db, 'certificationNavigation'),
    where('ownerId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<CertificationNavigation>(d));
}

export async function createCertNavigation(
  uid: string,
  tenantId: string,
  data: Pick<CertificationNavigation, 'notes' | 'checklist'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'certificationNavigation'), {
    ...data,
    ownerId: uid,
    tenantId,
    sharedWith: [],
  });
  return ref.id;
}

// --- Consents ---

export async function listMyConsents(uid: string, tenantId: string): Promise<WithId<Consent>[]> {
  const q = query(
    collection(db, 'consents'),
    where('granterId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Consent>(d));
}

const SHAREABLE_COLLECTIONS: Record<string, string> = {
  firstContactForms: 'firstContactForms',
  pathwaySteps: 'pathwaySteps',
  certificationNavigation: 'certificationNavigation',
  // Phase 2: supervision sessions are shareable (the supervisor reads
  // ONLY through a live worker consent — see the rules block).
  supervisionSessions: 'supervisionSessions',
  // Phase 2 completion: mentorships are shareable the same way —
  // participants OR consented readers, tenant-scoped.
  mentorships: 'mentorships',
};

const grantAccess = httpsCallable(functions, 'grantAccess');
const requestExportFn = httpsCallable(functions, 'requestExport');
const requestDeletionFn = httpsCallable(functions, 'requestDeletion');
const processDeletionFn = httpsCallable(functions, 'processDeletion');
const ensureMyPersonFn = httpsCallable(functions, 'ensureMyPerson');
const requestRoleGrantFn = httpsCallable(functions, 'requestRoleGrant');
const declareConflictFn = httpsCallable(functions, 'declareConflict');
const createHandoffFn = httpsCallable(functions, 'createHandoff');
const respondHandoffFn = httpsCallable(functions, 'respondHandoff');
const closeHandoffFn = httpsCallable(functions, 'closeHandoff');
const inviteMemberFn = httpsCallable(functions, 'inviteMember');
const createSupervisionSessionFn = httpsCallable(functions, 'createSupervisionSession');
const createMentorshipFn = httpsCallable(functions, 'createMentorship');
const askSupportAgentFn = httpsCallable(functions, 'askSupportAgent');
const submitSupportFeedbackFn = httpsCallable(functions, 'submitSupportFeedback');

export async function grantConsent(
  granterId: string,
  tenantId: string,
  data: {
    granteeId: string;
    scope: string;
    resourceType: string;
    resourceId: string;
    expiresAt: Date;
    purpose: string;
  },
  acting?: ActingInput,
): Promise<string> {
  if (!SHAREABLE_COLLECTIONS[data.resourceType] || !data.resourceId) {
    throw new Error('Grants are per-document: a specific record ID is required.');
  }
  const ref = await addDoc(collection(db, 'consents'), {
    granterId,
    granteeId: data.granteeId,
    tenantId,
    scope: data.scope,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    grantedAt: serverTimestamp(),
    expiresAt: data.expiresAt,
    revokedAt: null,
    purpose: data.purpose,
  });
  // Activate sharing through the grantAccess Function — the ONLY path
  // that touches sharedWith. If activation fails, roll back the grant
  // record so no dead grant lingers.
  try {
    await grantAccess({
      consentId: ref.id,
      actingGrantId: acting?.actingGrantId ?? null,
      actingRole: acting?.actingRole ?? null,
      purpose: acting?.purpose ?? data.purpose,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (err) {
    await deleteDoc(ref);
    throw err;
  }
  return ref.id;
}

export async function revokeConsent(
  consent: WithId<Consent>,
): Promise<void> {
  // Only the grant record changes. The onConsentRevoke trigger strips
  // the grantee from the target's sharedWith and writes the access
  // event. The client never writes audit entries.
  await updateDoc(doc(db, 'consents', consent.id), { revokedAt: serverTimestamp() });
}

/** Export all of the caller's own data (returns a 7-day download URL). */
export async function requestMyExport(acting?: ActingInput): Promise<string> {
  const result = await requestExportFn({
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'export my data',
    idempotencyKey: newIdempotencyKey(),
  });
  return (result.data as { url: string }).url;
}

/** Delete all of the caller's own data (anonymises shared records).
 *  Creates (or resumes) a resumable deletion job; returns its id. */
export async function requestMyDeletion(acting?: ActingInput): Promise<DeletionPassResult> {
  const result = await requestDeletionFn({
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'delete my data',
    idempotencyKey: newIdempotencyKey(),
  });
  return result.data as DeletionPassResult;
}

/** Advance one deletion job by one bounded pass. */
export async function processDeletion(requestId: string, acting?: ActingInput): Promise<DeletionPassResult> {
  const result = await processDeletionFn({
    requestId,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'delete my data',
    idempotencyKey: newIdempotencyKey(),
  });
  return result.data as DeletionPassResult;
}

/** Read one deletion job (owner only — rules enforce this). */
export async function getDeletionRequest(requestId: string): Promise<WithId<DeletionRequest> | null> {
  const snap = await getDoc(doc(db, 'deletionRequests', requestId));
  if (!snap.exists()) return null;
  return toDoc<DeletionRequest>(snap);
}

/** Create the caller's own persons doc, exactly once (server-side),
 *  and claim any pending invitations for the caller's email.
 *  Called once per session from AuthContext after sign-in. */
export async function ensureMyPerson(acting?: ActingInput): Promise<{
  created: boolean;
  claimed: Array<{ grantId: string; role: string; tenantId: string }>;
}> {
  const result = await ensureMyPersonFn({
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'person record setup',
  });
  return result.data as {
    created: boolean;
    claimed: Array<{ grantId: string; role: string; tenantId: string }>;
  };
}

// --- Role grants, conflicts, handoffs (Role Kernel) ---

/** Request a role grant (creates a 'proposed' grant for an authorizer).
 *  Shape matches the gateway requestRoleGrant callable. */
export async function requestRoleGrant(
  data: {
    role: string;
    scopeType: string;
    scopeId: string;
    tenantId: string;
    validUntil?: string;
    justification?: string;
  },
  acting?: ActingInput,
): Promise<void> {
  await requestRoleGrantFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'request a role grant',
    idempotencyKey: newIdempotencyKey(),
  });
}

/**
 * Invite a member by email (creates a PENDING invitation).
 * Coordinator/backboneLead only (enforced server-side). The
 * invitation confers nothing until the invitee signs in with that
 * email and ensureMyPerson claims it.
 */
export async function inviteMember(
  data: {
    granteeEmail: string;
    role: string;
    scopeType: string;
    scopeId: string;
    tenantId: string;
    validUntil?: string;
    basis: string;
  },
  acting?: ActingInput,
): Promise<{ ok: boolean; grantId: string; status: string; duplicate?: boolean; needsReview?: boolean }> {
  const result = await inviteMemberFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'invite a member',
  });
  return result.data as {
    ok: boolean;
    grantId: string;
    status: string;
    duplicate?: boolean;
    needsReview?: boolean;
  };
}

/** Declare a conflict of interest (gateway declareConflict shape). */
export async function declareConflict(
  data: { grantId?: string; description: string; mitigation?: string; tenantId: string },
  acting?: ActingInput,
): Promise<void> {
  await declareConflictFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'declare a conflict',
    idempotencyKey: newIdempotencyKey(),
  });
}

/** Offer a handoff to another role-holder (sender must be assigned). */
export async function createHandoff(
  data: {
    workerId: string;
    recipientId: string;
    recipientRole: string;
    purpose: string;
    payloadSummary?: string;
    tenantId: string;
  },
  acting?: ActingInput,
): Promise<void> {
  await createHandoffFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: data.purpose,
    idempotencyKey: newIdempotencyKey(),
  });
}

/** Accept or decline a handoff addressed to the caller.
 *  Gateway decisions are 'accept' | 'decline'. */
export async function respondHandoff(
  data: { handoffId: string; decision: 'accept' | 'decline' },
  acting?: ActingInput,
): Promise<void> {
  await respondHandoffFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'respond to a handoff',
    idempotencyKey: newIdempotencyKey(),
  });
}

/** Close an offered or accepted handoff (recipient only). */
export async function closeHandoff(
  data: { handoffId: string },
  acting?: ActingInput,
): Promise<void> {
  await closeHandoffFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'handoff coordination',
    idempotencyKey: newIdempotencyKey(),
  });
}

/** Handoffs where the caller is the worker, the sender, or the recipient. */
export async function listMyHandoffs(uid: string, tenantId: string): Promise<WithId<Handoff>[]> {
  const asWorker = await getDocs(
    query(
      collection(db, 'handoffs'),
      where('workerId', '==', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  const asSender = await getDocs(
    query(
      collection(db, 'handoffs'),
      where('senderId', '==', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  const asRecipient = await getDocs(
    query(
      collection(db, 'handoffs'),
      where('recipientId', '==', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  const byId = new Map<string, WithId<Handoff>>();
  for (const d of [...asWorker.docs, ...asSender.docs, ...asRecipient.docs]) byId.set(d.id, toDoc<Handoff>(d));
  return [...byId.values()];
}

/**
 * Create a supervision session through the Kernel-governed callable.
 * The caller is the session owner (the worker); the supervisor is
 * named by UID and must hold a live supervisor grant in the tenant.
 */
export async function createSupervisionSession(
  data: { supervisorId: string; tenantId: string; notes?: string; dateMs?: number },
  acting?: ActingInput,
): Promise<string> {
  const result = await createSupervisionSessionFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'supervision reflection',
    idempotencyKey: newIdempotencyKey(),
  });
  return (result.data as { sessionId: string }).sessionId;
}

/**
 * Create a mentorship pair through the Kernel-governed callable.
 * The caller must be one of the two participants.
 */
export async function createMentorship(
  data: { participantIds: [string, string]; tenantId: string; notes?: string },
  acting?: ActingInput,
): Promise<string> {
  const result = await createMentorshipFn({
    ...data,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
    purpose: acting?.purpose ?? 'peer mentorship',
    idempotencyKey: newIdempotencyKey(),
  });
  return (result.data as { mentorshipId: string }).mentorshipId;
}

/** Supervision sessions the caller owns (worker view). */
export async function listMySupervisionSessions(uid: string, tenantId: string): Promise<WithId<SupervisionSession>[]> {
  const snap = await getDocs(
    query(
      collection(db, 'supervisionSessions'),
      where('ownerId', '==', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  return snap.docs.map((d) => toDoc<SupervisionSession>(d));
}

/** Supervision sessions shared WITH the caller (supervisor view — consent only). */
export async function listSharedSupervisionSessions(uid: string, tenantId: string): Promise<WithId<SupervisionSession>[]> {
  const snap = await getDocs(
    query(
      collection(db, 'supervisionSessions'),
      where('sharedWith', 'array-contains', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  return snap.docs.map((d) => toDoc<SupervisionSession>(d));
}

/** Mentorships where the caller is a participant. */
export async function listMyMentorships(uid: string, tenantId: string): Promise<WithId<Mentorship>[]> {
  const snap = await getDocs(
    query(
      collection(db, 'mentorships'),
      where('participantIds', 'array-contains', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  return snap.docs.map((d) => toDoc<Mentorship>(d));
}

/** Assignments where the caller is the worker or the holder (picker source). */
export async function listMyAssignments(uid: string, tenantId: string): Promise<WithId<Assignment>[]> {
  const asWorker = await getDocs(
    query(
      collection(db, 'assignments'),
      where('workerId', '==', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  const asHolder = await getDocs(
    query(
      collection(db, 'assignments'),
      where('holderId', '==', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  const byId = new Map<string, WithId<Assignment>>();
  for (const d of [...asWorker.docs, ...asHolder.docs]) byId.set(d.id, toDoc<Assignment>(d));
  return [...byId.values()];
}

/** Consents where the caller is the grantee (what was shared WITH me). */
export async function listConsentsReceived(uid: string, tenantId: string): Promise<WithId<Consent>[]> {
  const q = query(
    collection(db, 'consents'),
    where('granteeId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Consent>(d));
}

/** First-contact forms shared WITH the caller (navigator's intake queue).
 *  The caller sees only forms a worker consented to share with them. */
export async function listSharedFirstContactForms(uid: string, tenantId: string): Promise<WithId<FirstContactForm>[]> {
  const q = query(
    collection(db, 'firstContactForms'),
    where('sharedWith', 'array-contains', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<FirstContactForm>(d));
}

/** Pathway steps shared WITH the caller (navigator's pathway view). */
export async function listSharedPathwaySteps(uid: string, tenantId: string): Promise<WithId<PathwayStep>[]> {
  const q = query(
    collection(db, 'pathwaySteps'),
    where('sharedWith', 'array-contains', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<PathwayStep>(d));
}

/** The caller's own conflict declarations. */
export async function listMyConflicts(uid: string, tenantId: string): Promise<WithId<ConflictDeclaration>[]> {
  const q = query(
    collection(db, 'conflictDeclarations'),
    where('declarerId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<ConflictDeclaration>(d));
}

/** The caller's own role grants (read from Firestore; the server's
 *  getMyGrants callable is the authoritative source used by AuthContext). */
export async function listMyRoleGrants(uid: string, tenantId: string): Promise<WithId<RoleGrant>[]> {
  const q = query(
    collection(db, 'roleGrants'),
    where('granteeId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<RoleGrant>(d));
}

// --- Opportunities (tenant-scoped) ---

export async function listOpportunities(tenantId: string): Promise<WithId<Opportunity>[]> {
  const q = query(collection(db, 'opportunities'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Opportunity>(d));
}

export async function applyToOpportunity(
  uid: string,
  tenantId: string,
  opportunity: WithId<Opportunity>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'opportunityApplications'), {
    ownerId: uid,
    tenantId,
    opportunityId: opportunity.id,
    employerId: opportunity.employerId,
    status: 'submitted',
    sharedWith: [],
  });
  return ref.id;
}

export async function listApplicationsForEmployer(
  employerId: string,
  tenantId: string,
): Promise<WithId<OpportunityApplication>[]> {
  const q = query(
    collection(db, 'opportunityApplications'),
    where('employerId', '==', employerId),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<OpportunityApplication>(d));
}

export async function listMyApplications(uid: string, tenantId: string): Promise<WithId<OpportunityApplication>[]> {
  const q = query(
    collection(db, 'opportunityApplications'),
    where('ownerId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<OpportunityApplication>(d));
}

// --- Employers + readiness ---

export async function getMyEmployer(uid: string, tenantId: string): Promise<WithId<Employer> | null> {
  const q = query(
    collection(db, 'employers'),
    where('ownerId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return toDoc<Employer>(snap.docs[0]);
}

export async function createEmployer(
  uid: string,
  tenantId: string,
  orgName: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'employers'), {
    ownerId: uid,
    tenantId,
    orgName,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function submitReadiness(
  employerId: string,
  tenantId: string,
  answers: Record<string, string>,
  gateOutcome: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'readinessAssessments'), {
    employerId,
    tenantId,
    answers,
    gateOutcome,
  });
  return ref.id;
}

export async function listMyReadiness(employerId: string, tenantId: string): Promise<WithId<ReadinessAssessment>[]> {
  const q = query(
    collection(db, 'readinessAssessments'),
    where('employerId', '==', employerId),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<ReadinessAssessment>(d));
}

// --- Governance ---

export async function listGovernanceDecisions(tenantId: string): Promise<WithId<GovernanceDecision>[]> {
  const q = query(
    collection(db, 'governanceDecisions'),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<GovernanceDecision>(d));
}

export async function fileComplaint(
  uid: string,
  tenantId: string,
  summary: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'complaints'), {
    tenantId,
    complainantId: uid,
    summary,
    status: 'open',
  });
  return ref.id;
}

// --- Aggregates (analyst / governance only) ---

export async function listAggregates(tenantId: string): Promise<WithId<Aggregate>[]> {
  const q = query(collection(db, 'aggregates'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Aggregate>(d));
}

// --- Access events (subject sees own entries only) ---
// Server-authored; the client only reads its own entries.

export async function listMyAuditLogs(uid: string): Promise<WithId<AccessEvent>[]> {
  const q = query(collection(db, 'accessEvents'), where('subjectId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<AccessEvent>(d));
}

// --- Hub coordination (authoriser reads; tenant-scoped) ---
// The hub coordinator sees grants, memberships, assignments, conflicts
// and adaptation logs for their hub — NEVER worker records. Rules
// enforce the authoriser + tenant pin on every one of these lists.

/** All role grants in the hub (authoriser read). */
export async function listHubRoleGrants(tenantId: string): Promise<WithId<RoleGrant>[]> {
  const q = query(collection(db, 'roleGrants'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<RoleGrant>(d));
}

/** All memberships in the hub (authoriser read). */
export async function listHubMemberships(tenantId: string): Promise<WithId<Membership>[]> {
  const q = query(collection(db, 'memberships'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Membership>(d));
}

/** All assignments in the hub (hubCoordinator read). */
export async function listHubAssignments(tenantId: string): Promise<WithId<Assignment>[]> {
  const q = query(collection(db, 'assignments'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Assignment>(d));
}

/** All conflict declarations in the hub (authoriser read). */
export async function listHubConflicts(tenantId: string): Promise<WithId<ConflictDeclaration>[]> {
  const q = query(collection(db, 'conflictDeclarations'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<ConflictDeclaration>(d));
}

/** Adaptation logs in the hub (safety procedures / local adaptations). */
export async function listAdaptationLogs(tenantId: string): Promise<WithId<AdaptationLog>[]> {
  const q = query(collection(db, 'adaptationLogs'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<AdaptationLog>(d));
}

export interface SupportSource {
  id: string;
  title: string;
  route: string;
  version: string;
}

export interface SupportResource {
  name: string;
  detail: string;
}

export interface SupportAnswerResult {
  answer: string;
  category: string;
  outcome: string;
  sources: SupportSource[];
  route: string;
  vertexUsed: boolean;
  resources: SupportResource[];
}

/**
 * Ask the app support assistant (Phase 3, P3.1). Record-blind: the
 * server never receives or stores the question text beyond answering
 * it — the audit event carries category + outcome only. The client
 * sends the question and an optional sanitized error code (no stack
 * traces, no record content).
 */
export async function askSupportAgent(
  question: string,
  acting?: ActingInput & { errorCode?: string },
): Promise<SupportAnswerResult> {
  const result = await askSupportAgentFn({
    question,
    errorCode: acting?.errorCode ?? null,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
  });
  return result.data as SupportAnswerResult;
}

/** Helpful / not-helpful for a support answer. Category + boolean only — no text. */
export async function submitSupportFeedback(
  helpful: boolean,
  category: string,
  acting?: ActingInput,
): Promise<void> {
  await submitSupportFeedbackFn({
    helpful,
    category,
    actingGrantId: acting?.actingGrantId ?? null,
    actingRole: acting?.actingRole ?? null,
  });
}

// --- Phase 3: Supervisor / Mentor / PrivacyLead dashboards --
// Every query stays inside the caller's own data or what the rules
// explicitly permit for the acting role:
// - Supervision sessions: sharedWith only (consent), never via
//   supervisorId. The supervisorId link confers no read.
// - Mentorships: participantIds (the relationship) or sharedWith
//   (consent). No hub-wide mentorship view exists.
// - Assignments: the caller's own assignments (holderId), filtered
//   to the role client-side — no cross-holder listing.
// - Access events: privacyLead hub-wide (rules: isPrivacyLead +
//   tenant). This is audit oversight, not an activity feed: the
//   dashboard shows aggregates + recent denials, never a live feed.
// - Complaints: privacyLead (canAuthorise + tenant) — the queue
//   the privacy lead is designated to handle.
// - There is deliberately NO hub-wide consent listing: the consent
//   rules allow only granter / grantee reads. Privacy oversight of
//   consent is via access-event aggregates + published aggregates,
//   never by enumerating other people's consent records.
//
// listSharedSupervisionSessions + listMyMentorships are Engineer 3's
// implementations (shared with the supervision/mentorship branch);
// the other four are this branch's additions.

/** Supervision sessions shared WITH the caller (supervisor view — consent only). */
export async function listSharedSupervisionSessions(uid: string, tenantId: string): Promise<WithId<SupervisionSession>[]> {
  const snap = await getDocs(
    query(
      collection(db, 'supervisionSessions'),
      where('sharedWith', 'array-contains', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  return snap.docs.map((d) => toDoc<SupervisionSession>(d));
}

/** Mentorships where the caller is a participant. */
export async function listMyMentorships(uid: string, tenantId: string): Promise<WithId<Mentorship>[]> {
  const snap = await getDocs(
    query(
      collection(db, 'mentorships'),
      where('participantIds', 'array-contains', uid),
      where('tenantId', '==', tenantId),
    ),
  );
  return snap.docs.map((d) => toDoc<Mentorship>(d));
}

/** The caller's own assignments for one role (supervisor / mentor). */
export async function listMyAssignmentsForRole(
  uid: string,
  tenantId: string,
  role: 'mentor' | 'navigator' | 'supervisor' | 'facilitator',
): Promise<WithId<Assignment>[]> {
  const q = query(
    collection(db, 'assignments'),
    where('holderId', '==', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Assignment>(d)).filter((a) => a.role === role);
}

/** Mentorships shared WITH the caller by consent (not a participant). */
export async function listSharedMentorships(uid: string, tenantId: string): Promise<WithId<Mentorship>[]> {
  const q = query(
    collection(db, 'mentorships'),
    where('sharedWith', 'array-contains', uid),
    where('tenantId', '==', tenantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Mentorship>(d));
}

/** All access events in the hub (privacyLead audit oversight). */
export async function listHubAccessEvents(tenantId: string): Promise<WithId<AccessEvent>[]> {
  const q = query(collection(db, 'accessEvents'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<AccessEvent>(d));
}

/** All complaints in the hub (privacyLead queue). */
export async function listHubComplaints(tenantId: string): Promise<WithId<Complaint>[]> {
  const q = query(collection(db, 'complaints'), where('tenantId', '==', tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<Complaint>(d));
}

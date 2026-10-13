import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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
  AuditLog,
  CertificationNavigation,
  Complaint,
  Consent,
  Employer,
  FirstContactForm,
  GovernanceDecision,
  Opportunity,
  OpportunityApplication,
  PathwayStep,
  ReadinessAssessment,
  Aggregate,
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
 */

function toDoc<T extends DocumentData>(snap: QueryDocumentSnapshot): WithId<T> {
  return { id: snap.id, ...(snap.data() as T) };
}

/** Append an audit entry. Best-effort: failures are swallowed by callers. */
export async function writeAuditEntry(
  entry: Omit<AuditLog, 'createdAt'>,
): Promise<void> {
  await addDoc(collection(db, 'auditLogs'), {
    ...entry,
    createdAt: serverTimestamp(),
  });
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
};

const grantAccess = httpsCallable(functions, 'grantAccess');
const requestExportFn = httpsCallable(functions, 'requestExport');
const requestDeletionFn = httpsCallable(functions, 'requestDeletion');

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
    await grantAccess({ consentId: ref.id });
  } catch (err) {
    await deleteDoc(ref);
    throw err;
  }
  return ref.id;
}

export async function revokeConsent(
  consent: WithId<Consent>,
  actorId: string,
): Promise<void> {
  // Only the grant record changes. The onConsentRevoke trigger strips
  // the grantee from the target's sharedWith and audits the revocation.
  await updateDoc(doc(db, 'consents', consent.id), { revokedAt: serverTimestamp() });
  await writeAuditEntry({
    subjectId: consent.granterId,
    actorId,
    action: 'consent-revoked',
    resourceType: consent.resourceType,
    resourceId: consent.resourceId,
  });
}

/** Export all of the caller's own data (returns a 7-day download URL). */
export async function requestMyExport(): Promise<string> {
  const result = await requestExportFn({});
  return (result.data as { url: string }).url;
}

/** Delete all of the caller's own data (anonymises shared records). */
export async function requestMyDeletion(): Promise<void> {
  await requestDeletionFn({});
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

// --- Audit log (subject sees own entries only) ---

export async function listMyAuditLogs(uid: string): Promise<WithId<AuditLog>[]> {
  const q = query(collection(db, 'auditLogs'), where('subjectId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc<AuditLog>(d));
}

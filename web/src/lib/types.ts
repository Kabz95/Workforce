import type { Timestamp } from 'firebase/firestore';

/** Role strings from Auth custom claims (spec §3.3). */
export type Role =
  | 'worker'
  | 'navigator'
  | 'supervisor'
  | 'employer'
  | 'hubAdmin'
  | 'governance'
  | 'backboneAnalyst'
  | 'systemAdmin';

export type WithId<T> = T & { id: string };

export interface Tenant {
  name: string;
  region: string;
  createdAt: Timestamp;
}

export interface UserProfile {
  displayName: string;
  email: string;
  tenantId: string;
  roles: Role[];
  createdAt: Timestamp;
}

export interface Worker {
  ownerId: string;
  tenantId: string;
  displayName: string;
  status: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FirstContactForm {
  ownerId: string;
  tenantId: string;
  sharedWith: string[];
  contactName: string;
  contactMethod: string;
  needs: string;
  notes: string;
  createdAt: Timestamp;
}

export interface PathwayStep {
  ownerId: string;
  tenantId: string;
  type: string;
  title: string;
  status: 'not-started' | 'in-progress' | 'done' | 'paused';
  sharedWith: string[];
  createdAt: Timestamp;
}

export interface CertificationNavigation {
  ownerId: string;
  tenantId: string;
  sharedWith: string[];
  notes: string;
  checklist: string[];
}

export interface Opportunity {
  tenantId: string;
  employerId: string;
  title: string;
  description: string;
  location: string;
  createdAt: Timestamp;
}

export interface OpportunityApplication {
  ownerId: string;
  tenantId: string;
  opportunityId: string;
  employerId: string;
  status: 'submitted' | 'reviewed' | 'accepted' | 'declined' | 'withdrawn';
  sharedWith: string[];
}

export interface Mentorship {
  tenantId: string;
  participantIds: string[];
  sharedWith: string[];
  notes: string;
}

export interface SupervisionSession {
  ownerId: string;
  tenantId: string;
  supervisorId: string;
  sharedWith: string[];
  notes: string;
  date: Timestamp;
}

export interface Employer {
  ownerId: string;
  tenantId: string;
  orgName: string;
  createdAt: Timestamp;
}

export interface ReadinessAssessment {
  employerId: string;
  tenantId: string;
  answers: Record<string, string>;
  gateOutcome: string;
}

export interface GovernanceDecision {
  tenantId: string;
  title: string;
  body: string;
  decidedAt: Timestamp;
  decidedBy: string;
}

export interface Complaint {
  tenantId: string;
  complainantId: string;
  summary: string;
  status: 'open' | 'in-review' | 'resolved' | 'closed';
}

export interface AdaptationLog {
  tenantId: string;
  authorId: string;
  changeDescription: string;
  coreOrForm: string;
  rationale: string;
}

export interface EvaluationSubmission {
  ownerId: string;
  tenantId: string;
  responses: Record<string, string>;
}

export interface Aggregate {
  tenantId: string;
  metric: string;
  period: string;
  value: number;
  breakdown: Record<string, number>;
}

export interface Consent {
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

export interface AuditLog {
  subjectId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: Timestamp;
}

export interface DeletionRequest {
  ownerId: string;
  tenantId: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  createdAt: Timestamp;
}

export type FirestoreErrorLike = {
  code?: string;
  message: string;
};

export function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as FirestoreErrorLike).code === 'permission-denied'
  );
}

export function friendlyError(err: unknown): string {
  if (isPermissionDenied(err)) {
    return 'Access denied. You do not have permission to view or change this record.';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  try {
    return ts.toDate().toLocaleDateString();
  } catch {
    return '—';
  }
}

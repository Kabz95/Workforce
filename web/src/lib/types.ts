import type { Timestamp } from 'firebase/firestore';

/**
 * Canonical Role Capacities (13) + Operational capacity.
 * Circular system: the peer worker is the centre; rings are function, not rank.
 */
export type CanonicalRoleId =
  | 'worker'
  | 'mentor'
  | 'supervisor'
  | 'navigator'
  | 'facilitator'
  | 'hubCoordinator'
  | 'privacyLead'
  | 'steeringCircle'
  | 'council'
  | 'backboneLead'
  | 'analyst'
  | 'researcher'
  | 'employer'
  | 'systemAdmin'; // Operational capacity only: time-limited, audited

/** Backward-compatibility alias for claims during Phase 1 migration. */
export type LegacyRole =
  | 'hubAdmin'
  | 'governance'
  | 'backboneAnalyst';

export type Role = CanonicalRoleId | LegacyRole;

export type WithId<T> = T & { id: string };

export interface Tenant {
  name: string;
  region: string;
  createdAt: Timestamp;
}

export interface Person {
  authUid: string;
  email: string;
  displayName: string;
  tenantId: string;
  contactPreference?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RoleCatalogEntry {
  roleId: CanonicalRoleId;
  title: string;
  charter: string;
  ring: 'centre' | 'directSupport' | 'practice' | 'hubAccountability' | 'national' | 'intelligence' | 'boundary' | 'operational';
  boundaries: string[];
  minimumProtections: string[];
  version: string;
}

export type GrantStatus = 'proposed' | 'active' | 'expired' | 'revoked' | 'suspended';

export interface RoleGrant {
  personId: string;
  authUid: string;
  role: CanonicalRoleId;
  circle: 'hub' | 'national' | 'boundary' | 'operational';
  jurisdictionScope: string;
  term: {
    validFrom: Timestamp;
    validUntil: Timestamp;
  };
  authorizedBy: string;
  status: GrantStatus;
  recusals?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Membership {
  personId: string;
  circleId: string;
  circleType: 'hub' | 'nationalNetwork' | 'communityOfPractice';
  roleInCircle: string;
  joinedAt: Timestamp;
  status: 'active' | 'inactive' | 'resigned';
}

export interface Assignment {
  workerPersonId: string;
  roleHolderPersonId: string;
  role: 'mentor' | 'supervisor' | 'navigator';
  tenantId: string;
  status: 'active' | 'completed' | 'paused';
  assignedAt: Timestamp;
  endsAt?: Timestamp;
}

export interface ConflictDeclaration {
  personId: string;
  roleGrantId: string;
  description: string;
  mitigationStrategy: string;
  status: 'declared' | 'mitigated' | 'recused';
  declaredAt: Timestamp;
}

export interface AccessEvent {
  actingRoleGrantId: string;
  actorId: string;
  subjectId?: string;
  role: CanonicalRoleId;
  scope: string;
  purpose: string;
  correlationId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  timestamp: Timestamp;
}

export interface MinimalHandoff {
  workerId: string;
  tenantId: string;
  fromRole: CanonicalRoleId;
  toRole: CanonicalRoleId;
  recipientPersonId?: string;
  purpose: string;
  payloadSummary: string;
  status: 'draft' | 'pending_worker_review' | 'accepted' | 'declined' | 'closed';
  createdAt: Timestamp;
  acceptedAt?: Timestamp;
  closedAt?: Timestamp;
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
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes('auth/popup-blocked')) {
      return 'Popup was blocked by the browser. Please allow popups for this window and try again.';
    }
    if (msg.includes('auth/unauthorized-domain')) {
      return 'This web domain is not yet authorized in Firebase Authentication (Firebase Console > Auth > Settings > Authorized domains).';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'This email address is already registered. Please switch to "Sign in".';
    }
    if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
      return 'Incorrect email or password.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'Password should be at least 6 characters.';
    }
    if (msg.includes('auth/invalid-email')) {
      return 'Please enter a valid email address.';
    }
    return msg;
  }
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

// ==========================================
// PHASE 3: EXPANSION & SUPPORT TYPES
// ==========================================

export type EscalationLaneId =
  | 'account'
  | 'privacy'
  | 'governance'
  | 'safeguarding'
  | 'employment'
  | 'technical';

export interface HelpArticle {
  title: string;
  summary: string;
  content: string;
  category: 'roles' | 'governance' | 'pathway' | 'supervision' | 'practice' | 'learning' | 'safeguarding' | 'technical';
  audience: 'all' | 'worker' | 'supervisor' | 'mentor' | 'facilitator' | 'navigator' | 'privacyLead' | 'employer' | 'governance';
  jurisdiction: 'national' | 'qc' | 'on' | 'bc' | 'ab';
  version: string;
  status: 'draft' | 'in-review' | 'published' | 'archived';
  authorCircle?: string;
  tags?: string[];
  publishedAt?: Timestamp;
}

export interface SafeSupportContextEnvelope {
  canonicalRoleId: CanonicalRoleId;
  currentRoute: string;
  appVersion: string;
  sanitizedErrorCode?: string;
  languagePreference: 'en' | 'fr';
  query: string;
}

export interface SupportCitation {
  articleId: string;
  title: string;
  version: string;
  category?: string;
  audience?: string;
  section?: string;
  url?: string;
}

export interface SupportEscalationRoute {
  lane: EscalationLaneId;
  label: string;
  targetUrl: string;
  urgentNotice?: string;
}

export interface SupportAgentResponse {
  answer: string;
  grounded: boolean;
  citations: SupportCitation[];
  escalationRoute?: SupportEscalationRoute;
  suggestedFollowUps: string[];
}

export interface CircularAgreement {
  title: string;
  type: 'supervision' | 'mentorship' | 'cop' | 'hubCommitment';
  participantIds: string[];
  participantNames?: string[];
  tenantId: string;
  status: 'draft' | 'active' | 'in-review' | 'completed' | 'terminated';
  terms: string;
  reviewDate?: Timestamp;
  effectiveFrom: Timestamp;
  effectiveUntil: Timestamp;
  createdAt: Timestamp;
}

export interface WorkQueueItem {
  title: string;
  type: 'escalation' | 'agreement_review' | 'adaptation_proposal' | 'audit_check';
  lane: EscalationLaneId;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assigneePersonId?: string;
  assigneeRole?: CanonicalRoleId;
  sourceRoute?: string;
  sanitizedErrorCode?: string;
  correlationId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface NotificationItem {
  recipientPersonId: string;
  title: string;
  message: string;
  linkPath: string;
  read: boolean;
  createdAt: Timestamp;
}

export interface DecisionRecord {
  title: string;
  circle: 'nationalCouncil' | 'steeringCircle' | 'hubCircle' | 'copCircle';
  context: string;
  decisionText: string;
  authority: string;
  appealStatus: 'none' | 'pending' | 'heard' | 'dismissed';
  decidedAt: Timestamp;
}

export interface Adaptation {
  title: string;
  hubId: string;
  authorId: string;
  authorName?: string;
  coreOrForm: 'form' | 'core';
  rationale: string;
  status: 'proposed' | 'under_review' | 'accepted' | 'archived';
  submittedAt: Timestamp;
}

export interface ExceptionRecord {
  requesterId: string;
  circle: string;
  scope: string;
  rationale: string;
  grantedUntil: Timestamp;
  approvedBy: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface ServiceCommitment {
  hubId: string;
  circle: string;
  metric: string;
  targetCommitment: string;
  reviewFrequency: string;
  status: 'active' | 'under_review';
}

export interface PublicationView {
  articleId: string;
  audience: string;
  period: string;
  viewCountBucket: number;
  jurisdiction: string;
}

export interface DeveloperBrief {
  weekPeriod: string;
  synthesizedNeeds: string[];
  testFailurePatterns: string[];
  frictionPoints: string[];
  status: 'triaged' | 'in_progress' | 'addressed';
  triagedAt?: Timestamp;
}


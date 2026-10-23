import type { Timestamp } from 'firebase/firestore';

/**
 * Canonical roles (Phase 0 contract, frozen 2026-10-13).
 * 13 Network roles. Clinical consultant and PSC hold NO account by
 * default and therefore have no role here.
 */
export type Role =
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
  | 'employer';

/** Operational capacity, NOT a business role. Never grants data access. */
export type SystemRole = 'systemAdmin';

export type AnyRole = Role | SystemRole;

/** Legacy role names from the v0.1 single-role claims. */
export type LegacyRole =
  | 'hubAdmin'
  | 'governance'
  | 'backboneAnalyst'
  | 'systemAdmin'
  | 'worker'
  | 'navigator'
  | 'supervisor'
  | 'employer';

/** Migration map (brief §2b). Governance splits by scope; the admin
 *  claims script asks which scope the record belongs to. */
export const LEGACY_ROLE_MAP: Record<string, string> = {
  hubAdmin: 'hubCoordinator',
  governance: 'steeringCircle', // or 'council' — resolved by scope at migration
  backboneAnalyst: 'analyst',
  systemAdmin: 'systemAdmin', // operational-only, never a data role
  worker: 'worker',
  navigator: 'navigator',
  supervisor: 'supervisor',
  employer: 'employer',
};

/**
 * Purpose taxonomy (Phase 2) — MIRROR of the Kernel's PURPOSE_TAXONOMY
 * (functions/src/kernel.ts). The server enforces it: any purpose not
 * in this list is rejected by authorizeCommand / the gateway. If you
 * change the Kernel list, update this mirror (and vice versa).
 */
export const PURPOSE_TAXONOMY: readonly string[] = [
  'wayfinding support',
  'peer mentorship',
  'supervision reflection',
  'certification navigation',
  'pathway review',
  'handoff coordination',
  'share a record',
  'export my data',
  'delete my data',
  'consent expiry',
  'consent revocation',
  'grant a role',
  'resolve a proposed grant',
  'revoke a role grant',
  'declare a conflict',
  'request a role grant',
  'respond to a handoff',
  'person record setup',
  'invite a member',
  'claim an invitation',
  'membership oversight',
];

/**
 * Purposes a worker may choose when granting access (Consents) or
 * describing a handoff. The full taxonomy above is enforced server-side.
 */
export const WORKER_PURPOSE_OPTIONS: readonly string[] = [
  'wayfinding support',
  'peer mentorship',
  'supervision reflection',
  'certification navigation',
  'pathway review',
  'handoff coordination',
];
export function isCanonicalRole(value: string): value is AnyRole {
  return (
    value === 'systemAdmin' ||
    [
      'worker', 'mentor', 'supervisor', 'navigator', 'facilitator',
      'hubCoordinator', 'privacyLead', 'steeringCircle', 'council',
      'backboneLead', 'analyst', 'researcher', 'employer',
    ].includes(value)
  );
}

/** Map a legacy claim role to its canonical replacement. */
export function canonicalRole(value: string): AnyRole | null {
  if (isCanonicalRole(value)) return value;
  const mapped = LEGACY_ROLE_MAP[value];
  return mapped && isCanonicalRole(mapped) ? mapped : null;
}

/** Human-readable role labels for UI. */
export const ROLE_LABELS: Record<AnyRole, string> = {
  worker: 'Peer Worker',
  mentor: 'Mentor',
  supervisor: 'Peer-Practice Supervisor',
  navigator: 'Navigator',
  facilitator: 'Facilitator',
  hubCoordinator: 'Hub Coordinator',
  privacyLead: 'Privacy Lead',
  steeringCircle: 'Steering Circle Member',
  council: 'National Council Member',
  backboneLead: 'Backbone Lead',
  analyst: 'Workforce-Intelligence Analyst',
  researcher: 'Research Unit Member',
  employer: 'Employer',
  systemAdmin: 'System Administrator (operational)',
};

/** Least-privileged default order — matches the Kernel catalogue ranks
 *  (kernel.ts leastPrivilegeRank): worker first, systemAdmin last. */
export const ROLE_DEFAULT_ORDER: AnyRole[] = [
  'worker',
  'mentor',
  'facilitator',
  'navigator',
  'supervisor',
  'researcher',
  'analyst',
  'privacyLead',
  'employer',
  'hubCoordinator',
  'steeringCircle',
  'backboneLead',
  'council',
  'systemAdmin',
];

/** Grant scope types (Kernel ScopeType). 'network' = national scope. */
export type ScopeType = 'self' | 'hub' | 'network' | 'employer';

/**
 * A Firestore Timestamp OR an epoch-ms number. The Kernel's pure core
 * types validity as ms; Firestore documents carry Timestamps; the
 * getMyGrants callable returns ms (converted server-side). Accept both.
 */
export type TimestampOrMs = Timestamp | number | null | undefined;

/** Normalize a Timestamp-or-ms value to epoch ms (null when absent). */
export function toMillis(value: TimestampOrMs): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  try {
    return value.toMillis();
  } catch {
    return null;
  }
}

/** Format a Timestamp-or-ms value as a date string. */
export function formatTimestampOrMs(value: TimestampOrMs): string {
  const ms = toMillis(value);
  if (ms === null) return '—';
  return new Date(ms).toLocaleDateString();
}

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

/** A person in the Network. One account per person. */
export interface Person {
  displayName: string;
  email: string;
  tenantId: string;
  status: 'active' | 'suspended';
  createdAt: Timestamp;
}

/** A scoped grant of one role to one person. The unit of authorization.
 *  Shape matches the Kernel (kernel.ts RoleGrant): validity is
 *  validFrom/validUntil; Firestore docs carry Timestamps, the
 *  getMyGrants callable returns epoch ms. Use toMillis() to read. */
export interface RoleGrant {
  granteeId: string;
  /** Invitee email (lowercased) for PENDING invitations; absent otherwise. */
  granteeEmail?: string;
  role: AnyRole;
  scopeType: ScopeType;
  scopeId: string;
  tenantId: string;
  basis: string;
  grantedBy: string;
  status: 'pending' | 'proposed' | 'active' | 'suspended' | 'expired' | 'revoked';
  validFrom: TimestampOrMs;
  validUntil: TimestampOrMs;
  needsReview?: boolean;
  reviewReason?: string | null;
  createdAt?: TimestampOrMs;
  updatedAt?: TimestampOrMs;
}

export interface Membership {
  personId: string;
  circleId: string;
  circleKind: 'hub' | 'steering' | 'council' | 'communityOfPractice';
  tenantId: string;
  status: 'active' | 'inactive';
  joinedAt: Timestamp;
}

export interface Assignment {
  workerId: string;
  holderId: string;
  role: 'mentor' | 'navigator' | 'supervisor' | 'facilitator';
  tenantId: string;
  status: 'active' | 'closed';
  startedAt: Timestamp;
  endedAt: Timestamp | null;
}

/** A conflict declaration (gateway declareConflict shape). */
export interface ConflictDeclaration {
  declarerId: string;
  grantId: string | null;
  description: string;
  mitigation: string | null;
  tenantId: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: Timestamp;
}

export interface Handoff {
  workerId: string;
  senderId: string;
  senderRole: AnyRole;
  recipientId: string;
  recipientRole: AnyRole;
  purpose: string;
  /** Routing label only — one of HANDOFF_PAYLOAD_SUMMARIES (F5). */
  payloadSummary: string;
  tenantId: string;
  status: 'draft' | 'offered' | 'accepted' | 'declined' | 'closed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Permitted handoff payloadSummary values (F5) — MIRROR of the
 * Kernel's HANDOFF_PAYLOAD_SUMMARIES (functions/src/kernel.ts).
 * The server (callable) and the rules enforce the same list; if you
 * change the Kernel list, update this mirror, the rules, and the
 * Handoffs form together. '' means no summary.
 */
export const HANDOFF_PAYLOAD_SUMMARIES: readonly string[] = [
  '',
  'first-contact navigation',
  'intake received',
  'ready for assignment',
  'awaiting mentor match',
  'supervision requested',
  'certification next step',
  'pathway review requested',
  'follow-up requested',
  'information only',
];

export function isValidHandoffPayloadSummary(value: unknown): value is string {
  return typeof value === 'string' && (HANDOFF_PAYLOAD_SUMMARIES as readonly string[]).includes(value);
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

/**
 * Client patch for a first-contact form (F1). `sharedWith` is
 * server-managed (grantAccess only), and `ownerId` / `tenantId` are
 * immutable — the patch type excludes all three so a caller cannot
 * even express the forbidden write. Rules enforce the same.
 */
export type FirstContactFormPatch = Omit<
  Partial<FirstContactForm>,
  'sharedWith' | 'ownerId' | 'tenantId'
>;

export interface PathwayStep {
  ownerId: string;
  tenantId: string;
  type: string;
  title: string;
  status: 'not-started' | 'in-progress' | 'done' | 'paused';
  sharedWith: string[];
  createdAt: Timestamp;
}

/**
 * Client patch for a pathway step (F1). Same exclusion as
 * FirstContactFormPatch: no `sharedWith`, `ownerId`, or `tenantId`.
 */
export type PathwayStepPatch = Omit<
  Partial<PathwayStep>,
  'sharedWith' | 'ownerId' | 'tenantId'
>;

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

/**
 * Server-written aggregate release record (aggregateEvaluation):
 * what was published, what was suppressed at the MIN_CELL floor,
 * and when. Read-only everywhere; clients can never write these.
 */
export interface AggregateRelease {
  tenantId: string;
  metric: string;
  period: string;
  published: number;
  suppressed: number;
  minCell: number;
  reviewedBy: string | null;
  releasedAt: Timestamp;
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

/**
 * Server-authored access event (the audit record). Clients NEVER write
 * these; they are written by Cloud Functions in the same transaction
 * as the business change they record.
 */
export interface AccessEvent {
  subjectId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  /** Hub the audited resource belongs to (F4 tidy — was missing from the type). */
  tenantId: string;
  actingRole: string;
  actingGrantId: string | null;
  purpose: string;
  correlationId: string;
  result: 'allowed' | 'denied';
  detail?: Record<string, unknown>;
  createdAt: Timestamp;
}

/** Backwards-compatible alias for the audit page. */
export type AuditLog = AccessEvent;

export interface DeletionRequest {
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
}

/** Result of one deletion pass (processDeletion). */
export interface DeletionPassResult {
  requestId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  processed: number;
  deleted: number;
  anonymised: number;
  exportUrl: string | null;
  exportError: string | null;
  resumed?: boolean;
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

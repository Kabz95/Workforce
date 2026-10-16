/**
 * Role Kernel — pure core (no Firestore, no Admin SDK).
 *
 * Canonical source for: the 13 role capacities + the operational
 * systemAdmin capacity, scoped grants, the six-part authorization
 * decision, separation-of-duties evaluation, grant lifecycle, the
 * acting-capacity default, and the handoff state machine.
 *
 * Everything in this module is a pure function so the authorization
 * logic is unit-testable without an emulator. Firestore-backed
 * resolution lives in gateway.ts; enforcement lives in the callable
 * handlers (index.ts) and in firestore.rules.
 *
 * Contract (Phase 0, frozen 2026-10-13):
 * - One account per person. A person holds grants, not a permanent role.
 * - Each grant names role, circle, scope, validity, and who authorized it.
 * - Acting capacity is session-only; default worker if held, else
 *   least-privileged. Fail closed: an expired/suspended/scope-changed
 *   grant ends the acting context; never silently substitute another role.
 * - Six-part authorization: identity + active grant + scope +
 *   relationship + purpose + consent must all agree.
 * - High-risk commands are authorized from grants only (never from
 *   claims alone), except the audited migration fallback below.
 */

export type CanonicalRole =
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

/** Operational capacity, NOT a business role. Time-limited, audited. */
export type OperationalRole = 'systemAdmin';

export type AnyRole = CanonicalRole | OperationalRole;

export type Circle =
  | 'centre'
  | 'practice'
  | 'hub'
  | 'national'
  | 'boundary'
  | 'operational';

export type ScopeType = 'self' | 'hub' | 'network' | 'employer';

export type GrantStatus =
  | 'pending'
  | 'proposed'
  | 'active'
  | 'suspended'
  | 'expired'
  | 'revoked';

export interface RoleCatalogueEntry {
  id: AnyRole;
  /** One-sentence charter. */
  charter: string;
  circle: Circle;
  scopeType: ScopeType;
  /** Sensitive transitions get a boundary reminder + confirmation. */
  sensitive: boolean;
  /** What this role never shows (boundary copy). */
  neverShows: string;
  /** Lower = less privileged. Used for the acting-role default. */
  leastPrivilegeRank: number;
  operational?: boolean;
}

/**
 * Canonical role catalogue (13 capacities + operational systemAdmin).
 * Labels must match the charter — no catch-all "admin"/"governance".
 */
export const ROLE_CATALOGUE: readonly RoleCatalogueEntry[] = [
  {
    id: 'worker',
    charter: 'Own pathway, records, consent',
    circle: 'centre',
    scopeType: 'self',
    sensitive: false,
    neverShows: 'Other workers, hidden staff notes, internal risk scores, participation rankings.',
    leastPrivilegeRank: 0,
  },
  {
    id: 'mentor',
    charter: 'Developmental companionship; no authority over duties or employment',
    circle: 'practice',
    scopeType: 'hub',
    sensitive: false,
    neverShows: 'Employer appraisal, clinical notes, supervision notes, the worker’s full pathway.',
    leastPrivilegeRank: 1,
  },
  {
    id: 'facilitator',
    charter: 'Learning cycles + communities of practice',
    circle: 'practice',
    scopeType: 'hub',
    sensitive: false,
    neverShows: 'Individual performance, personal case files, attendance as a disciplinary signal.',
    leastPrivilegeRank: 2,
  },
  {
    id: 'navigator',
    charter: 'Certification navigation — wayfinding; never predicts, never assesses',
    circle: 'practice',
    scopeType: 'hub',
    sensitive: false,
    neverShows: 'Private supervision, mentorship narrative, employer appraisal, national research records.',
    leastPrivilegeRank: 3,
  },
  {
    id: 'supervisor',
    charter: 'Reflective practice + role integrity (Proctor’s three functions)',
    circle: 'practice',
    scopeType: 'hub',
    sensitive: false,
    neverShows: 'Unrelated worker files, mentorship content, line-management performance controls.',
    leastPrivilegeRank: 4,
  },
  {
    id: 'researcher',
    charter: 'Ethical, coded research under separate consent',
    circle: 'national',
    scopeType: 'network',
    sensitive: true,
    neverShows: 'Operational records outside protocol, identity keys without an exceptional approved basis.',
    leastPrivilegeRank: 5,
  },
  {
    id: 'analyst',
    charter: 'Protected aggregates only (workforce intelligence)',
    circle: 'national',
    scopeType: 'network',
    sensitive: false,
    neverShows: 'Row-level worker data, small cells, drill-through to a person.',
    leastPrivilegeRank: 6,
  },
  {
    id: 'privacyLead',
    charter: 'Consent + access discipline; sees the machinery, not the content',
    circle: 'hub',
    scopeType: 'hub',
    sensitive: true,
    neverShows: 'Record content by default. Metadata-first review.',
    leastPrivilegeRank: 7,
  },
  {
    id: 'employer',
    charter: 'Employment relationship only (boundary workspace)',
    circle: 'boundary',
    scopeType: 'employer',
    sensitive: true,
    neverShows: 'Mentorship content, supervision notes, navigation records, health narrative, worker-owned evaluation responses.',
    leastPrivilegeRank: 8,
  },
  {
    id: 'hubCoordinator',
    charter: 'Local capacity + safety procedure (hub’s operating desk)',
    circle: 'hub',
    scopeType: 'hub',
    sensitive: false,
    neverShows: 'Broad worker records, session narratives, consented material unrelated to an active procedure.',
    leastPrivilegeRank: 9,
  },
  {
    id: 'steeringCircle',
    charter: 'Local (hub) accountability',
    circle: 'hub',
    scopeType: 'hub',
    sensitive: true,
    neverShows: 'Identifiable case files, raw evaluation responses.',
    leastPrivilegeRank: 10,
  },
  {
    id: 'backboneLead',
    charter: 'National coordination + shared infrastructure',
    circle: 'national',
    scopeType: 'network',
    sensitive: false,
    neverShows: 'Powers reserved to Council, identifiable delivery records.',
    leastPrivilegeRank: 11,
  },
  {
    id: 'council',
    charter: 'National peer-majority governance; the common floor',
    circle: 'national',
    scopeType: 'network',
    sensitive: true,
    neverShows: 'Local case files, raw hub records, individual productivity.',
    leastPrivilegeRank: 12,
  },
  {
    id: 'systemAdmin',
    charter: 'Time-limited, audited operational access. No program dashboard, no browsing records.',
    circle: 'operational',
    scopeType: 'network',
    sensitive: true,
    neverShows: 'Worker records, program data, anything beyond the declared operational task.',
    leastPrivilegeRank: 13,
    operational: true,
  },
];

export const CANONICAL_ROLES: readonly CanonicalRole[] = ROLE_CATALOGUE.filter(
  (e): e is RoleCatalogueEntry & { id: CanonicalRole } => !e.operational,
).map((e) => e.id);

export function catalogueEntry(role: AnyRole): RoleCatalogueEntry | undefined {
  return ROLE_CATALOGUE.find((e) => e.id === role);
}

export function isCanonicalRole(value: unknown): value is AnyRole {
  return (
    typeof value === 'string' &&
    ROLE_CATALOGUE.some((e) => e.id === value)
  );
}

/** Roles whose transitions require a boundary reminder + confirmation. */
export const SENSITIVE_ROLES: readonly AnyRole[] = ROLE_CATALOGUE.filter(
  (e) => e.sensitive,
).map((e) => e.id);

export function isSensitiveRole(role: AnyRole): boolean {
  return SENSITIVE_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

export type LegacyRole =
  | 'worker'
  | 'navigator'
  | 'supervisor'
  | 'employer'
  | 'hubAdmin'
  | 'governance'
  | 'backboneAnalyst'
  | 'systemAdmin';

/** Direct 1:1 legacy mappings. `governance` is handled separately. */
export const LEGACY_ROLE_MAP: Readonly<Record<Exclude<LegacyRole, 'governance'>, AnyRole>> = {
  worker: 'worker',
  navigator: 'navigator',
  supervisor: 'supervisor',
  employer: 'employer',
  hubAdmin: 'hubCoordinator',
  backboneAnalyst: 'analyst',
  systemAdmin: 'systemAdmin',
};

/**
 * Migrate a legacy single-role claim to a canonical role.
 * `governance` is ambiguous: hub-scoped governance becomes
 * `steeringCircle`, national governance becomes `council`.
 * Without a scope hint, migration MUST refuse and ask for
 * disambiguation — never guess, never broaden scope.
 */
export function migrateLegacyRole(
  legacy: string,
  scopeHint?: 'hub' | 'network' | null,
): AnyRole {
  if (legacy === 'governance') {
    if (scopeHint === 'hub') return 'steeringCircle';
    if (scopeHint === 'network') return 'council';
    throw new Error(
      'Ambiguous legacy role "governance": disambiguate with scope "hub" (→ steeringCircle) or "network" (→ council).',
    );
  }
  const mapped = (LEGACY_ROLE_MAP as Record<string, AnyRole>)[legacy];
  if (!mapped) throw new Error(`Unknown legacy role "${legacy}".`);
  return mapped;
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export interface RoleGrant {
  id?: string;
  granteeId: string;
  /**
   * Invitee email (lowercased) for PENDING invitations. A pending
   * invitation has granteeId '' (no account yet) and is claimed by
   * ensureMyPerson when a user signs in with this email: granteeId
   * is set to their uid and the status moves to active (or proposed
   * when the invitation needs review). Present only on invitations.
   */
  granteeEmail?: string;
  role: AnyRole;
  scopeType: ScopeType;
  /** hub id for hub scope, employer id for employer scope, 'network' for network, uid for self. */
  scopeId: string;
  /** Tenant (hub) the grant belongs to. 'network' for national grants. */
  tenantId: string;
  status: GrantStatus;
  /** Epoch ms. */
  validFrom: number;
  /** Epoch ms, or null for no expiry (legacy backfill only). New grants must set one. */
  validUntil: number | null;
  grantedBy: string;
  /** Human-readable basis: e.g. "council decision 2026-10-20", "hub agreement". */
  basis: string;
  needsReview?: boolean;
  reviewReason?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** A grant is live only when active AND inside its validity window. */
export function isGrantLive(grant: RoleGrant, nowMs: number = Date.now()): boolean {
  return (
    grant.status === 'active' &&
    grant.validFrom <= nowMs &&
    (grant.validUntil === null || nowMs <= grant.validUntil)
  );
}

/**
 * Default acting grant: worker if held (and live), else the
 * least-privileged live grant. Returns null when nothing is live —
 * the caller must then fail closed to role selection.
 */
export function selectDefaultGrant(
  grants: readonly RoleGrant[],
  nowMs: number = Date.now(),
): RoleGrant | null {
  const live = grants.filter((g) => isGrantLive(g, nowMs));
  if (live.length === 0) return null;
  const worker = live.find((g) => g.role === 'worker');
  if (worker) return worker;
  const rank = (g: RoleGrant): number =>
    catalogueEntry(g.role)?.leastPrivilegeRank ?? 99;
  return [...live].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Grant lifecycle + separation of duties
// ---------------------------------------------------------------------------

const GRANT_TRANSITIONS: Readonly<Record<GrantStatus, readonly GrantStatus[]>> = {
  // Pending = invitation awaiting claim by the invitee. Claiming moves
  // it to active (or to proposed when the invitation needs review);
  // the inviter may cancel it (→ revoked); an expired invitation is
  // marked expired by the claim path instead of being claimed.
  pending: ['active', 'proposed', 'revoked', 'expired'],
  proposed: ['active', 'revoked'],
  active: ['suspended', 'expired', 'revoked'],
  suspended: ['active', 'revoked', 'expired'],
  expired: [],
  revoked: [],
};

export function validateGrantTransition(
  from: GrantStatus,
  to: GrantStatus,
  actorId: string,
  grant: RoleGrant,
): { ok: boolean; reason: string } {
  if (!GRANT_TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `Grant cannot move ${from} → ${to}.` };
  }
  // Activation is approval: the approver must not be the subject.
  if (to === 'active' && actorId === grant.granteeId) {
    return { ok: false, reason: 'No self-approval: the approver must not be the grant subject.' };
  }
  return { ok: true, reason: 'ok' };
}

export type GrantRequestDecision = 'allow' | 'deny' | 'needsReview';

export interface GrantRequestEvaluation {
  decision: GrantRequestDecision;
  reason: string;
}

/**
 * Separation-of-duties evaluation for a new grant request.
 * - Self-approval is denied (approval path; requesting is separate).
 * - A researcher never inherits operational access → deny systemAdmin.
 * - High-risk combinations trigger review, not automatic approval:
 *   employer + any inside role; privacyLead + systemAdmin;
 *   systemAdmin + any business role.
 */
export function evaluateGrantRequest(input: {
  subjectId: string;
  approverId: string | null;
  requestedRole: AnyRole;
  subjectHeldRoles: readonly AnyRole[];
}): GrantRequestEvaluation {
  const { subjectId, approverId, requestedRole, subjectHeldRoles } = input;
  if (approverId !== null && approverId === subjectId) {
    return { decision: 'deny', reason: 'No self-approval.' };
  }
  if (requestedRole === 'systemAdmin' && subjectHeldRoles.includes('researcher')) {
    return {
      decision: 'deny',
      reason: 'A researcher never inherits operational access.',
    };
  }
  const insideRoles: readonly AnyRole[] = CANONICAL_ROLES.filter((r) => r !== 'employer');
  if (
    requestedRole === 'employer' &&
    subjectHeldRoles.some((r) => insideRoles.includes(r))
  ) {
    return {
      decision: 'needsReview',
      reason: 'Employer (boundary) + inside role is a high-risk combination; review required.',
    };
  }
  if (
    insideRoles.includes(requestedRole) &&
    subjectHeldRoles.includes('employer')
  ) {
    return {
      decision: 'needsReview',
      reason: 'Inside role + employer (boundary) is a high-risk combination; review required.',
    };
  }
  if (
    (requestedRole === 'systemAdmin' && subjectHeldRoles.includes('privacyLead')) ||
    (requestedRole === 'systemAdmin' && subjectHeldRoles.length > 0) ||
    (subjectHeldRoles.includes('systemAdmin') && requestedRole !== 'systemAdmin')
  ) {
    return {
      decision: 'needsReview',
      reason: 'Operational (systemAdmin) + business role is a high-risk combination; review required.',
    };
  }
  return { decision: 'allow', reason: 'ok' };
}

/** Roles that may authorize (grant / resolve / revoke) other grants. */
export const GRANT_AUTHORITIES: readonly AnyRole[] = [
  'council',
  'backboneLead',
  'hubCoordinator',
  'steeringCircle',
];

/**
 * Whether a grant with `authorityRole` in `authorityScope` may act on a
 * grant request for `targetScope`. Council/backboneLead act network-wide;
 * hubCoordinator/steeringCircle act only within their own hub (tenant).
 */
export function mayAuthorizeGrant(
  authorityRole: AnyRole,
  authorityTenantId: string,
  targetTenantId: string,
): boolean {
  if (!GRANT_AUTHORITIES.includes(authorityRole)) return false;
  if (authorityRole === 'council' || authorityRole === 'backboneLead') return true;
  return authorityTenantId === targetTenantId;
}

// ---------------------------------------------------------------------------
// Purpose taxonomy (Phase 2)
// ---------------------------------------------------------------------------

/**
 * The central purpose vocabulary. Every consequential command carries a
 * purpose, and the purpose MUST be one of these strings — free-text
 * purposes are rejected by authorizeCommand. The taxonomy is the
 * complete list of purposes the system itself uses (handler defaults)
 * plus the worker-facing purposes the Consents / Handoffs UI offers.
 * Every entry is a plain-language phrase a worker can read in their
 * audit log and understand.
 *
 * If you add a purpose here, add it to the UI dropdowns that offer it
 * (web/src/lib/types.ts PURPOSE_TAXONOMY mirror). If you remove one,
 * update every handler default that uses it — the kernel tests pin
 * the full list.
 */
export const PURPOSE_TAXONOMY: readonly string[] = [
  // Worker-facing purposes (Consents / Handoffs UI).
  'wayfinding support',
  'peer mentorship',
  'supervision reflection',
  'certification navigation',
  'pathway review',
  'handoff coordination',
  // Handler defaults (system purposes).
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
  // Support agent (Phase 3, P3.1/P3.2): record-blind, actionless.
  'app support',
  'publish support brief',
];

/** True when the purpose is one of the taxonomy's canonical phrases. */
export function isValidPurpose(purpose: unknown): purpose is string {
  return typeof purpose === 'string' && PURPOSE_TAXONOMY.includes(purpose);
}

// ---------------------------------------------------------------------------
// Central role → command matrix (Phase 2)
// ---------------------------------------------------------------------------

/** Roles that may send a handoff (offer). The recipient is verified separately. */
export const HANDOFF_SENDERS: readonly AnyRole[] = [
  'navigator',
  'hubCoordinator',
  'supervisor',
  'mentor',
];

export type CommandName =
  | 'grantAccess'
  | 'requestExport'
  | 'requestDeletion'
  | 'processDeletion'
  | 'createHandoff'
  | 'respondHandoff'
  | 'closeHandoff'
  | 'createRoleGrant'
  | 'resolveRoleGrant'
  | 'revokeRoleGrant'
  | 'requestRoleGrant'
  | 'declareConflict'
  | 'ensureMyPerson'
  | 'inviteMember'
  | 'getMyGrants'
  | 'createSupervisionSession'
  | 'createMentorship'
  | 'askSupport';

export interface CommandMatrixEntry {
  /**
   * Roles that may issue this command. 'any' = any authenticated person
   * (self-service); the handler verifies the caller is the subject (or
   * the handoff recipient) — the matrix does not grant cross-person access.
   */
  roles: readonly AnyRole[] | 'any';
  highRisk: boolean;
  /** What the handler verifies beyond the matrix. */
  note: string;
}

/**
 * The single role → command matrix. HANDOFF_SENDERS and GRANT_AUTHORITIES
 * are the canonical lists this matrix references — there is no second
 * copy of them anywhere (gateway.ts imports HANDOFF_SENDERS from here).
 */
export const COMMAND_MATRIX: Readonly<Record<CommandName, CommandMatrixEntry>> = {
  grantAccess: {
    roles: ['worker'],
    highRisk: true,
    note: 'Caller must own the target document (or be a participant); a live consent with matching scope is required.',
  },
  requestExport: {
    roles: ['worker'],
    highRisk: true,
    note: 'Own data only.',
  },
  requestDeletion: {
    roles: ['worker'],
    highRisk: true,
    note: 'Own data only; creates a resumable deletion job.',
  },
  processDeletion: {
    roles: ['worker'],
    highRisk: true,
    note: 'Job owner only; the scheduled sweeper runs as system.',
  },
  createHandoff: {
    roles: HANDOFF_SENDERS,
    highRisk: false,
    note: 'Sender must hold one of these grants; a live assignment must link the sender to the worker (unless hubCoordinator); the recipient must hold a live grant for the recipient role.',
  },
  respondHandoff: {
    roles: 'any',
    highRisk: false,
    note: 'Only the recipient; verified against a live grant for the recipient role in the handoff scope.',
  },
  closeHandoff: {
    roles: 'any',
    highRisk: false,
    note: 'Only the recipient; from offered or accepted.',
  },
  createRoleGrant: {
    roles: GRANT_AUTHORITIES,
    highRisk: true,
    note: 'Hub authorities act only within their tenant; council/backboneLead act network-wide.',
  },
  resolveRoleGrant: {
    roles: GRANT_AUTHORITIES,
    highRisk: true,
    note: 'Grants flagged for review may only be resolved by council.',
  },
  revokeRoleGrant: {
    roles: GRANT_AUTHORITIES,
    highRisk: true,
    note: 'Or self-relinquish: the subject revoking their own grant.',
  },
  requestRoleGrant: {
    roles: 'any',
    highRisk: false,
    note: 'Self-request; creates a proposed grant. systemAdmin cannot be self-requested (the handler denies it).',
  },
  declareConflict: {
    roles: 'any',
    highRisk: false,
    note: 'Own declaration.',
  },
  ensureMyPerson: {
    roles: 'any',
    highRisk: false,
    note: 'Bootstrap: creates the caller’s own persons doc exactly once, and claims any pending invitations for the caller’s email. No live grant required (it runs before grants exist).',
  },
  inviteMember: {
    roles: GRANT_AUTHORITIES,
    highRisk: true,
    note: 'Creates a PENDING invitation keyed by email. Hub authorities act only within their tenant; council/backboneLead act network-wide. No self-invite; no systemAdmin invitations.',
  },
  getMyGrants: {
    roles: 'any',
    highRisk: false,
    note: 'Own grants only.',
  },
  createSupervisionSession: {
    roles: ['worker'],
    highRisk: false,
    note: 'Caller is the session owner (the worker). The supervisor must hold a live supervisor grant in the tenant. The supervisor reads the session ONLY through a live worker consent — supervisorId confers no access by itself.',
  },
  createMentorship: {
    roles: ['worker', 'mentor'],
    highRisk: false,
    note: 'Caller must be a participant; the other participant must hold a live mentor or worker grant in the tenant. A mentorship is a pair: exactly two participants.',
  },
  askSupport: {
    roles: 'any',
    highRisk: false,
    note: 'Record-blind app support (Phase 3). Any authenticated person, including bare persons with no grants (e.g. invitation problems). No record access, no mutation, no transcript storage. The handler does NOT run authorizeCommand (which denies ungranted callers); governance is: authenticated caller + validated purpose + best-effort acting grant + server-authored audit (category/outcome only, never the verbatim question).',
  },
};

/** True when `role` may issue `command` per the central matrix. */
export function commandAllowsRole(command: CommandName, role: AnyRole): boolean {
  const entry = COMMAND_MATRIX[command];
  if (!entry) return false;
  if (entry.roles === 'any') return true;
  return entry.roles.includes(role);
}

// ---------------------------------------------------------------------------
// Deletion plan (Phase 2) — data-driven, resumable deletion
// ---------------------------------------------------------------------------

export type DeletionMatch =
  | 'ownerId'
  | 'participantIds'
  | 'supervisorId'
  | 'authorId'
  | 'complainantId'
  | 'workerId'
  | 'holderId'
  | 'personId'
  | 'granteeId'
  | 'granterId'
  | 'senderId'
  | 'recipientId'
  | 'sharedWith'
  | 'docId';

export type DeletionAction =
  | 'delete'
  | 'anonymiseField'
  | 'stripUid'
  | 'revokeGrant'
  | 'closeLink'
  | 'revokeConsent';

export interface DeletionPlanStep {
  collection: string;
  /** How to find the caller’s documents in this collection. */
  match: DeletionMatch;
  action: DeletionAction;
  /** Field(s) the action operates on (anonymiseField / closeLink / stripUid). */
  fields?: readonly string[];
  /** Extra update applied with the action (e.g. closeLink sets status closed). */
  extra?: Readonly<Record<string, string>>;
  /**
   * For revokeConsent: which uid to strip from the consent target’s
   * sharedWith — the consent’s granteeId (granter-side) or the caller
   * (grantee-side).
   */
  stripTargetSharedWith?: 'granteeId' | 'caller';
}

/**
 * The deletion plan: every collection that holds user-linked data, and
 * what happens to it when that person deletes their data. The runner
 * (index.ts) walks this table step by step, in order, resuming from a
 * cursor — so a large account never hits the single-transaction limit.
 *
 * Coverage rules (pinned by kernel tests):
 * - Every WORKER_OWNED collection (ownerId) is deleted.
 * - Every shareable collection gets a sharedWith sweep (stale shares removed).
 * - supervisionSessions is anonymised on BOTH sides: supervisorId (the
 *   supervisor leaving) AND ownerId (the worker leaving — Phase 2 fix:
 *   Phase 1 only tombstoned supervisorId, leaving the worker’s link).
 * - handoffs are anonymised for all three parties (worker, sender, recipient).
 * - Access events, aggregates, governance decisions and the deletion job
 *   itself are KEPT (accountability / published records) — they are
 *   deliberately absent from this table.
 */
export const DELETION_PLAN: readonly DeletionPlanStep[] = [
  // 1. Worker-owned documents: deleted.
  { collection: 'workers', match: 'ownerId', action: 'delete' },
  { collection: 'firstContactForms', match: 'ownerId', action: 'delete' },
  { collection: 'pathwaySteps', match: 'ownerId', action: 'delete' },
  { collection: 'certificationNavigation', match: 'ownerId', action: 'delete' },
  { collection: 'evaluationSubmissions', match: 'ownerId', action: 'delete' },
  { collection: 'opportunityApplications', match: 'ownerId', action: 'delete' },
  // 2. Mentorships: the person leaves the participant list (record persists, anonymised).
  { collection: 'mentorships', match: 'participantIds', action: 'stripUid', fields: ['participantIds', 'sharedWith'] },
  // 3. Supervision sessions: anonymised on both sides.
  { collection: 'supervisionSessions', match: 'supervisorId', action: 'anonymiseField', fields: ['supervisorId'] },
  { collection: 'supervisionSessions', match: 'ownerId', action: 'anonymiseField', fields: ['ownerId'] },
  // 4. Authored / filed records: author identity anonymised.
  { collection: 'adaptationLogs', match: 'authorId', action: 'anonymiseField', fields: ['authorId'] },
  { collection: 'complaints', match: 'complainantId', action: 'anonymiseField', fields: ['complainantId'] },
  // 5. Assignments: both sides closed.
  { collection: 'assignments', match: 'workerId', action: 'closeLink', fields: ['workerId'], extra: { status: 'closed' } },
  { collection: 'assignments', match: 'holderId', action: 'closeLink', fields: ['holderId'], extra: { status: 'closed' } },
  // 6. Handoffs: all three parties anonymised (worker side also closes the handoff).
  { collection: 'handoffs', match: 'workerId', action: 'closeLink', fields: ['workerId'], extra: { status: 'closed' } },
  { collection: 'handoffs', match: 'senderId', action: 'anonymiseField', fields: ['senderId'] },
  { collection: 'handoffs', match: 'recipientId', action: 'anonymiseField', fields: ['recipientId'] },
  // 7. sharedWith sweep: remove the person from every shareable document they were granted.
  { collection: 'firstContactForms', match: 'sharedWith', action: 'stripUid', fields: ['sharedWith'] },
  { collection: 'pathwaySteps', match: 'sharedWith', action: 'stripUid', fields: ['sharedWith'] },
  { collection: 'certificationNavigation', match: 'sharedWith', action: 'stripUid', fields: ['sharedWith'] },
  { collection: 'supervisionSessions', match: 'sharedWith', action: 'stripUid', fields: ['sharedWith'] },
  // 8. Consent grants: revoked (both directions), and the other party’s access stripped from the target.
  { collection: 'consents', match: 'granterId', action: 'revokeConsent', stripTargetSharedWith: 'granteeId' },
  { collection: 'consents', match: 'granteeId', action: 'revokeConsent', stripTargetSharedWith: 'caller' },
  // 9. Memberships + profile docs: deleted (the person leaves).
  { collection: 'memberships', match: 'personId', action: 'delete' },
  { collection: 'persons', match: 'docId', action: 'delete' },
  { collection: 'users', match: 'docId', action: 'delete' },
  // 10. Role grants: revoked, not deleted (accountability record).
  { collection: 'roleGrants', match: 'granteeId', action: 'revokeGrant' },
];


// ---------------------------------------------------------------------------
// Six-part authorization
// ---------------------------------------------------------------------------

export type Relationship = 'owner' | 'participant' | 'assigned' | 'member' | 'none' | 'public';

export interface PolicyScope {
  tenantId: string;
  scopeType: ScopeType;
  scopeId: string;
}

export interface PolicyInput {
  authenticated: boolean;
  uid: string | null;
  /** Resolved live grant for the acting capacity (server lookup). */
  actingGrant: RoleGrant | null;
  /** Claims roles[] — fallback only during migration, audited. */
  claimsRoles: readonly AnyRole[];
  /** True when the decision rests on claims fallback (no grant doc). */
  useClaimsFallback: boolean;
  command: string;
  /** High-risk commands require a live grant; claims alone never suffice. */
  highRisk: boolean;
  scope: PolicyScope;
  relationship: Relationship;
  relationshipRequired: boolean;
  /** Stated purpose. Must be a non-empty string. */
  purpose: string | null;
  /** Whether this command is consent-gated, and whether consent is live. */
  consentRequired: boolean;
  consentLive: boolean | null;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  checks: Record<'identity' | 'grant' | 'scope' | 'relationship' | 'purpose' | 'consent', boolean>;
  migrationFallback: boolean;
  actingGrantId: string | null;
}

/** Does this grant's scope cover the requested scope? */
export function grantCoversScope(grant: RoleGrant, scope: PolicyScope): boolean {
  if (grant.scopeType === 'network') return true;
  if (grant.scopeType === 'hub') {
    return scope.tenantId === grant.tenantId;
  }
  if (grant.scopeType === 'self') {
    return scope.scopeType === 'self' && scope.scopeId === grant.granteeId;
  }
  if (grant.scopeType === 'employer') {
    return scope.scopeType === 'employer' && scope.scopeId === grant.scopeId;
  }
  return false;
}

/**
 * The six-part decision. Checks run in order; the first failure
 * decides the denial reason. Returns a per-part breakdown for audit.
 */
export function authorizeCommand(input: PolicyInput, nowMs: number = Date.now()): PolicyDecision {
  const checks: PolicyDecision['checks'] = {
    identity: false,
    grant: false,
    scope: false,
    relationship: false,
    purpose: false,
    consent: false,
  };
  const deny = (reason: string): PolicyDecision => ({
    allowed: false,
    reason,
    checks,
    migrationFallback: false,
    actingGrantId: null,
  });

  // 1. Identity.
  if (!input.authenticated || !input.uid) {
    return deny('unauthenticated: sign-in required.');
  }
  checks.identity = true;

  // 1b. Operational-only: systemAdmin never authorizes a business
  // command. A network-scoped systemAdmin grant would otherwise pass
  // every scope check below — the exclusion must live here, not in
  // each handler. (System administration happens outside this gateway.)
  if (input.actingGrant?.role === 'systemAdmin') {
    return deny('operational-only: systemAdmin grants no business-command authority.');
  }
  if (
    !input.actingGrant &&
    input.useClaimsFallback &&
    input.claimsRoles.length > 0 &&
    input.claimsRoles.every((r) => r === 'systemAdmin')
  ) {
    return deny('operational-only: systemAdmin claims grant no business-command authority.');
  }

  // 2. Grant. High-risk commands require a live grant document.
  const grant = input.actingGrant;
  if (input.highRisk) {
    if (!grant || !isGrantLive(grant, nowMs)) {
      return deny('grant-required: a live role grant is required for this command.');
    }
    checks.grant = true;
  } else if (grant) {
    if (!isGrantLive(grant, nowMs)) {
      return deny('grant-not-live: the acting grant is expired, suspended, or revoked.');
    }
    checks.grant = true;
  } else if (input.useClaimsFallback && input.claimsRoles.length > 0) {
    // Migration bridge: claims fallback, audited by the caller.
    checks.grant = true;
  } else {
    return deny('grant-required: no live role grant and no claims fallback.');
  }

  // 3. Scope.
  if (grant) {
    if (!grantCoversScope(grant, input.scope)) {
      return deny('scope-mismatch: the acting grant does not cover this scope.');
    }
    checks.scope = true;
  } else {
    // Claims fallback: tenant must match the claimed tenant (checked by caller
    // via scope.tenantId); scope is tenant-wide for the fallback.
    checks.scope = true;
  }

  // 4. Relationship.
  if (input.relationshipRequired && input.relationship === 'none') {
    return deny('no-relationship: this command requires a relationship to the resource.');
  }
  checks.relationship = true;

  // 5. Purpose. Must be stated AND in the central taxonomy (Phase 2).
  // Free-text purposes are rejected: the audit trail stays legible and
  // every purpose is a reviewed, worker-readable phrase.
  if (typeof input.purpose !== 'string' || input.purpose.trim().length === 0) {
    return deny('purpose-missing: a stated purpose is required.');
  }
  if (!isValidPurpose(input.purpose)) {
    return deny(`purpose-not-in-taxonomy: "${input.purpose}" is not a recognised purpose.`);
  }
  checks.purpose = true;

  // 6. Consent / basis.
  if (input.consentRequired && input.consentLive !== true) {
    return deny('consent-required: live worker consent (or a documented basis) is required.');
  }
  checks.consent = true;

  return {
    allowed: true,
    reason: 'ok',
    checks,
    migrationFallback: !grant && input.useClaimsFallback,
    actingGrantId: grant?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sharing allowlist (grantAccess)
// ---------------------------------------------------------------------------

/** Collections whose documents may be shared via a consent grant. */
export const ALLOWED_SHARE_TARGETS: readonly string[] = [
  'firstContactForms',
  'pathwaySteps',
  'certificationNavigation',
  'supervisionSessions',
  'mentorships',
];

/** Scope string a grant must carry to share a document of this type. */
export function deriveConsentScope(resourceType: string): string | null {
  if (!ALLOWED_SHARE_TARGETS.includes(resourceType)) return null;
  return `read:${resourceType}`;
}

// ---------------------------------------------------------------------------
// Handoffs (minimal shape for the Phase 2 slice)
// ---------------------------------------------------------------------------

export type HandoffStatus = 'draft' | 'offered' | 'accepted' | 'declined' | 'closed';

export type HandoffAction = 'offer' | 'accept' | 'decline' | 'close';

export interface Handoff {
  id?: string;
  /** The worker the handoff is about. */
  workerId: string;
  /** Who sends the handoff (must hold a practice/coordinator grant). */
  senderId: string;
  senderRole: AnyRole;
  /** Who receives it (must hold a grant for recipientRole). */
  recipientId: string;
  recipientRole: AnyRole;
  purpose: string;
  /** Routing metadata only — never the worker's story. */
  payloadSummary: string;
  tenantId: string;
  status: HandoffStatus;
  createdAt?: number;
  updatedAt?: number;
}

const HANDOFF_TRANSITIONS: Readonly<Record<HandoffStatus, readonly HandoffAction[]>> = {
  draft: ['offer', 'close'],
  offered: ['accept', 'decline', 'close'],
  accepted: ['close'],
  declined: [],
  closed: [],
};

export function transitionHandoff(
  from: HandoffStatus,
  action: HandoffAction,
): { ok: boolean; to: HandoffStatus | null; reason: string } {
  if (!HANDOFF_TRANSITIONS[from].includes(action)) {
    return { ok: false, to: null, reason: `Handoff cannot ${action} from ${from}.` };
  }
  const to: HandoffStatus =
    action === 'offer' ? 'offered'
    : action === 'accept' ? 'accepted'
    : action === 'decline' ? 'declined'
    : 'closed';
  return { ok: true, to, reason: 'ok' };
}

export function validateHandoffParties(handoff: {
  workerId: string;
  senderId: string;
  recipientId: string;
}): { ok: boolean; reason: string } {
  if (handoff.senderId === handoff.workerId) {
    return { ok: false, reason: 'The sender must not be the worker the handoff is about.' };
  }
  if (handoff.recipientId === handoff.workerId) {
    return { ok: false, reason: 'The recipient must not be the worker the handoff is about.' };
  }
  if (handoff.senderId === handoff.recipientId) {
    return { ok: false, reason: 'Sender and recipient must differ.' };
  }
  return { ok: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Idempotency + atomic audit
// ---------------------------------------------------------------------------

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 128;
}

/** Shape of a server-authored access event (written atomically with the command). */
export interface AccessEventInput {
  subjectId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  /**
   * Tenant (hub) the audited resource belongs to. Stamped from the
   * server-side resource/grant/job document — never from raw client
   * input — so Privacy Lead oversight (`listHubAccessEvents`,
   * `where tenantId ==`) sees exactly this hub's events. 'network'
   * only for tenantless system/support events.
   */
  tenantId: string;
  actingRole: string;
  actingGrantId: string | null;
  purpose: string;
  correlationId: string;
  result: 'allowed' | 'denied';
  migrationFallback?: boolean;
  detail?: Record<string, unknown>;
}

export function buildAccessEvent(
  input: AccessEventInput,
  createdAt: unknown,
): Record<string, unknown> {
  return { ...input, createdAt };
}

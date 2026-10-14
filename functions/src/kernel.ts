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

  // 5. Purpose. Must be stated (non-empty). A purpose taxonomy is a
  // Phase-2 refinement; Phase 1 enforces presence, not vocabulary.
  if (typeof input.purpose !== 'string' || input.purpose.trim().length === 0) {
    return deny('purpose-missing: a stated purpose is required.');
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

import type { CanonicalRoleId, RoleCatalogEntry } from './types';

export interface EnrichedRoleCatalogEntry extends RoleCatalogEntry {
  isSensitive: boolean;
  defaultPath: string;
}

/**
 * Versioned Canonical Role Catalog (Phase 0 / Phase 1 Contract).
 *
 * Rules:
 * - Circular system: peer worker is the centre; rings are function, not rank.
 * - Software labels must match the charter. No catch-all "admin" or "staff".
 * - SystemAdmin is strictly operational, time-limited, audited.
 */
export const ROLE_CATALOG: Record<CanonicalRoleId, EnrichedRoleCatalogEntry> = {
  worker: {
    roleId: 'worker',
    title: 'Peer Worker',
    ring: 'centre',
    charter: 'Own pathway, records, consent.',
    boundaries: [
      'Cannot view other workers’ raw records.',
      'Cannot access governance deliberations prior to publishing.',
      'Cannot bypass regional hub boundaries without consented sharing.',
    ],
    minimumProtections: [
      'The worker controls their own record.',
      'No surveillance or activity monitoring.',
      'Consent is purpose-specific, visible, and revocable.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/',
  },
  mentor: {
    roleId: 'mentor',
    title: 'Peer Mentor',
    ring: 'directSupport',
    charter: 'Developmental companionship; no authority over duties or employment.',
    boundaries: [
      'Never submits reports to an employer or line manager.',
      'Never assesses worker performance or assigns duties.',
      'Cannot browse worker records without an active, explicit consent grant.',
    ],
    minimumProtections: [
      'Companionship relationship is protected from supervisory evaluation.',
      'Mentorship notes are separate from employment files.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/mentor',
  },
  supervisor: {
    roleId: 'supervisor',
    title: 'Practice Supervisor',
    ring: 'practice',
    charter: 'Reflective practice and role integrity (Proctor’s three functions).',
    boundaries: [
      'Never discloses supervision notes to an employer outside agreed channels.',
      'Cannot browse worker records outside assigned supervision relationships.',
      'Cannot override worker consent grants.',
    ],
    minimumProtections: [
      'Proctor’s normative, formative, and restorative triad maintained.',
      'Reflective notes are worker-owned or strictly shared.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/supervision',
  },
  navigator: {
    roleId: 'navigator',
    title: 'Certification Navigator',
    ring: 'directSupport',
    charter: 'Certification navigation — wayfinding; never predicts, never assesses.',
    boundaries: [
      'Never assesses certification readiness or predicts examination outcomes.',
      'Never shares draft pathway steps without worker acceptance.',
      'Sees only records explicitly shared for wayfinding.',
    ],
    minimumProtections: [
      'Wayfinding support is developmental, not gatekeeping.',
      'All pathway step recommendations require worker acceptance.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/pathway',
  },
  facilitator: {
    roleId: 'facilitator',
    title: 'Learning Facilitator',
    ring: 'practice',
    charter: 'Learning cycles and communities of practice.',
    boundaries: [
      'Never accesses individual worker clinical or employment files.',
      'Never grades or evaluates individual competency.',
      'Facilitates group learning spaces only.',
    ],
    minimumProtections: [
      'Community of practice discussions are confidential to the circle.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/learning',
  },
  hubCoordinator: {
    roleId: 'hubCoordinator',
    title: 'Hub Coordinator',
    ring: 'hubAccountability',
    charter: 'Local capacity and safety procedure (hub’s operating desk).',
    boundaries: [
      'Never browses raw worker files or case notes.',
      'Sees queue metadata and capacity metrics, not personal narrative.',
      'Cannot reassign worker consent grants without worker authorization.',
    ],
    minimumProtections: [
      'Operational capacity management without narrative surveillance.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/hub',
  },
  privacyLead: {
    roleId: 'privacyLead',
    title: 'Privacy Lead',
    ring: 'hubAccountability',
    charter: 'Consent and access discipline; sees the machinery, not the content.',
    boundaries: [
      'Sees access logs, consent status, and audit timestamps — NEVER record contents.',
      'Cannot browse worker pathways or contact forms.',
      'Not a System Admin; holds no elevated operational infrastructure keys.',
    ],
    minimumProtections: [
      'Content-blind access discipline and audit enforcement.',
    ],
    version: '1.0.0',
    isSensitive: true,
    defaultPath: '/privacy',
  },
  steeringCircle: {
    roleId: 'steeringCircle',
    title: 'Steering Circle Member',
    ring: 'hubAccountability',
    charter: 'Local (hub) accountability.',
    boundaries: [
      'Never sees raw worker records or identified client disclosures.',
      'Receives only protected hub aggregates (cell threshold < 5 suppressed).',
      'Cannot approve own hub agreements or grants without recusal.',
    ],
    minimumProtections: [
      'Separation of duties: recusal on conflicts of interest.',
    ],
    version: '1.0.0',
    isSensitive: true,
    defaultPath: '/governance',
  },
  council: {
    roleId: 'council',
    title: 'National Council Member',
    ring: 'national',
    charter: 'National peer-majority governance; the common floor.',
    boundaries: [
      'Zero access to individual worker records across all hubs.',
      'Sees de-identified national aggregates and policy drafts only.',
      'Cannot override Indigenous data governance (OCAP).',
    ],
    minimumProtections: [
      'Peer-majority governance; decisions published openly to the network.',
    ],
    version: '1.0.0',
    isSensitive: true,
    defaultPath: '/governance',
  },
  backboneLead: {
    roleId: 'backboneLead',
    title: 'Backbone Lead',
    ring: 'national',
    charter: 'National coordination and shared infrastructure.',
    boundaries: [
      'Resources flow down; raw worker data NEVER flows up.',
      'No access to local hub operational queues or individual files.',
      'Cannot unilaterally alter role charters or minimum protections.',
    ],
    minimumProtections: [
      'Shared infrastructure stewardship without upward narrative flow.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/backbone',
  },
  analyst: {
    roleId: 'analyst',
    title: 'Workforce Analyst',
    ring: 'intelligence',
    charter: 'Protected aggregates only (workforce intelligence).',
    boundaries: [
      'Strict suppression: cells smaller than 5 are suppressed by law.',
      'Zero access to raw records, names, or individual timestamps.',
      'No inference attacks or re-identification attempts.',
    ],
    minimumProtections: [
      'Mathematical k-anonymity (floor of 5) and differential privacy protections.',
    ],
    version: '1.0.0',
    isSensitive: false,
    defaultPath: '/aggregates',
  },
  researcher: {
    roleId: 'researcher',
    title: 'Ethical Researcher',
    ring: 'intelligence',
    charter: 'Ethical, coded research under separate consent.',
    boundaries: [
      'Requires separate, documented research ethics consent from each participant.',
      'Never inherits operational or hub coordinator access.',
      'Data must be coded and destroyed per protocol schedule.',
    ],
    minimumProtections: [
      'Tri-Council Policy / community-specific research ethics compliance.',
    ],
    version: '1.0.0',
    isSensitive: true,
    defaultPath: '/research',
  },
  employer: {
    roleId: 'employer',
    title: 'Employer Representative',
    ring: 'boundary',
    charter: 'Employment relationship only (boundary workspace).',
    boundaries: [
      'Sees only applications submitted specifically to their postings.',
      'NEVER sees worker pathways, mentorship notes, or peer supervision files.',
      'No access to network governance or internal hub discussions.',
    ],
    minimumProtections: [
      'Clear boundary workspace separating employment from peer practice.',
    ],
    version: '1.0.0',
    isSensitive: true,
    defaultPath: '/opportunities',
  },
  systemAdmin: {
    roleId: 'systemAdmin',
    title: 'System Administrator (Operational)',
    ring: 'operational',
    charter: 'Time-limited, audited operational infrastructure access.',
    boundaries: [
      'Operational capacity only; NO business dashboard.',
      'No permission to browse worker records or clinical narrative.',
      'Every action is stamped into immutable server-authoritative audit logs.',
    ],
    minimumProtections: [
      'Break-glass and operational access are strictly segregated from program roles.',
    ],
    version: '1.0.0',
    isSensitive: true,
    defaultPath: '/audit',
  },
};

/**
 * Migration helper: Maps legacy single-role claims to canonical roles.
 */
export function mapLegacyRole(legacyRole: string, scope?: string): CanonicalRoleId {
  switch (legacyRole) {
    case 'worker':
      return 'worker';
    case 'navigator':
      return 'navigator';
    case 'supervisor':
      return 'supervisor';
    case 'employer':
      return 'employer';
    case 'hubAdmin':
      return 'hubCoordinator';
    case 'governance':
      return scope === 'national' ? 'council' : 'steeringCircle';
    case 'backboneAnalyst':
      return 'analyst';
    case 'systemAdmin':
      return 'systemAdmin';
    default:
      return 'worker';
  }
}

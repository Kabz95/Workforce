/**
 * Dashboard manifests — one per canonical role (Phase 0 contract).
 *
 * A manifest is DATA, not a component: the Dashboard renders the same
 * seven fixed zones for every role, driven by the acting role's
 * manifest. Per-role widgets are added in later phases inside these
 * zones; the zone structure never changes.
 *
 * The seven fixed zones:
 *  1. actingContext — who you are acting as, in what scope, under what grant
 *  2. purpose — what this role exists to do (one line, from the book)
 *  3. attentionQueue — what needs this role's attention now
 *  4. coreWork — the role's primary work surface
 *  5. handoffs — work arriving from / leaving to other roles
 *  6. learningAccountability — learning loops + what this role answers for
 *  7. boundaries — what this role NEVER sees or does
 */

import type { AnyRole } from './types';

export type ZoneId =
  | 'actingContext'
  | 'purpose'
  | 'attentionQueue'
  | 'coreWork'
  | 'handoffs'
  | 'learningAccountability'
  | 'boundaries';

export const ZONE_ORDER: ZoneId[] = [
  'actingContext',
  'purpose',
  'attentionQueue',
  'coreWork',
  'handoffs',
  'learningAccountability',
  'boundaries',
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  actingContext: 'Acting context',
  purpose: 'Role purpose',
  attentionQueue: 'Attention queue',
  coreWork: 'Core work',
  handoffs: 'Handoffs',
  learningAccountability: 'Learning + accountability',
  boundaries: 'Boundaries — never shows',
};

export interface RoleManifest {
  role: AnyRole;
  label: string;
  purpose: string;
  /** Routes this role may open (acting capacity). */
  routes: string[];
  /** What this role NEVER sees or does — rendered in the boundaries zone. */
  neverShows: string[];
  /**
   * Boundary reminder shown when switching INTO this role, if the
   * transition is sensitive. Undefined = no reminder needed.
   */
  boundaryReminder?: string;
  /** Sensitive roles get an explicit confirmation on switch. */
  sensitive: boolean;
  /** Short description per zone (Phase 1 placeholder; widgets land in later phases). */
  zones: Record<ZoneId, string>;
}

const SENSITIVE_REMINDERS: Record<string, string> = {
  employer:
    'You are switching into the EMPLOYER capacity. You will see only what workers have consented to share with this employer. Worker records, mentorship notes, and supervision content are never visible here.',
  privacyLead:
    'You are switching into the PRIVACY LEAD capacity. You handle complaints, consent disputes, and access reviews. You do not read worker records to investigate them — you review access events and grants.',
  steeringCircle:
    'You are switching into a GOVERNANCE capacity. You see decisions, aggregates, and accountability records — never individual worker records.',
  council:
    'You are switching into a GOVERNANCE capacity. You see decisions, aggregates, and accountability records — never individual worker records.',
  researcher:
    'You are switching into the RESEARCH capacity. You see de-identified aggregates and consented research data only — never raw worker records.',
  systemAdmin:
    'You are switching into the OPERATIONAL capacity. System administration keeps the platform running; it grants no access to worker data.',
};

function manifest(
  role: AnyRole,
  label: string,
  purpose: string,
  routes: string[],
  neverShows: string[],
  zones: Record<ZoneId, string>,
  sensitive = false,
): RoleManifest {
  return {
    role,
    label,
    purpose,
    routes,
    neverShows,
    boundaryReminder: SENSITIVE_REMINDERS[role],
    sensitive,
    zones,
  };
}

export const ROLE_MANIFESTS: Record<AnyRole, RoleManifest> = {
  worker: manifest(
    'worker',
    'Peer Worker',
    'At the centre. The worker holds their own record, their own consent, and their own pathway.',
    ['/', '/record', '/pathway', '/consents', '/opportunities', '/governance', '/handoffs', '/audit', '/grants'],
    [
      'Other workers’ records',
      'Mentorship or supervision notes about other workers',
      'Any aggregate cell smaller than 5',
      'Employer-side views of applications beyond your own',
    ],
    {
      actingContext: 'You are acting as a peer worker, in your own capacity.',
      purpose: 'Your record, your consent, your pathway. Nothing moves without you.',
      attentionQueue: 'Live consent grants, pathway steps due, and handoffs addressed to you.',
      coreWork: 'Your record, your pathway, your consents.',
      handoffs: 'Work arriving for you from your navigator, mentor, or supervisor — and what you send back.',
      learningAccountability: 'Your own access log: everything the system recorded about your record.',
      boundaries: 'This capacity never shows another worker’s record.',
    },
  ),
  mentor: manifest(
    'mentor',
    'Mentor',
    'Walks alongside a peer worker. Holds the relationship, not the record.',
    ['/', '/record', '/opportunities', '/governance', '/handoffs', '/audit', '/grants'],
    [
      'Worker records without a live consent grant',
      'Supervision observations',
      'Employer-side views',
      'Aggregates below the suppression floor',
    ],
    {
      actingContext: 'You are acting as a mentor, within the scope of your mentorship assignments.',
      purpose: 'Companionship and lived-experience guidance. You hold the relationship, not the record.',
      attentionQueue: 'Assigned mentees’ agreed check-ins and handoffs addressed to you.',
      coreWork: 'Mentorship notes you write, shared only as the worker consented.',
      handoffs: 'Referrals to the navigator or supervisor, with the worker’s knowledge.',
      learningAccountability: 'Your mentorship activity is recorded under this acting capacity.',
      boundaries: 'Mentorship never reaches the line manager. Supervision content is not yours to see.',
    },
  ),
  supervisor: manifest(
    'supervisor',
    'Peer-Practice Supervisor',
    'Holds the practice: reflective supervision for peer workers, by lived experience.',
    ['/', '/pathway', '/opportunities', '/governance', '/handoffs', '/audit', '/grants'],
    [
      'Worker records without a live consent grant',
      'Line-manager reporting channels',
      'Employer-side views',
      'Clinical records',
    ],
    {
      actingContext: 'You are acting as a peer-practice supervisor, within your supervision assignments.',
      purpose: 'Reflective supervision that keeps peer practice peer-led.',
      attentionQueue: 'Supervision sessions due and handoffs from navigators and mentors.',
      coreWork: 'Supervision sessions and practice reflections.',
      handoffs: 'Agreed escalations to the hub coordinator, through the defined channel only.',
      learningAccountability: 'Supervision is recorded under this acting capacity, never routed to a line manager.',
      boundaries: 'Supervision observations reach an employer ONLY through the agreed channel.',
    },
  ),
  navigator: manifest(
    'navigator',
    'Navigator',
    'Helps a peer worker find their way: certification, training, opportunities, systems.',
    ['/', '/record', '/pathway', '/opportunities', '/governance', '/handoffs', '/audit', '/grants'],
    [
      'Worker records without a live consent grant',
      'Supervision observations',
      'Employer-side views beyond consented applications',
      'Aggregates below the suppression floor',
    ],
    {
      actingContext: 'You are acting as a navigator, within your navigation assignments.',
      purpose: 'Wayfinding: certification, training, opportunities, systems.',
      attentionQueue: 'Assigned workers’ navigation tasks and handoffs addressed to you.',
      coreWork: 'Certification navigation and pathway support for assigned workers.',
      handoffs: 'Referrals to mentors, supervisors, and hubs — with the worker’s consent.',
      learningAccountability: 'Navigation work is recorded under this acting capacity.',
      boundaries: 'Navigation support never becomes surveillance of the worker.',
    },
  ),
  facilitator: manifest(
    'facilitator',
    'Facilitator',
    'Holds learning spaces: communities of practice, training, peer learning.',
    ['/', '/opportunities', '/governance', '/audit', '/grants'],
    [
      'Individual worker records',
      'Supervision observations',
      'Employer-side views',
    ],
    {
      actingContext: 'You are acting as a facilitator, within your hub or national scope.',
      purpose: 'Hold learning spaces where peer workers learn from each other.',
      attentionQueue: 'Upcoming sessions, circles, and handoffs from the hub.',
      coreWork: 'Communities of practice, training sessions, learning materials.',
      handoffs: 'Learning needs surfaced to the hub; resources flowing down.',
      learningAccountability: 'Facilitation is recorded under this acting capacity.',
      boundaries: 'Facilitation never inspects individual worker records.',
    },
  ),
  hubCoordinator: manifest(
    'hubCoordinator',
    'Hub Coordinator',
    'Holds the hub: coordination, safety, and the agreements that let the circle hold.',
    ['/', '/opportunities', '/governance', '/handoffs', '/audit', '/grants', '/membership'],
    [
      'Individual worker records (no hub view of worker records exists)',
      'Supervision or mentorship content',
      'Other hubs’ internal records',
    ],
    {
      actingContext: 'You are acting as a hub coordinator, within your hub’s scope.',
      purpose: 'Coordinate the hub: people, safety, agreements, and flow.',
      attentionQueue: 'Role-grant requests, conflict declarations, handoffs, and hub safety items.',
      coreWork: 'Hub coordination: assignments, agreements, and member support.',
      handoffs: 'Handoffs between hub roles and up to the backbone, through defined routes.',
      learningAccountability: 'Hub decisions and grants are recorded under this acting capacity.',
      boundaries: 'Coordination never opens a worker’s record. The hub has no worker-record view.',
    },
  ),
  privacyLead: manifest(
    'privacyLead',
    'Privacy Lead',
    'Guards the floor: consent, access, complaints, and the minimum protections.',
    ['/', '/governance', '/audit', '/grants', '/membership'],
    [
      'Worker record contents (you review access events and grants, not records)',
      'Supervision or mentorship content',
      'Employer-side views',
    ],
    {
      actingContext: 'You are acting as privacy lead, within your hub’s scope.',
      purpose: 'Guard the common floor: consent, access, and the minimum protections.',
      attentionQueue: 'Access reviews, consent disputes, and complaints routed to privacy.',
      coreWork: 'Consent and access review, complaint handling, privacy guidance.',
      handoffs: 'Escalations to the steering circle or council through the defined route.',
      learningAccountability: 'Privacy decisions are recorded under this acting capacity.',
      boundaries: 'Privacy review inspects access events and grants — never record contents.',
    },
    true,
  ),
  steeringCircle: manifest(
    'steeringCircle',
    'Steering Circle Member',
    'Hub governance: decisions that belong to the hub, made in the open.',
    ['/', '/governance', '/aggregates', '/audit', '/grants', '/membership'],
    [
      'Individual worker records',
      'Supervision or mentorship content',
      'Employer-side views',
    ],
    {
      actingContext: 'You are acting as a steering circle member, within your hub’s scope.',
      purpose: 'Hub governance: the decisions that belong to the hub, made in the open.',
      attentionQueue: 'Decisions awaiting the circle and complaints routed to governance.',
      coreWork: 'Governance decisions, published for the hub to see.',
      handoffs: 'Upward: what the hub sends to the backbone or council, through defined routes.',
      learningAccountability: 'Decisions are published; the circle answers for them.',
      boundaries: 'Governance never inspects individual worker records.',
    },
    true,
  ),
  council: manifest(
    'council',
    'National Council Member',
    'National governance: the decisions that belong to the whole Network.',
    ['/', '/governance', '/aggregates', '/audit', '/grants', '/membership'],
    [
      'Individual worker records',
      'Hub-internal records outside published aggregates and decisions',
      'Supervision or mentorship content',
    ],
    {
      actingContext: 'You are acting as a national council member, national scope.',
      purpose: 'National governance: the decisions that belong to the whole Network.',
      attentionQueue: 'Decisions awaiting council and matters escalated from hubs.',
      coreWork: 'National decisions, published for the Network to see.',
      handoffs: 'Downward: resources and guidance to hubs. Upward: aggregates only.',
      learningAccountability: 'Council decisions are published; the council answers for them.',
      boundaries: 'Council never inspects individual worker records or hub-internal detail.',
    },
    true,
  ),
  backboneLead: manifest(
    'backboneLead',
    'Backbone Lead',
    'Coordinates the Network: materials, systems, workforce intelligence, evaluation.',
    ['/', '/governance', '/aggregates', '/audit', '/grants', '/membership'],
    [
      'Individual worker records',
      'Raw evaluation submissions',
      'Hub-internal records outside published aggregates',
    ],
    {
      actingContext: 'You are acting as backbone lead, national scope.',
      purpose: 'Coordinate the Network so hubs can do the work.',
      attentionQueue: 'Evaluation releases, hub requests, and coordination items.',
      coreWork: 'Materials, systems, workforce-intelligence aggregation, evaluation coordination.',
      handoffs: 'Resources flowing down to hubs; learning flowing both ways.',
      learningAccountability: 'Backbone coordination is recorded under this acting capacity.',
      boundaries: 'The backbone never sees raw worker data — aggregates only, cells of 5+.',
    },
  ),
  analyst: manifest(
    'analyst',
    'Workforce-Intelligence Analyst',
    'Turns protected information into aggregates the Network can learn from.',
    ['/', '/aggregates', '/audit', '/grants'],
    [
      'Raw worker records and raw evaluation submissions',
      'Any aggregate cell smaller than 5',
      'Identifiable breakdowns',
    ],
    {
      actingContext: 'You are acting as a workforce-intelligence analyst, national scope.',
      purpose: 'Turn protected information into aggregates the Network can learn from.',
      attentionQueue: 'Aggregate releases awaiting review and inference-review flags.',
      coreWork: 'Aggregate review: check cells, check inference risk, release or suppress.',
      handoffs: 'Released aggregates to the backbone, council, and hubs.',
      learningAccountability: 'Every release is recorded: what was published, what was suppressed, and why.',
      boundaries: 'Analysts never touch raw records. Cells under 5 are suppressed, always.',
    },
  ),
  researcher: manifest(
    'researcher',
    'Research Unit Member',
    'Independent research, on consented data, at arm’s length from operations.',
    ['/', '/aggregates', '/audit', '/grants'],
    [
      'Raw worker records without explicit research consent',
      'Operational data beyond the approved research scope',
      'Identifiable data of any kind',
    ],
    {
      actingContext: 'You are acting as a research unit member, within your approved research scope.',
      purpose: 'Independent research on consented data, at arm’s length from operations.',
      attentionQueue: 'Research consent status and data requests within scope.',
      coreWork: 'Research on de-identified, consented data within the approved scope.',
      handoffs: 'Findings back to the Network as published learning, never as raw data.',
      learningAccountability: 'Research access is recorded under this acting capacity and scope.',
      boundaries: 'Research never touches raw records without explicit research consent.',
    },
    true,
  ),
  employer: manifest(
    'employer',
    'Employer',
    'A boundary partner: hosts peer work, meets readiness gates, receives consented information only.',
    ['/', '/readiness', '/opportunities', '/governance', '/audit', '/grants'],
    [
      'Worker records',
      'Mentorship notes',
      'Supervision observations (except through the agreed channel)',
      'Other employers’ information',
    ],
    {
      actingContext: 'You are acting as an employer, within your organisation’s scope.',
      purpose: 'Host peer work well: meet the readiness gates, receive only consented information.',
      attentionQueue: 'Readiness gates, postings, and applications consented to you.',
      coreWork: 'Readiness self-assessment and opportunity postings.',
      handoffs: 'Applications arrive here only as the worker consented.',
      learningAccountability: 'Employer access is recorded under this acting capacity.',
      boundaries: 'Employers never see worker records, mentorship, or supervision content.',
    },
    true,
  ),
  systemAdmin: manifest(
    'systemAdmin',
    'System Administrator (operational)',
    'Keeps the platform running. An operational capacity, not a business role.',
    ['/', '/audit', '/grants'],
    [
      'Worker records (operational access grants no data access)',
      'Any business data beyond what operations require',
    ],
    {
      actingContext: 'You are acting in the operational capacity. This is not a data role.',
      purpose: 'Keep the platform running: configuration, health, and operations.',
      attentionQueue: 'Operational health items only.',
      coreWork: 'Platform operations.',
      handoffs: 'Operational handoffs to the backbone.',
      learningAccountability: 'Operational actions are recorded under this acting capacity.',
      boundaries: 'Operations never opens worker records. If a task needs data access, it goes through a business role and its grants.',
    },
    true,
  ),
};

/** Look up the manifest for a role; falls back to the worker manifest. */
export function getManifest(role: AnyRole): RoleManifest {
  return ROLE_MANIFESTS[role] ?? ROLE_MANIFESTS.worker;
}

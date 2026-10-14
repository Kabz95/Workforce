import type { CanonicalRoleId } from './types';

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  actionLabel?: string;
  actionPath?: string;
  urgency: 'low' | 'medium' | 'high';
}

export interface CoreWorkModule {
  id: string;
  title: string;
  description: string;
  path: string;
  commandLabel: string;
}

export interface HandoffModule {
  available: boolean;
  canInitiate: boolean;
  canReceive: boolean;
  description: string;
}

export interface LearningAccountabilityModule {
  title: string;
  description: string;
  path: string;
  metricLabel?: string;
}

export interface RoleManifest {
  roleId: CanonicalRoleId;
  version: string;
  title: string;
  charter: string;
  emptyState: {
    title: string;
    description: string;
  };
  attentionQueue: AttentionItem[];
  coreWork: CoreWorkModule[];
  handoffs: HandoffModule;
  learningAccountability: LearningAccountabilityModule[];
  boundaries: string[];
}

export const ROLE_MANIFESTS: Record<CanonicalRoleId, RoleManifest> = {
  worker: {
    roleId: 'worker',
    version: '1.0.0',
    title: 'Peer Worker',
    charter: 'Own pathway, records, consent.',
    emptyState: {
      title: 'Welcome to Your Worker Workspace',
      description: 'Your records belong to you. Start by adding your first pathway step or reviewing your consent grants.',
    },
    attentionQueue: [
      {
        id: 'review-consents',
        title: 'Review Active Consent Grants',
        detail: 'Ensure only trusted colleagues have access to your wayfinding steps.',
        actionLabel: 'Manage Consents',
        actionPath: '/consents',
        urgency: 'medium',
      },
    ],
    coreWork: [
      {
        id: 'pathway-steps',
        title: 'Career & Credential Pathway',
        description: 'Track your competency milestones, certifications, and wayfinding steps.',
        path: '/pathway',
        commandLabel: 'Open Pathway →',
      },
      {
        id: 'first-contact',
        title: 'First-Contact & Intake',
        description: 'Record confidential intake notes and peer encounter reflections.',
        path: '/record',
        commandLabel: 'Open Records →',
      },
      {
        id: 'opportunities',
        title: 'Peer Opportunities',
        description: 'Browse paid peer support roles and postings within this hub.',
        path: '/opportunities',
        commandLabel: 'Browse Opportunities →',
      },
    ],
    handoffs: {
      available: true,
      canInitiate: true,
      canReceive: true,
      description: 'Consented handoffs: Worker reviews purpose and recipient before any access is granted.',
    },
    learningAccountability: [
      {
        title: 'My Audit Trail',
        description: 'Plain-language log of every recorded access to your documents.',
        path: '/audit',
      },
      {
        title: 'Network Governance',
        description: 'Browse published circle decisions and policy agreements.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Cannot view other workers’ raw records.',
      'Cannot access unreviewed supervisor logs or line management files.',
      'Cannot bypass regional hub boundaries without consented sharing.',
    ],
  },

  navigator: {
    roleId: 'navigator',
    version: '1.0.0',
    title: 'Certification Navigator',
    charter: 'Certification navigation — wayfinding; never predicts, never assesses.',
    emptyState: {
      title: 'Navigation Workspace',
      description: 'Assist workers with wayfinding and credential planning upon request.',
    },
    attentionQueue: [
      {
        id: 'shared-pathways',
        title: 'Review Consented Pathways',
        detail: 'Workers who granted you navigation scope for pathway guidance.',
        actionLabel: 'View Shared Steps',
        actionPath: '/pathway',
        urgency: 'low',
      },
    ],
    coreWork: [
      {
        id: 'wayfinding',
        title: 'Pathway Navigation & Credential Guide',
        description: 'Wayfinding guidance for provincial and national certification requirements.',
        path: '/pathway',
        commandLabel: 'Open Navigation Deck →',
      },
      {
        id: 'intake-support',
        title: 'Assigned Intake Forms',
        description: 'View first-contact forms shared under explicit wayfinding consent.',
        path: '/record',
        commandLabel: 'View Shared Forms →',
      },
    ],
    handoffs: {
      available: true,
      canInitiate: true,
      canReceive: true,
      description: 'Draft minimum handoff payloads for worker review and consent.',
    },
    learningAccountability: [
      {
        title: 'Navigation Standards',
        description: 'Published competency rubrics and non-predictive wayfinding guidelines.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Never assesses certification readiness or predicts examination outcomes.',
      'Never shares draft pathway steps without worker acceptance.',
      'Sees only records explicitly shared for wayfinding.',
    ],
  },

  mentor: {
    roleId: 'mentor',
    version: '1.0.0',
    title: 'Peer Mentor',
    charter: 'Developmental companionship; no authority over duties or employment.',
    emptyState: {
      title: 'Mentorship Workspace',
      description: 'Developmental companionship space for assigned peer relationships.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'mentorship-sessions',
        title: 'Companionship Journal',
        description: 'Developmental notes and reflective prompts shared with your mentees.',
        path: '/pathway',
        commandLabel: 'Open Sessions →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Mentorship is confidential and holds no handoff authority.',
    },
    learningAccountability: [
      {
        title: 'Community of Practice',
        description: 'Peer mentorship circles and ethical companionship resources.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Never submits reports to an employer or line manager.',
      'Never assesses worker performance or assigns duties.',
      'Cannot browse worker records without an active, explicit consent grant.',
    ],
  },

  supervisor: {
    roleId: 'supervisor',
    version: '1.0.0',
    title: 'Practice Supervisor',
    charter: 'Reflective practice and role integrity (Proctor’s three functions).',
    emptyState: {
      title: 'Practice Supervision Workspace',
      description: 'Supervision space for reflective practice, ethical boundaries, and role integrity.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'supervision-sessions',
        title: 'Reflective Supervision Notes',
        description: 'Normative, formative, and restorative supervision records.',
        path: '/record',
        commandLabel: 'Supervision Records →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Supervision notes are confidential and never transferred to employers.',
    },
    learningAccountability: [
      {
        title: 'Supervisory Standards',
        description: 'Proctor’s three functions supervision framework and integrity guidelines.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Never discloses supervision notes to an employer outside agreed channels.',
      'Cannot browse worker records outside assigned supervision relationships.',
      'Cannot override worker consent grants.',
    ],
  },

  facilitator: {
    roleId: 'facilitator',
    version: '1.0.0',
    title: 'Learning Facilitator',
    charter: 'Learning cycles and communities of practice.',
    emptyState: {
      title: 'Facilitator Deck',
      description: 'Coordinate learning cycles and peer reflective spaces.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'learning-cycles',
        title: 'Learning Circles',
        description: 'Curriculum resources, reflective questions, and group dialogue guides.',
        path: '/governance',
        commandLabel: 'Learning Materials →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Facilitators hold group circles and do not handle individual case handoffs.',
    },
    learningAccountability: [
      {
        title: 'Adaptation Logs',
        description: 'Document localized adaptations to national training materials.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Never accesses individual worker clinical or employment files.',
      'Never grades or evaluates individual competency.',
      'Facilitates group learning spaces only.',
    ],
  },

  hubCoordinator: {
    roleId: 'hubCoordinator',
    version: '1.0.0',
    title: 'Hub Coordinator',
    charter: 'Local capacity and safety procedure (hub’s operating desk).',
    emptyState: {
      title: 'Hub Operating Desk',
      description: 'Oversee regional hub capacity, agreements, and safety procedures.',
    },
    attentionQueue: [
      {
        id: 'hub-capacity',
        title: 'Hub Health & Capacity',
        detail: 'Review mentor availability and active navigation caseload.',
        actionLabel: 'Check Capacity',
        actionPath: '/readiness',
        urgency: 'low',
      },
    ],
    coreWork: [
      {
        id: 'employer-readiness',
        title: 'Employer Readiness Evaluations',
        description: 'Review organizational readiness self-assessments submitted by employers.',
        path: '/readiness',
        commandLabel: 'View Readiness →',
      },
      {
        id: 'hub-opportunities',
        title: 'Hub Opportunities Desk',
        description: 'Review and approve peer employment postings within this hub.',
        path: '/opportunities',
        commandLabel: 'Manage Postings →',
      },
    ],
    handoffs: {
      available: true,
      canInitiate: false,
      canReceive: true,
      description: 'Monitors routing SLAs and overdue handoff alerts without narrative access.',
    },
    learningAccountability: [
      {
        title: 'Hub Decision Records',
        description: 'Record local hub governance decisions and capacity resolutions.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Never browses raw worker files or case notes.',
      'Sees queue metadata and capacity metrics, not personal narrative.',
      'Cannot reassign worker consent grants without worker authorization.',
    ],
  },

  privacyLead: {
    roleId: 'privacyLead',
    version: '1.0.0',
    title: 'Privacy Lead',
    charter: 'Consent and access discipline; sees the machinery, not the content.',
    emptyState: {
      title: 'Privacy & Access Discipline Desk',
      description: 'Monitor consent lifecycle, access anomalies, and audit integrity.',
    },
    attentionQueue: [
      {
        id: 'audit-verification',
        title: 'Audit Trail Verification',
        detail: 'Verify server-authored audit log continuity and consent revocation timestamps.',
        actionLabel: 'Inspect Logs',
        actionPath: '/audit',
        urgency: 'medium',
      },
    ],
    coreWork: [
      {
        id: 'access-events',
        title: 'Access Events & Audit Monitor',
        description: 'Examine server-authored access events, correlation IDs, and acting contexts.',
        path: '/audit',
        commandLabel: 'Audit Dashboard →',
      },
      {
        id: 'consent-machinery',
        title: 'Consent Machinery Metrics',
        description: 'Monitor grant lifecycles, scheduled expirations, and revocation triggers.',
        path: '/consents',
        commandLabel: 'Consent Statistics →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Reviews handoff audit stamps without viewing payload narrative.',
    },
    learningAccountability: [
      {
        title: 'Privacy Reviews',
        description: 'Document privacy impact assessments and data minimisation audits.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Sees access logs, consent status, and audit timestamps — NEVER record contents.',
      'Cannot browse worker pathways or contact forms.',
      'Not a System Admin; holds no elevated operational infrastructure keys.',
    ],
  },

  steeringCircle: {
    roleId: 'steeringCircle',
    version: '1.0.0',
    title: 'Steering Circle Member',
    charter: 'Local (hub) accountability.',
    emptyState: {
      title: 'Local Steering Circle',
      description: 'Review hub-level decisions, community feedback, and protected aggregates.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'circle-decisions',
        title: 'Decision Records',
        description: 'Draft, publish, and review local circle policy and resource resolutions.',
        path: '/governance',
        commandLabel: 'Decisions Desk →',
      },
      {
        id: 'hub-aggregates',
        title: 'Hub Workforce Intelligence',
        description: 'View de-identified aggregate metrics (cells < 5 suppressed).',
        path: '/aggregates',
        commandLabel: 'View Aggregates →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'No operational handoff access.',
    },
    learningAccountability: [
      {
        title: 'Complaints & Resolutions',
        description: 'Handle peer complaints and systemic conflict mitigation.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Never sees raw worker records or identified client disclosures.',
      'Receives only protected hub aggregates (cell threshold < 5 suppressed).',
      'Cannot approve own hub agreements or grants without recusal.',
    ],
  },

  council: {
    roleId: 'council',
    version: '1.0.0',
    title: 'National Council Member',
    charter: 'National peer-majority governance; the common floor.',
    emptyState: {
      title: 'National Council',
      description: 'National peer governance, minimum protections, and national standards.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'national-decisions',
        title: 'National Standards & Resolutions',
        description: 'Ratify minimum protections and national curriculum frameworks.',
        path: '/governance',
        commandLabel: 'National Resolutions →',
      },
      {
        id: 'national-aggregates',
        title: 'National Workforce Aggregates',
        description: 'View pan-Canadian protected aggregate metrics (floor of 5).',
        path: '/aggregates',
        commandLabel: 'National Aggregates →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'No operational handoff access.',
    },
    learningAccountability: [
      {
        title: 'Accountability Register',
        description: 'Published national agreements and ethical boundary commitments.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Zero access to individual worker records across all hubs.',
      'Sees de-identified national aggregates and policy drafts only.',
      'Cannot override Indigenous data governance (OCAP).',
    ],
  },

  backboneLead: {
    roleId: 'backboneLead',
    version: '1.0.0',
    title: 'Backbone Lead',
    charter: 'National coordination and shared infrastructure.',
    emptyState: {
      title: 'Backbone Coordination',
      description: 'Steward shared platform infrastructure and resource dissemination.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'resource-flow',
        title: 'Resource Releases',
        description: 'Disseminate funding formulas, learning materials, and toolkits to hubs.',
        path: '/governance',
        commandLabel: 'Shared Materials →',
      },
      {
        id: 'workforce-metrics',
        title: 'De-identified Intelligence',
        description: 'Pan-Canadian workforce counts and distributions (never individuals).',
        path: '/aggregates',
        commandLabel: 'Review Aggregates →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Raw worker data never travels up to the backbone.',
    },
    learningAccountability: [
      {
        title: 'Shared Infrastructure Log',
        description: 'Platform version releases and national coordination audits.',
        path: '/audit',
      },
    ],
    boundaries: [
      'Resources flow down; raw worker data NEVER flows up.',
      'No access to local hub operational queues or individual files.',
      'Cannot unilaterally alter role charters or minimum protections.',
    ],
  },

  analyst: {
    roleId: 'analyst',
    version: '1.0.0',
    title: 'Workforce Analyst',
    charter: 'Protected aggregates only (workforce intelligence).',
    emptyState: {
      title: 'Workforce Intelligence Deck',
      description: 'Analyze protected workforce distributions, retention metrics, and training trends.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'aggregate-reports',
        title: 'Workforce Aggregates Desk',
        description: 'Run de-identified cohort analyses with strict cell suppression (< 5).',
        path: '/aggregates',
        commandLabel: 'Open Aggregates →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Analysts hold no handoff operational capacity.',
    },
    learningAccountability: [
      {
        title: 'Aggregation Methodologies',
        description: 'Audit logs for k-anonymity suppression and differential privacy validation.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Strict suppression: cells smaller than 5 are suppressed by law.',
      'Zero access to raw records, names, or individual timestamps.',
      'No inference attacks or re-identification attempts.',
    ],
  },

  researcher: {
    roleId: 'researcher',
    version: '1.0.0',
    title: 'Ethical Researcher',
    charter: 'Ethical, coded research under separate consent.',
    emptyState: {
      title: 'Research Workspace',
      description: 'Coded study files and participant research ethics agreements.',
    },
    attentionQueue: [],
    coreWork: [
      {
        id: 'research-studies',
        title: 'Approved Protocols',
        description: 'Coded research cohorts with verified participant research consent.',
        path: '/aggregates',
        commandLabel: 'Coded Research Files →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Researchers do not participate in practice handoffs.',
    },
    learningAccountability: [
      {
        title: 'Ethics Protocols',
        description: 'Documented research ethics approvals and data destruction schedules.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Requires separate, documented research ethics consent from each participant.',
      'Never inherits operational or hub coordinator access.',
      'Data must be coded and destroyed per protocol schedule.',
    ],
  },

  employer: {
    roleId: 'employer',
    version: '1.0.0',
    title: 'Employer Representative',
    charter: 'Employment relationship only (boundary workspace).',
    emptyState: {
      title: 'Employer Boundary Workspace',
      description: 'Postings, submitted applications, and organizational readiness assessments.',
    },
    attentionQueue: [
      {
        id: 'readiness-assessment',
        title: 'Organizational Readiness Self-Assessment',
        detail: 'Evaluate employer policies against peer practice standards.',
        actionLabel: 'Complete Assessment',
        actionPath: '/readiness',
        urgency: 'medium',
      },
    ],
    coreWork: [
      {
        id: 'job-postings',
        title: 'Opportunity Postings',
        description: 'Publish verified peer support job openings within the hub.',
        path: '/opportunities',
        commandLabel: 'Manage Postings →',
      },
      {
        id: 'readiness-self-assessment',
        title: 'Readiness Self-Assessment',
        description: 'Review your hub-verified peer support organizational readiness score.',
        path: '/readiness',
        commandLabel: 'Readiness Checklist →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Employers only receive submitted applications; never worker records.',
    },
    learningAccountability: [
      {
        title: 'Peer Supervision Standards',
        description: 'Guidelines on Proctor’s model and boundary protection for peer roles.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Sees only applications submitted specifically to their postings.',
      'NEVER sees worker pathways, mentorship notes, or peer supervision files.',
      'No access to network governance or internal hub discussions.',
    ],
  },

  systemAdmin: {
    roleId: 'systemAdmin',
    version: '1.0.0',
    title: 'System Administrator (Operational)',
    charter: 'Time-limited, audited operational infrastructure access.',
    emptyState: {
      title: 'Operational Infrastructure Console',
      description: 'Operational capacity only: no business dashboard. All commands are audited.',
    },
    attentionQueue: [
      {
        id: 'system-audit',
        title: 'System Operational Logs',
        detail: 'Inspect server health, Cloud Functions performance, and security rules.',
        actionLabel: 'View Audit Logs',
        actionPath: '/audit',
        urgency: 'low',
      },
    ],
    coreWork: [
      {
        id: 'security-audit',
        title: 'System Access Audits',
        description: 'Immutable server-authored access logs and break-glass events.',
        path: '/audit',
        commandLabel: 'Audit Trails →',
      },
    ],
    handoffs: {
      available: false,
      canInitiate: false,
      canReceive: false,
      description: 'Operational role has zero practice handoff capacity.',
    },
    learningAccountability: [
      {
        title: 'Operational Governance',
        description: 'Platform version logs and architecture specifications.',
        path: '/governance',
      },
    ],
    boundaries: [
      'Operational capacity only; NO business dashboard.',
      'No permission to browse worker records or clinical narrative.',
      'Every action is stamped into immutable server-authoritative audit logs.',
    ],
  },
};

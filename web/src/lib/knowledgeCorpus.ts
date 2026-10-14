import type { HelpArticle } from './types';

export interface PreSeededArticle extends HelpArticle {
  id: string;
}

export const KNOWLEDGE_CORPUS: PreSeededArticle[] = [
  {
    id: 'worker-charter-v1',
    title: 'Worker Self-Determination & Data Sovereignty Charter',
    summary: 'Guiding constitutional principles of worker record ownership, self-directed pathway milestones, and uncoerced consent.',
    category: 'roles',
    audience: 'worker',
    jurisdiction: 'national',
    version: '1.2.0',
    status: 'published',
    authorCircle: 'National Council / Steering Circle',
    tags: ['worker', 'charter', 'data-sovereignty', 'self-determination'],
    content: `### 1. The Core Principle
In the Peer Support Workforce Network, peer workers own their records, their wayfinding pathways, and their consent decisions. The peer worker is at the centre of the system; rings of authority represent functions of support, not hierarchy.

### 2. Privacy and Worker Sovereignty
- First-contact notes, intake logs, and competency evidence are stored under worker-owned documents.
- No supervisor, mentor, or employer can access worker records without an active, granular consent grant.
- Consent grants are specific, time-limited, and revocable at any moment with immediate effect under Law 25 / Bill 64 principles.

### 3. Non-Surveillance Guarantee
Aggregates travel upward; personal records never do. Analytics collected by the network are strictly anonymized using k-anonymity (k >= 5 cell suppression) to prevent re-identification.`,
  },
  {
    id: 'navigator-guide-v1',
    title: 'Certification & Credential Navigation Guide',
    summary: 'How navigators assist peer workers in building competency portfolios without exercising employer or managerial control.',
    category: 'pathway',
    audience: 'navigator',
    jurisdiction: 'national',
    version: '1.1.0',
    status: 'published',
    authorCircle: 'Practice & Learning Circle',
    tags: ['navigator', 'portfolio', 'certification', 'competencies'],
    content: `### 1. Purpose of the Navigator Role
Navigators provide structural wayfinding for peer workers navigating credentialing, certification portfolios, and career pathways.

### 2. Operational Procedures
- When a worker requests navigation assistance, the worker initiates a consent grant specifically scoped to their Pathway Steps.
- Navigators review evidence portfolios and offer feedback on standard alignment.
- Navigators do not evaluate employment performance and cannot share portfolio drafts with employers without written worker authorization.`,
  },
  {
    id: 'mentor-practice-boundary-v1',
    title: 'Peer Mentorship Framework & Practice Boundaries',
    summary: 'Mentorship companioning, reflective listening, and the strict non-disclosure boundary to line management and employers.',
    category: 'practice',
    audience: 'mentor',
    jurisdiction: 'national',
    version: '1.0.0',
    status: 'published',
    authorCircle: 'Communities of Practice',
    tags: ['mentor', 'reflective-practice', 'boundaries', 'confidentiality'],
    content: `### 1. Peer Mentorship Stance
Peer mentorship is an egalitarian relationship of mutual learning, solidarity, and shared lived experience. Mentors walk alongside colleagues as reflective companions.

### 2. The Strict Employer Non-Disclosure Boundary
- Mentors NEVER submit reports, notes, or verbal assessments to a worker's employer or line manager.
- Mentorship conversations are confidential between participants.
- If a mentor identifies an organizational safety concern, they support the worker in identifying self-directed reporting channels rather than reporting on their behalf.`,
  },
  {
    id: 'supervisor-three-functions-v1',
    title: 'Practice Supervision: Proctor’s Three Functions',
    summary: 'Normative, Formative, and Restorative supervision framework. Supervision records are strictly confidential and outside employer line management.',
    category: 'supervision',
    audience: 'supervisor',
    jurisdiction: 'national',
    version: '1.3.0',
    status: 'published',
    authorCircle: 'Supervision & Standards Circle',
    tags: ['supervisor', 'proctor', 'reflective-supervision', 'restorative'],
    content: `### 1. Proctor’s Three Functions of Supervision
1. **Formative (Developmental)**: Deepening peer practice competencies, ethical navigation, and critical reflection.
2. **Restorative (Supportive)**: Holding emotional space, processing secondary trauma, and sustaining worker well-being.
3. **Normative (Role Integrity)**: Guarding peer support distinctiveness, scope of practice, and organizational boundaries.

### 2. Supervision Boundaries
- Practice supervision is distinct from administrative management. Supervisors do not approve vacation, handle disciplinary action, or set pay.
- Supervision notes remain private between supervisor and supervisee. They are not discoverable by employers in performance reviews.`,
  },
  {
    id: 'facilitator-cop-guide-v1',
    title: 'Communities of Practice Facilitation & Learning Circles',
    summary: 'Guidelines for holding peer learning circles, localized curriculum adaptation proposals, and anti-oppressive group dynamics.',
    category: 'learning',
    audience: 'facilitator',
    jurisdiction: 'national',
    version: '1.0.0',
    status: 'published',
    authorCircle: 'Learning & Adaptation Circle',
    tags: ['facilitator', 'cop', 'learning-circles', 'adaptation'],
    content: `### 1. The Role of the Learning Facilitator
Facilitators hold group circles and learning cycles. They cultivate psychological safety, ensure equitable voices, and record collective insights.

### 2. Localized Adaptation Process
- Hubs have the right to propose adaptations to national training materials to reflect cultural, linguistic, and territorial realities.
- Adaptations distinguish between Core principles (non-negotiable peer ethos) and Form (local expression, vernacular, schedule).
- Facilitators log adaptation proposals in the national registry for transparent review by the Learning Circle.`,
  },
  {
    id: 'privacy-law25-bill64-v1',
    title: 'Quebec Law 25 (Bill 64) & Canadian Privacy Standard',
    summary: 'Consent lifecycle, purpose limitation, right to erasure, and mandatory privacy impact assessments under Quebec Law 25.',
    category: 'governance',
    audience: 'privacyLead',
    jurisdiction: 'qc',
    version: '2.0.0',
    status: 'published',
    authorCircle: 'Privacy & Legal Governance Circle',
    tags: ['privacy', 'law-25', 'bill-64', 'consent-revocation', 'erasure'],
    content: `### 1. Legislative Alignment (Law 25 / Bill 64)
The platform operates under the highest Canadian privacy standard, complying with Quebec's Law 25:
- **Default Privacy**: Highest security settings enabled by default.
- **Granular Consent**: Clear purpose statement for every grant; no bundled consents.
- **Instant Revocation**: When a granter revokes consent, access is removed instantaneously across all documents.
- **Right to Erasure (De-indexing)**: Workers may trigger complete deletion of their profile records via self-service or Privacy Lead request.

### 2. Role of the Privacy Lead
The Privacy Lead audits server-authored access events, oversees consent health, and verifies that no worker narratives enter aggregate analytics.`,
  },
  {
    id: 'safeguarding-crisis-protocol-v1',
    title: 'Network Safeguarding & Crisis Escalation Protocol',
    summary: 'Immediate deterministic actions for crisis or safety risks. 24/7 National 988 Suicide Crisis Helpline and regional crisis lines.',
    category: 'safeguarding',
    audience: 'all',
    jurisdiction: 'national',
    version: '1.0.0',
    status: 'published',
    authorCircle: 'National Steering Circle',
    tags: ['safeguarding', 'crisis', 'emergency', 'helpline', '988'],
    content: `### ⚠️ Immediate Crisis Emergency Contacts
If you or someone you are supporting is experiencing acute distress, thoughts of suicide, or immediate danger:

- **National Suicide Crisis Helpline**: Call or text **988** (Toll-free, 24/7, bilingual English/French across Canada).
- **Quebec Suicide Prevention**: Call **1-866-APPELLE (1-866-277-3553)** or visit suicide.ca.
- **Indigenous Hope for Wellness**: Call **1-855-242-3310** (24/7 support in English, French, Cree, Ojibway, Inuktitut).
- **Emergency Services**: Dial **911** for urgent medical or physical safety emergencies.

### Platform Boundary Note
The AI App-Support Assistant does not provide clinical counselling, crisis intervention, or emergency assessment. Any query touching on self-harm or acute distress is immediately redirected to these deterministic human crisis lines.`,
  },
  {
    id: 'error-codes-self-service-v1',
    title: 'Platform Error Codes & Self-Resolution Guide',
    summary: 'Resolution steps for common error codes: PERMISSION_DENIED, POPUP_BLOCKED, AUTH_DOMAIN, and NETWORK_UNAVAILABLE.',
    category: 'technical',
    audience: 'all',
    jurisdiction: 'national',
    version: '1.0.0',
    status: 'published',
    authorCircle: 'Platform Engineering & Support Circle',
    tags: ['errors', 'troubleshooting', 'permission-denied', 'auth', 'popup'],
    content: `### Common Error Codes and Fixes

#### 1. PERMISSION_DENIED (403)
- **Cause**: Attempting to view a record belonging to another worker without a valid, unexpired consent grant.
- **Fix**: Verify your active acting role in the Role Switcher. If acting as Mentor or Supervisor, request the worker issue a consent grant from their Consents page.

#### 2. POPUP_BLOCKED
- **Cause**: Browser blocked the Google Sign-In popup window.
- **Fix**: Check your browser address bar for the popup icon, choose "Always allow popups for this site", and retry.

#### 3. AUTH_UNAUTHORIZED_DOMAIN
- **Cause**: The current web domain is not on Firebase Authentication's authorized domains list.
- **Fix**: Contact Hub Support or ensure you are visiting via the official hosted URL.

#### 4. NETWORK_UNAVAILABLE
- **Cause**: Temporary loss of internet connection.
- **Fix**: The platform continues to operate in read-only cached mode where supported. Reconnect to resume live synchronization.`,
  },
  {
    id: 'circular-agreements-charter-v1',
    title: 'Circular Cohesion Agreements: Mutual Commitments Without Hierarchy',
    summary: 'How peer workers, mentors, and hubs establish mutual practice agreements and maintain reciprocal accountability.',
    category: 'governance',
    audience: 'all',
    jurisdiction: 'national',
    version: '1.0.0',
    status: 'published',
    authorCircle: 'Governance & Accountability Circle',
    tags: ['agreements', 'circular-governance', 'commitments', 'solidarity'],
    content: `### 1. What Are Circular Agreements?
Unlike corporate employment contracts where authority flows from the top down, Circular Cohesion Agreements are bilateral or multilateral commitments made between peers, practice companions, and hub coordinators.

### 2. Agreement Lifecycle
1. **Proposal**: Either party drafts terms regarding meeting cadence, reflective focus, and mutual boundaries.
2. **Review & Co-Design**: Both participants review and refine the commitment.
3. **Active**: Both participants confirm agreement.
4. **Scheduled Review**: Periodic review (e.g. 90 days) to adjust or renew.
5. **Graceful Completion**: Agreements conclude naturally without punitive marks.`,
  },
];

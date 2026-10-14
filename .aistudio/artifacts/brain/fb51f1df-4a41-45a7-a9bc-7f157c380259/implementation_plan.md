# Phase 3: Governed Expansion Plan (P3.0 Architecture & Delivery Brief)

Comprehensive architecture and implementation plan for Phase 3 of the **Peer Support Workforce Network**, establishing a 24/7 record-blind app-support agent, a human-governed public knowledge pipeline, circular infrastructure objects, protected aggregate learning, and complete role manifests across three delivery waves.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The five foundational choices from the Decision Register (Phase 3 Brief v1.0) are frozen as follows for P3.0 execution:

- **Confirmed Decision 1 (Corpus Authority)**: The **National Council / Governance Circle** acts as the primary approving authority for published help content and network knowledge, with day-to-day stewardship and privacy review co-signed by the **Privacy Lead**.
- **Confirmed Decision 2 (Escalation Ownership & Deterministic Lanes)**: High-stakes escalations leave the AI model immediately and route to dedicated human channels:
  - `ACCOUNT` $\rightarrow$ Secure account support & invitation flow (never collects credentials in chat).
  - `PRIVACY` $\rightarrow$ Privacy Lead incident register with minimized metadata.
  - `GOVERNANCE` $\rightarrow$ National Governance Circle / Steering Circle dispute procedure.
  - `SAFEGUARDING` $\rightarrow$ Jurisdiction-specific crisis & emergency hotlines with fixed safety panel (zero conversational counselling).
  - `EMPLOYMENT` $\rightarrow$ Employer boundary workspace / independent mediation.
  - `TECHNICAL` $\rightarrow$ Sanitized incident queue (carrying app version, route, timestamp, sanitized error code).
- **Confirmed Decision 3 (Strict Zero-Retention Posture)**: Zero storage of conversational transcripts in database or cloud logs. No training or fine-tuning on user interactions. Model memory is ephemeral per request. Embeddings caching is strictly limited to the immutable approved public corpus.
- **Confirmed Decision 4 (Language Scope)**: English-first launch for baseline evaluation and synthetic pilot; French corpus requires human translation and safeguarding review before public indexing.
- **Confirmed Decision 5 (Role Manifest Rollout Sequence)**: Wave A implemented first (`privacyLead`, `facilitator`, `mentor`, `supervisor`), followed by Wave B (`steeringCircle`, `council`, `backboneLead`), then Wave C (`analyst`, `researcher`, `employer`).

---

## 1. Overview & Core Concept

### What It Does
Phase 3 expands the Peer Support Workforce Network into an autonomous learning system that **learns without watching people**. It introduces:
1. **24/7 Record-Blind App-Support Agent**: A guided, citation-grounded assistant that explains platform features, policies, error codes, and navigation routes. It operates under a strict context envelope (role, route, version, sanitized error code) and cannot access worker records, case narratives, or private discussions.
2. **Public Knowledge Pipeline**: A governed publication workflow (`Submit` $\rightarrow$ `Review` $\rightarrow$ `Approve` $\rightarrow$ `Index` $\rightarrow$ `Expire`) ensuring every public article has explicit provenance, licensing, audience, and jurisdiction tags.
3. **Circular Infrastructure**: Implementation of cohesion objects (`agreements`, `assignments`, `workQueues`, `notifications`, `decisionRecords`, `adaptations`, `exceptions`, `serviceCommitments`, `publicationViews`) that coordinate peer work without hierarchical command.
4. **Protected Intelligence & Developer Recommendation Loop**: A scheduled aggregation pipeline ($k \ge 5$ threshold and differencing suppression) that converts support demand and test failures into weekly engineering recommendation briefs.
5. **Wave A Role Experiences**: Versioned manifests for Privacy Lead, Facilitator, Mentor, and Supervisor across all 7 operational zones.

### Operating Rule
$$\text{\textbf{Autonomy may classify, retrieve, summarize, and recommend. Authority remains with a named human.}}$$

---

## 2. User Experience & Visual Design

### Key User Flows

#### A. 24/7 Guided App-Support Surface
```
┌────────────────────────────────────────────────────────────────────────┐
│  App Support Assistant  [Visibly Non-Human · Grounded in Public Help]  │
├────────────────────────────────────────────────────────────────────────┤
│  ⚠️ Privacy Guard: Never enter names, case notes, or health details.   │
│                                                                        │
│  [ How do I...? ]  [ I see an error ]  [ Explain this role ]  [ Escalation ] │
│                                                                        │
│  User Query: "How do I request certification review?"                  │
│                                                                        │
│  Response:                                                             │
│  "To request certification review, navigate to the Pathway page and    │
│   submit your competency portfolio. Your designated Navigator will     │
│   receive a routing ticket."                                           │
│                                                                        │
│  Sources:                                                              │
│  📖 Certification Navigation Charter v1.2 (Audience: Network)         │
│                                                                        │
│  [ Was this helpful? Yes / No ]     [ 🔗 Route to Human Support ]      │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Structured Entry First**: Users encounter high-frequency prompt chips (`How do I...`, `I see an error`, `Explain this role`, `Contact a person`) to reduce free-text disclosure.
2. **Pre-flight Payload Redaction**: A client-side and gateway regex sanitizer detects email addresses, phone numbers, UUIDs, and credentials, warning the user and blocking sensitive submission before any AI call.
3. **Grounded Answers with Citations**: The agent renders answers with explicit source title, version, and link. If no approved article supports the query, it abstains and offers a direct human route.
4. **One-Tap Human Escalation**: Every response contains a persistent "This did not solve it" button linking to the appropriate human escalation lane.

#### B. Public Knowledge & Governance Surface
- **Knowledge Explorer**: Public search across approved role charters, standards, and adaptation summaries with filters for audience, jurisdiction, and version.
- **Editorial Review Queue**: Dedicated review screen for Governance and Privacy Leads to inspect submitted articles, check copyright/licensing, verify anonymity, and approve publication or schedule expiration.

#### C. Wave A Role Experiences (7 Zones)
Every role view follows the strict 7-zone layout:
1. **Acting Context Bar**: Current held grant, tenant hub, and active session capacity.
2. **Charter Banner**: Published mission and ethical boundary of the active role.
3. **Attention Zone**: Time-sensitive items requiring action (agreements expiring, review queues).
4. **Core Work**: Specific narrow workflows authorized for this role.
5. **Handoffs Zone**: Directed routing metadata for collaborative transitions.
6. **Learning & Accountability**: Approved aggregate metrics ($k \ge 5$) and feedback loops.
7. **Boundary Zone**: Explicit prohibition warnings (e.g. Mentor cannot access employment records; Supervisor cannot disclose outside agreement).

---

## 3. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   WEB CLIENT (Browser)                                  │
│  ┌───────────────────────┐  ┌─────────────────────────┐  ┌───────────────────────────┐  │
│  │   Support Assistant   │  │  Wave A Role Dashboards │  │ Public Knowledge Browser  │  │
│  │ (Client-Side Redactor)│  │ (7-Zone Manifest Views) │  │  (Grounded Search/Cites)  │  │
│  └───────────┬───────────┘  └────────────┬────────────┘  └─────────────┬─────────────┘  │
└──────────────┼───────────────────────────┼─────────────────────────────┼────────────────┘
               │ (Safe Context Envelope)   │                             │
               ▼                           ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                  SERVER / GATEWAY (Express / Cloud Functions v2)                        │
│                 Region: northamerica-northeast1 (Montréal, Canada)                     │
│                                                                                         │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              AI SUPPORT GATEWAY                                   │  │
│  │  1. Authenticate Request & Role Verification                                      │  │
│  │  2. Strip Forbidden Fields (No UIDs, No Emails, No Worker Records)                │  │
│  │  3. Retrieve Matching Approved Public Help Articles (Firestore 'helpCorpus')      │  │
│  │  4. Invoke Gemini API (Server-Side @google/genai, gemini-3.8-flash)                │  │
│  │  5. Validate Citations & Policy Checks (Abstain if unsupported)                   │  │
│  │  6. Emit Zero-Retention Structured Response                                       │  │
│  └───────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                         PROTECTED AGGREGATION & JOBS                              │  │
│  │  - aggregateEvaluation (Weekly k-anonymity >= 5 cell suppression)                 │  │
│  │  - expireConsents & expireAgreements (Daily automated grant cleanup)              │  │
│  │  - generateDeveloperBrief (Weekly aggregate friction & test failure proposals)    │  │
│  └───────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────┬─────────────────────────────────────────────────────────┬────────────────┘
               │                                                         │
               ▼                                                         ▼
┌───────────────────────────────────────────────┐ ┌───────────────────────────────────────┐
│     FIRESTORE (Native: peerworkforce)         │ │            GEMINI 3.8 FLASH           │
│  - helpCorpus (Public, versioned articles)    │ │   Zero Data Retention Contract        │
│  - agreements & assignments (Circular)        │ │   Server-side invocation only         │
│  - workQueues & notifications (Routing metadata)│ Structured JSON & Citation Guard      │
│  - decisionRecords & adaptations              │ └───────────────────────────────────────┘
│  - publicationViews (Suppressed aggregates)   │
│  - developerBriefs (Triageable fix proposals) │
└───────────────────────────────────────────────┘
```

### Context Envelope Contract

```typescript
export interface SafeSupportContextEnvelope {
  // ALLOWED SAFE CONTEXT
  canonicalRoleId: CanonicalRoleId;
  currentRoute: string;
  appVersion: string;
  sanitizedErrorCode?: string;
  languagePreference: 'en' | 'fr';

  // USER QUERY (Pre-redacted)
  query: string;

  // FORBIDDEN (Enforced by gateway assertion)
  // uid, email, displayName, caseNotes, workerId, tokens, cookies are rejected
}

export interface SupportAgentResponse {
  answer: string;
  grounded: boolean;
  citations: Array<{
    articleId: string;
    title: string;
    version: string;
    section?: string;
    url?: string;
  }>;
  escalationRoute?: {
    lane: 'account' | 'privacy' | 'governance' | 'safeguarding' | 'employment' | 'technical';
    label: string;
    targetUrl: string;
    urgentNotice?: string;
  };
  suggestedFollowUps: string[];
}
```

---

## 4. Implementation Steps & Milestones

### Milestone 1: P3.0 Foundation (Current Step)
1. **Data Model & Blueprints**: Define Firestore schemas in `firebase-blueprint.json` for:
   - `helpCorpus` (approved articles, role charters, governance standards).
   - `agreements`, `workQueues`, `notifications`, `decisionRecords`, `adaptations`, `exceptions`, `serviceCommitments`, `publicationViews`, `developerBriefs`.
2. **Security Rules Update**: Update `firestore.rules` with strict relational ABAC, default-deny catch-alls, immutable audit hooks, and privacy isolation.
3. **Server AI Gateway Skeleton**: Create server-side endpoint `/api/support/query` inside `server.js` using `@google/genai` (`gemini-3.8-flash`), enforcing zero transcript retention, safe context envelopes, and citation validation.
4. **Seed Public Help Corpus**: Populate core help articles for all platform roles, consent mechanics, data rights (Bill 64 / Law 25), and troubleshooting guides.

### Milestone 2: P3.1 Support Surface
1. **Guided Support Drawer / Modal**: Embed a persistent, role-aware "Help & Support" assistant in `web/src/components/SupportAssistant.tsx`.
2. **Pre-flight Sensitive Data Blocker**: Implement regex detection for phone, email, health keywords, and credentials with immediate user alert and submission blocking.
3. **Deterministic Escalation Center**: Dedicated safeguarding, privacy lead, account recovery, and governance escalation panel with zero conversational fallback.
4. **Static Search Fallback**: Seamless client-side search fallback if network or model quota is unavailable.

### Milestone 3: P3.2 Insight & Developer Recommendation Loop
1. **Anonymous Aggregate Collector**: Record support intent categories and sanitized error codes with cell floor suppression ($k \ge 5$).
2. **Developer Recommendation Brief**: Cloud Function / scheduled job to synthesize friction patterns into weekly engineering proposals inside the controlled workspace.

### Milestone 4: P3.3 Wave A Roles & Circular Infrastructure
1. **Wave A Manifests**:
   - `privacyLead`: Consent health, incident metadata, audit log inspection.
   - `facilitator`: CoP cycle, agenda, artifact proposals.
   - `mentor`: Worker-owned goals, meeting plans (no employment authority).
   - `supervisor`: Reflective agreements, session records (no employer disclosure).
2. **Circular Infrastructure UI**: Agreement viewer, work queue cards, notification bell with minimal deep links.

---

## 5. Verification & Acceptance Criteria

- [ ] **AI Boundary Tests**:
  - Request containing mock PII (email, phone, worker record text) fails at the gateway before model dispatch.
  - Model requests contain only allowed envelope fields.
  - Unsupported questions abstain cleanly without hallucinating procedures.
  - Zero conversational transcripts written to Firestore or server logs.
- [ ] **Platform Boundary Tests**:
  - Security rules enforce that only public help corpus documents are readable by the support gateway.
  - Role-switching clears all memory and UI assumptions.
  - Wave A roles cannot cross boundary constraints (e.g., mentor cannot browse worker records without explicit consent).
- [ ] **Compilation & Build**:
  - Full project passes `compile_applet` and `lint_applet`.

import { GoogleGenAI } from '@google/genai';

// Pre-seeded approved public knowledge corpus for grounding
export const SEED_CORPUS = [
  {
    id: 'worker-charter-v1',
    title: 'Worker Self-Determination & Data Sovereignty Charter',
    summary: 'Guiding constitutional principles of worker record ownership, self-directed pathway milestones, and uncoerced consent.',
    category: 'roles',
    audience: 'worker',
    version: '1.2.0',
    content: 'In the Peer Support Workforce Network, peer workers own their records, their wayfinding pathways, and their consent decisions. The peer worker is at the centre of the system; rings of authority represent functions of support, not hierarchy. First-contact notes, intake logs, and competency evidence are stored under worker-owned documents. No supervisor, mentor, or employer can access worker records without an active, granular consent grant. Consent grants are specific, time-limited, and revocable at any moment under Law 25 / Bill 64 principles. Aggregates travel upward; personal records never do.',
  },
  {
    id: 'navigator-guide-v1',
    title: 'Certification & Credential Navigation Guide',
    summary: 'How navigators assist peer workers in building competency portfolios without exercising employer or managerial control.',
    category: 'pathway',
    audience: 'navigator',
    version: '1.1.0',
    content: 'Navigators provide structural wayfinding for peer workers navigating credentialing, certification portfolios, and career pathways. When a worker requests navigation assistance, the worker initiates a consent grant specifically scoped to their Pathway Steps. Navigators review evidence portfolios and offer feedback on standard alignment. Navigators do not evaluate employment performance and cannot share portfolio drafts with employers without written worker authorization.',
  },
  {
    id: 'mentor-practice-boundary-v1',
    title: 'Peer Mentorship Framework & Practice Boundaries',
    summary: 'Mentorship companioning, reflective listening, and the strict non-disclosure boundary to line management and employers.',
    category: 'practice',
    audience: 'mentor',
    version: '1.0.0',
    content: 'Peer mentorship is an egalitarian relationship of mutual learning, solidarity, and shared lived experience. Mentors walk alongside colleagues as reflective companions. Mentors NEVER submit reports, notes, or verbal assessments to a worker\'s employer or line manager. Mentorship conversations are confidential between participants. If a mentor identifies an organizational safety concern, they support the worker in identifying self-directed reporting channels.',
  },
  {
    id: 'supervisor-three-functions-v1',
    title: 'Practice Supervision: Proctor’s Three Functions',
    summary: 'Normative, Formative, and Restorative supervision framework. Supervision records are strictly confidential and outside employer line management.',
    category: 'supervision',
    audience: 'supervisor',
    version: '1.3.0',
    content: 'Proctor’s Three Functions of Supervision: 1. Formative (development of peer competencies), 2. Restorative (holding emotional space and processing secondary trauma), 3. Normative (guarding peer support distinctiveness and role integrity). Practice supervision is distinct from administrative management. Supervisors do not approve vacation, handle disciplinary action, or set pay. Supervision notes remain private between supervisor and supervisee.',
  },
  {
    id: 'facilitator-cop-guide-v1',
    title: 'Communities of Practice Facilitation & Learning Circles',
    summary: 'Guidelines for holding peer learning circles, localized curriculum adaptation proposals, and anti-oppressive group dynamics.',
    category: 'learning',
    audience: 'facilitator',
    version: '1.0.0',
    content: 'Facilitators hold group circles and learning cycles. They cultivate psychological safety, ensure equitable voices, and record collective insights. Hubs have the right to propose adaptations to national training materials to reflect cultural, linguistic, and territorial realities. Adaptations distinguish between Core principles (non-negotiable peer ethos) and Form (local expression, vernacular, schedule).',
  },
  {
    id: 'privacy-law25-bill64-v1',
    title: 'Quebec Law 25 (Bill 64) & Canadian Privacy Standard',
    summary: 'Consent lifecycle, purpose limitation, right to erasure, and mandatory privacy impact assessments under Quebec Law 25.',
    category: 'governance',
    audience: 'privacyLead',
    version: '2.0.0',
    content: 'The platform operates under the highest Canadian privacy standard, complying with Quebec Law 25: Highest privacy settings by default. Granular consent with clear purpose for every grant. When a granter revokes consent, access is removed instantaneously across all documents. Workers may trigger complete deletion of their profile records via self-service or Privacy Lead request.',
  },
  {
    id: 'safeguarding-crisis-protocol-v1',
    title: 'Network Safeguarding & Crisis Escalation Protocol',
    summary: 'Immediate deterministic actions for crisis or safety risks. 24/7 National 988 Suicide Crisis Helpline and regional crisis lines.',
    category: 'safeguarding',
    audience: 'all',
    version: '1.0.0',
    content: 'Immediate Crisis Contacts: National Suicide Crisis Helpline: Call or text 988 (Toll-free, 24/7, bilingual English/French across Canada). Quebec Suicide Prevention: Call 1-866-APPELLE (1-866-277-3553). Indigenous Hope for Wellness: Call 1-855-242-3310. Dial 911 for urgent physical safety emergencies. The AI App-Support Assistant does not provide clinical counselling or crisis intervention.',
  },
  {
    id: 'error-codes-self-service-v1',
    title: 'Platform Error Codes & Self-Resolution Guide',
    summary: 'Resolution steps for common error codes: PERMISSION_DENIED, POPUP_BLOCKED, AUTH_DOMAIN, and NETWORK_UNAVAILABLE.',
    category: 'technical',
    audience: 'all',
    version: '1.0.0',
    content: 'Common Error Codes and Fixes: 1. PERMISSION_DENIED (403): Attempting to view a record belonging to another worker without a valid, unexpired consent grant. Verify acting role or request worker grant consent. 2. POPUP_BLOCKED: Browser blocked auth popup window. Allow popups in address bar. 3. AUTH_UNAUTHORIZED_DOMAIN: Domain not on Firebase authorized list. 4. NETWORK_UNAVAILABLE: Reconnect to resume live synchronization.',
  },
  {
    id: 'circular-agreements-charter-v1',
    title: 'Circular Cohesion Agreements: Mutual Commitments Without Hierarchy',
    summary: 'How peer workers, mentors, and hubs establish mutual practice agreements and maintain reciprocal accountability.',
    category: 'governance',
    audience: 'all',
    version: '1.0.0',
    content: 'Circular Cohesion Agreements are bilateral or multilateral commitments made between peers, practice companions, and hub coordinators. Agreement Lifecycle: Proposal -> Review & Co-Design -> Active Confirmation -> Scheduled Periodic Review (e.g. 90 days) -> Graceful Completion without punitive marks.',
  },
];

// Pre-flight regex sanitizers
const PII_EMAIL = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/;
const PII_PHONE = /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/;
const PII_SIN = /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/;
const CRISIS_KEYWORDS = /\b(suicide|kill myself|end my life|self-harm|overdose|emergency|urgent crisis|immediate danger)\b/i;

export function sanitizeEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid request: Envelope must be an object.');
  }

  const query = (envelope.query || '').trim();
  if (!query) {
    throw new Error('User query cannot be empty.');
  }

  // Check for forbidden fields
  const forbiddenKeys = ['uid', 'email', 'workerId', 'caseNotes', 'password', 'token', 'authorization'];
  for (const k of forbiddenKeys) {
    if (envelope[k]) {
      throw new Error(`Data safety violation: Field '${k}' is forbidden in the record-blind envelope.`);
    }
  }

  // Pre-flight regex checks for PII in query
  if (PII_EMAIL.test(query)) {
    throw new Error('Privacy Guard: Email addresses cannot be entered into the support assistant. Please remove identifying info.');
  }
  if (PII_PHONE.test(query)) {
    throw new Error('Privacy Guard: Phone numbers cannot be entered into the support assistant. Please remove identifying info.');
  }
  if (PII_SIN.test(query)) {
    throw new Error('Privacy Guard: Sensitive identity numbers cannot be entered into the support assistant.');
  }

  return {
    canonicalRoleId: envelope.canonicalRoleId || 'worker',
    currentRoute: envelope.currentRoute || '/',
    appVersion: envelope.appVersion || '3.0.0',
    sanitizedErrorCode: envelope.sanitizedErrorCode || undefined,
    languagePreference: envelope.languagePreference === 'fr' ? 'fr' : 'en',
    query,
  };
}

export function buildFallbackResponse(query, roleId, route, errorCode) {
  const qLower = query.toLowerCase();

  // Safeguarding check
  if (CRISIS_KEYWORDS.test(qLower)) {
    return {
      answer: `### 🚨 Immediate Crisis Support Available\n\nIf you or someone you are supporting is experiencing acute distress, please reach out directly to these human emergency helplines:\n\n- **National Suicide Crisis Helpline**: Call or text **988** (Toll-free, 24/7 across Canada)\n- **Quebec Suicide Prevention**: Call **1-866-APPELLE (1-866-277-3553)**\n- **Emergency Services**: Dial **911** immediately\n\n*The AI Support Assistant does not provide clinical counselling or emergency response.*`,
      grounded: true,
      citations: [
        {
          articleId: 'safeguarding-crisis-protocol-v1',
          title: 'Network Safeguarding & Crisis Escalation Protocol',
          version: '1.0.0',
          section: 'Immediate Crisis Emergency Contacts',
        },
      ],
      escalationRoute: {
        lane: 'safeguarding',
        label: 'View Safeguarding Resources',
        targetUrl: '/knowledge#safeguarding',
        urgentNotice: 'Immediate crisis lines are active 24/7.',
      },
      suggestedFollowUps: [
        'How do I report an urgent safety concern?',
        'What are the boundaries of a Peer Supporter?',
      ],
    };
  }

  // Error code lookup
  if (errorCode || qLower.includes('error') || qLower.includes('denied') || qLower.includes('popup')) {
    const errorArticle = SEED_CORPUS.find((a) => a.id === 'error-codes-self-service-v1');
    return {
      answer: `### Platform Troubleshooting Guide\n\nBased on your active route (\`${route}\`) and error state:\n\n- **PERMISSION_DENIED**: You may be attempting to access a worker-owned record without a valid consent grant, or under an inactive role.\n- **POPUP_BLOCKED**: Ensure popups are allowed in your browser settings for Google Sign-In.\n- **Network or Sync**: The system caches actions locally and synchronizes upon reconnection.`,
      grounded: true,
      citations: [
        {
          articleId: errorArticle.id,
          title: errorArticle.title,
          version: errorArticle.version,
          section: 'Common Error Codes and Fixes',
        },
      ],
      escalationRoute: {
        lane: 'technical',
        label: 'Open Technical Incident Ticket',
        targetUrl: '/knowledge#technical',
      },
      suggestedFollowUps: [
        'How do I switch active roles?',
        'How does a worker grant consent to a navigator or supervisor?',
      ],
    };
  }

  // Match articles by keyword score
  const matches = SEED_CORPUS.map((art) => {
    let score = 0;
    const words = qLower.split(/\s+/).filter((w) => w.length > 2);
    for (const w of words) {
      if (art.title.toLowerCase().includes(w)) score += 3;
      if (art.summary.toLowerCase().includes(w)) score += 2;
      if (art.content.toLowerCase().includes(w)) score += 1;
    }
    return { art, score };
  })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length > 0) {
    const top = matches[0].art;
    return {
      answer: `### ${top.title} (${top.version})\n\n${top.summary}\n\n**Key Guidance:**\n${top.content.split('\n\n')[0] || top.content}`,
      grounded: true,
      citations: [
        {
          articleId: top.id,
          title: top.title,
          version: top.version,
          section: 'Summary',
        },
      ],
      escalationRoute: {
        lane: top.category === 'governance' ? 'governance' : 'account',
        label: 'Need human review? Route to Circle Coordinator',
        targetUrl: '/governance',
      },
      suggestedFollowUps: [
        'How do I request certification review?',
        'What are the boundaries of a Practice Supervisor?',
        'How does consent revocation work under Law 25?',
      ],
    };
  }

  // Abstain cleanly if not grounded
  return {
    answer: `I am record-blind and can only answer questions grounded in the network's approved public help corpus. I could not find a verified public policy or documentation matching your query.\n\nPlease select one of the human escalation routes below to connect with a named coordinator.`,
    grounded: false,
    citations: [],
    escalationRoute: {
      lane: 'governance',
      label: 'Connect with Governance Circle',
      targetUrl: '/governance',
      urgentNotice: 'Unanswered questions can be routed to your regional hub coordinator.',
    },
    suggestedFollowUps: [
      'How do I request certification review?',
      'What are the boundaries of a Practice Supervisor?',
      'How does consent revocation work under Law 25?',
    ],
  };
}

export async function handleSupportQuery(envelope) {
  const safeEnv = sanitizeEnvelope(envelope);

  // Safeguarding check triggers immediate deterministic response
  if (CRISIS_KEYWORDS.test(safeEnv.query)) {
    return buildFallbackResponse(safeEnv.query, safeEnv.canonicalRoleId, safeEnv.currentRoute, safeEnv.sanitizedErrorCode);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildFallbackResponse(safeEnv.query, safeEnv.canonicalRoleId, safeEnv.currentRoute, safeEnv.sanitizedErrorCode);
  }

  try {
    const ai = new GoogleGenAI();

    // Prepare approved public corpus knowledge summary
    const corpusSummary = SEED_CORPUS.map(
      (c) => `[Article ID: ${c.id}] Title: ${c.title} (v${c.version}, Category: ${c.category})\nSummary: ${c.summary}\nContent: ${c.content}`
    ).join('\n\n---\n\n');

    const systemPrompt = `You are the 24/7 Governed App-Support Assistant for the Peer Support Workforce Network.
OPERATING RULES:
1. You are visibly non-human, record-blind, and actionless.
2. You have NO ACCESS to worker records, clinical files, personal identities, case notes, or employment dossiers.
3. You answer strictly using the provided approved public knowledge corpus below.
4. You cite source documents (Title, version, section) for every factual claim.
5. If an answer cannot be grounded in the approved corpus, you MUST ABSTAIN clearly and say you do not have verified knowledge, setting "grounded": false and recommending an escalation route.
6. Never offer psychological counseling, medical diagnoses, or formal legal advice.
7. Output valid JSON ONLY matching the schema.`;

    const userPrompt = `APPROVED PUBLIC KNOWLEDGE CORPUS:
${corpusSummary}

CURRENT USER CONTEXT:
- Acting Role: ${safeEnv.canonicalRoleId}
- Current App Route: ${safeEnv.currentRoute}
- App Version: ${safeEnv.appVersion}
- Sanitized Error Code: ${safeEnv.sanitizedErrorCode || 'none'}
- Language Preference: ${safeEnv.languagePreference}

USER QUERY:
${safeEnv.query}

Respond with a JSON object in this exact schema:
{
  "answer": "Clear, plain-language markdown response grounded in approved articles.",
  "grounded": true or false,
  "citations": [
    {
      "articleId": "article-id",
      "title": "Article Title",
      "version": "1.0.0",
      "section": "Section name if applicable"
    }
  ],
  "escalationRoute": {
    "lane": "account" | "privacy" | "governance" | "safeguarding" | "employment" | "technical",
    "label": "Human route label",
    "targetUrl": "/pathway or /governance or /consents or /knowledge",
    "urgentNotice": "optional alert"
  },
  "suggestedFollowUps": ["Follow up 1", "Follow up 2"]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text?.trim();
    if (text) {
      const parsed = JSON.parse(text);
      return {
        answer: parsed.answer || 'No answer generated.',
        grounded: Boolean(parsed.grounded),
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        escalationRoute: parsed.escalationRoute || undefined,
        suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps) ? parsed.suggestedFollowUps : [],
      };
    }
  } catch (err) {
    console.warn('Gemini API call returned error, falling back to local grounding:', err);
  }

  // Graceful fallback
  return buildFallbackResponse(safeEnv.query, safeEnv.canonicalRoleId, safeEnv.currentRoute, safeEnv.sanitizedErrorCode);
}

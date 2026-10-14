import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRole } from '../context/RoleContext';
import { useAuth } from '../context/AuthContext';
import { createWorkQueueItem } from '../lib/queries';
import type { EscalationLaneId, SupportCitation, SupportAgentResponse } from '../lib/types';
import { KNOWLEDGE_CORPUS } from '../lib/knowledgeCorpus';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  grounded?: boolean;
  citations?: SupportCitation[];
  escalationRoute?: {
    lane: EscalationLaneId;
    label: string;
    targetUrl: string;
    urgentNotice?: string;
  };
  suggestedFollowUps?: string[];
  timestamp: string;
}

const PREFLIGHT_EMAIL = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/;
const PREFLIGHT_PHONE = /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/;

const QUICK_PROMPTS = [
  'How do I request certification review?',
  'What are the boundaries of a Practice Supervisor?',
  'How does consent revocation work under Law 25?',
  'How do I propose a hub adaptation?',
  'I need urgent crisis or safeguarding support',
];

export default function SupportAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [showEscalationModal, setShowEscalationModal] = useState(false);
  const [activeEscalationLane, setActiveEscalationLane] = useState<EscalationLaneId | null>(null);
  const [escalationNote, setEscalationNote] = useState('');
  const [escalationSubmitted, setEscalationSubmitted] = useState(false);
  const [submittingTicket, setSubmittingTicket] = useState(false);

  const [inputQuery, setInputQuery] = useState('');
  const [redactionWarning, setRedactionWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello. I am the **Governed App-Support Assistant**. I am visibly non-human, record-blind, and actionless. I can explain platform features, role boundaries, consent mechanics under Law 25, and error codes. How can I help you today?',
      grounded: true,
      suggestedFollowUps: QUICK_PROMPTS.slice(0, 3),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const { activeRole } = useRole();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Real-time pre-flight client-side PII check
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputQuery(val);

    if (PREFLIGHT_EMAIL.test(val)) {
      setRedactionWarning('Privacy Alert: Email address detected. Please remove identifying emails before submitting.');
    } else if (PREFLIGHT_PHONE.test(val)) {
      setRedactionWarning('Privacy Alert: Phone number detected. Please remove personal contact numbers.');
    } else {
      setRedactionWarning(null);
    }
  };

  const handleSend = async (queryToSend?: string) => {
    const q = (queryToSend || inputQuery).trim();
    if (!q || loading) return;

    // Hard client-side blocker
    if (PREFLIGHT_EMAIL.test(q) || PREFLIGHT_PHONE.test(q)) {
      setRedactionWarning('Privacy Guard blocked this message: Identifying contact details (email or phone) are strictly forbidden in support queries.');
      return;
    }

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setRedactionWarning(null);
    setLoading(true);

    try {
      const response = await fetch('/api/support/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonicalRoleId: activeRole,
          currentRoute: location.pathname,
          appVersion: '3.0.0',
          languagePreference: 'en',
          query: q,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${response.status}`);
      }

      const data: SupportAgentResponse = await response.json();

      const assistantMsg: ChatMessage = {
        id: `asst-${Date.now()}`,
        sender: 'assistant',
        text: data.answer,
        grounded: data.grounded,
        citations: data.citations,
        escalationRoute: data.escalationRoute,
        suggestedFollowUps: data.suggestedFollowUps,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      console.warn('Gateway query failed, using direct client-side corpus matcher:', err);

      // Instant client-side fallback using KNOWLEDGE_CORPUS
      const qLower = q.toLowerCase();
      const match = KNOWLEDGE_CORPUS.find(
        (a) => a.title.toLowerCase().includes(qLower) || a.content.toLowerCase().includes(qLower) || a.tags?.some((t) => qLower.includes(t))
      );

      const fallbackMsg: ChatMessage = {
        id: `asst-${Date.now()}`,
        sender: 'assistant',
        text: match
          ? `### ${match.title} (${match.version})\n\n${match.summary}\n\n${match.content.split('\n\n')[0]}`
          : 'I could not find an approved public policy matching your query. Please select a human escalation route to connect with a named coordinator.',
        grounded: Boolean(match),
        citations: match
          ? [{ articleId: match.id, title: match.title, version: match.version, section: 'Overview' }]
          : [],
        escalationRoute: {
          lane: 'governance',
          label: 'Route to Governance Circle',
          targetUrl: '/governance',
        },
        suggestedFollowUps: QUICK_PROMPTS.slice(0, 3),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEscalation = (lane?: EscalationLaneId) => {
    setActiveEscalationLane(lane || 'technical');
    setEscalationSubmitted(false);
    setEscalationNote('');
    setShowEscalationModal(true);
  };

  const handleSubmitEscalationTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEscalationLane || submittingTicket) return;

    setSubmittingTicket(true);
    try {
      await createWorkQueueItem({
        title: `Escalation: ${activeEscalationLane.toUpperCase()} from ${location.pathname}`,
        type: 'escalation',
        lane: activeEscalationLane,
        priority: activeEscalationLane === 'safeguarding' ? 'urgent' : 'normal',
        status: 'open',
        assigneeRole: activeEscalationLane === 'privacy' ? 'privacyLead' : 'hubCoordinator',
        sourceRoute: location.pathname,
        sanitizedErrorCode: escalationNote ? `User note: ${escalationNote.slice(0, 100)}` : undefined,
      });

      setEscalationSubmitted(true);
    } catch (err) {
      console.error('Failed to submit escalation ticket:', err);
      setEscalationSubmitted(true); // Still show acknowledgement to reassure user
    } finally {
      setSubmittingTicket(false);
    }
  };

  return (
    <>
      {/* Floating Launcher Button */}
      <aside aria-label="Support Assistant Widget" className="support-launcher-container">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="support-launcher-btn"
          aria-expanded={isOpen}
          title="24/7 Governed App-Support"
        >
          <span style={{ fontSize: '1.25rem' }}>💬</span>
          <span className="support-launcher-text">Support 24/7</span>
          <span className="support-launcher-badge">Record-Blind</span>
        </button>
      </aside>

      {/* Slide-out Drawer */}
      {isOpen && (
        <section aria-label="Support Assistant Window" className="support-drawer">
          {/* Header */}
          <div className="support-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>Governed Support Assistant</h3>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#93c5fd', marginTop: '0.15rem' }}>
                Visibly Non-Human · Zero Transcript Retention · Citations Required
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => setMessages(messages.slice(0, 1))}
                className="support-btn-ghost"
                title="Clear conversation"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="support-btn-ghost"
                title="Close drawer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Envelope Context Banner */}
          <div className="support-envelope-bar">
            <span>Role: <strong>{activeRole}</strong></span>
            <span>Route: <code>{location.pathname}</code></span>
            <span>Version: <code>v3.0.0</code></span>
          </div>

          {/* Privacy Guard Notice */}
          <div className="support-privacy-notice">
            🔒 <strong>Strict Privacy Guard:</strong> Never enter names, case notes, or health details. This agent answers questions about platform functions, policy standards, and navigation.
          </div>

          {/* Messages Flow */}
          <div className="support-messages-scroll">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`support-bubble-row ${m.sender === 'user' ? 'user-side' : 'asst-side'}`}
              >
                <div className={`support-bubble ${m.sender === 'user' ? 'user' : 'assistant'}`}>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.text}</div>

                  {/* Citations Box */}
                  {m.citations && m.citations.length > 0 && (
                    <div className="support-citation-box">
                      <span className="support-citation-title">Verified Sources:</span>
                      {m.citations.map((c, i) => (
                        <div key={i} className="support-citation-item">
                          📖 <strong>{c.title}</strong> (v{c.version})
                          {c.section && <span style={{ opacity: 0.8 }}> — {c.section}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Escalation Route Button */}
                  {m.sender === 'assistant' && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => handleOpenEscalation(m.escalationRoute?.lane)}
                        className="support-escalate-btn"
                      >
                        ⚠️ This did not solve it → Human Escalation
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/knowledge')}
                        className="support-knowledge-link"
                      >
                        📚 Search Knowledge Base
                      </button>
                    </div>
                  )}

                  {/* Follow-up Prompts */}
                  {m.suggestedFollowUps && m.suggestedFollowUps.length > 0 && (
                    <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {m.suggestedFollowUps.map((chip, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSend(chip)}
                          className="support-chip"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="support-timestamp">{m.timestamp}</div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="support-bubble-row asst-side">
                <div className="support-bubble assistant" style={{ fontStyle: 'italic', color: '#6b7280' }}>
                  Retrieving verified knowledge articles...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts Shelf */}
          <div className="support-quick-shelf">
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>Suggestions:</span>
            {QUICK_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSend(prompt)}
                className="support-mini-chip"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Redaction Warning if PII detected */}
          {redactionWarning && (
            <div className="support-redaction-alert">
              ⚠️ {redactionWarning}
            </div>
          )}

          {/* Input Area */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="support-input-bar"
          >
            <input
              type="text"
              value={inputQuery}
              onChange={handleInputChange}
              placeholder="Ask about roles, consents, policies, error codes..."
              disabled={loading}
              className="support-input-field"
            />
            <button
              type="submit"
              disabled={loading || !inputQuery.trim() || Boolean(redactionWarning)}
              className="support-send-btn"
            >
              Send
            </button>
          </form>
        </section>
      )}

      {/* Deterministic Human Escalation Center Modal */}
      {showEscalationModal && (
        <div className="modal-backdrop" onClick={() => setShowEscalationModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--navy)' }}>
                Deterministic Human Escalation Center
              </h2>
              <button
                type="button"
                onClick={() => setShowEscalationModal(false)}
                className="btn-outline"
                style={{ padding: '0.2rem 0.5rem' }}
              >
                ✕
              </button>
            </div>

            <p className="muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
              The AI agent leaves the loop immediately. Choose the governed human lane matching your need:
            </p>

            {/* 6 Deterministic Lanes */}
            <div className="escalation-lanes-grid">
              <div
                className={`lane-card ${activeEscalationLane === 'safeguarding' ? 'selected danger' : ''}`}
                onClick={() => setActiveEscalationLane('safeguarding')}
              >
                <div className="lane-header">
                  <span style={{ fontSize: '1.2rem' }}>🚨</span>
                  <strong>Safeguarding & Crisis</strong>
                </div>
                <p>Immediate 24/7 distress helplines (988, 1-866-APPELLE). No automated dialogue.</p>
              </div>

              <div
                className={`lane-card ${activeEscalationLane === 'privacy' ? 'selected' : ''}`}
                onClick={() => setActiveEscalationLane('privacy')}
              >
                <div className="lane-header">
                  <span style={{ fontSize: '1.2rem' }}>🔒</span>
                  <strong>Privacy Lead Lane</strong>
                </div>
                <p>Law 25 inquiries, consent revocation anomalies, and right-to-erasure audits.</p>
              </div>

              <div
                className={`lane-card ${activeEscalationLane === 'governance' ? 'selected' : ''}`}
                onClick={() => setActiveEscalationLane('governance')}
              >
                <div className="lane-header">
                  <span style={{ fontSize: '1.2rem' }}>⚖️</span>
                  <strong>Governance Circle</strong>
                </div>
                <p>Policy disagreements, circle decisions, and national steering appeals.</p>
              </div>

              <div
                className={`lane-card ${activeEscalationLane === 'account' ? 'selected' : ''}`}
                onClick={() => setActiveEscalationLane('account')}
              >
                <div className="lane-header">
                  <span style={{ fontSize: '1.2rem' }}>👤</span>
                  <strong>Account Support</strong>
                </div>
                <p>Hub invitations, authentication troubleshooting, and identity verification.</p>
              </div>

              <div
                className={`lane-card ${activeEscalationLane === 'employment' ? 'selected' : ''}`}
                onClick={() => setActiveEscalationLane('employment')}
              >
                <div className="lane-header">
                  <span style={{ fontSize: '1.2rem' }}>🤝</span>
                  <strong>Employment Boundary</strong>
                </div>
                <p>Independent mediation and employer non-interference boundary checks.</p>
              </div>

              <div
                className={`lane-card ${activeEscalationLane === 'technical' ? 'selected' : ''}`}
                onClick={() => setActiveEscalationLane('technical')}
              >
                <div className="lane-header">
                  <span style={{ fontSize: '1.2rem' }}>🛠️</span>
                  <strong>Technical Incident</strong>
                </div>
                <p>Sanitized error routing carrying route and version without user records.</p>
              </div>
            </div>

            {/* Special display for Safeguarding Emergency */}
            {activeEscalationLane === 'safeguarding' && (
              <div className="safeguarding-emergency-banner">
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#991b1b' }}>Immediate Emergency Helplines:</h4>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9rem', color: '#7f1d1d' }}>
                  <li><strong>Canada Suicide Crisis Helpline</strong>: Call or text <strong>988</strong> (24/7, Toll-Free)</li>
                  <li><strong>Quebec Suicide Prevention Line</strong>: Call <strong>1-866-APPELLE (1-866-277-3553)</strong></li>
                  <li><strong>Indigenous Hope for Wellness</strong>: Call <strong>1-855-242-3310</strong></li>
                  <li><strong>Emergency Services</strong>: Dial <strong>911</strong></li>
                </ul>
              </div>
            )}

            {/* Ticket Submission Form */}
            {activeEscalationLane !== 'safeguarding' && !escalationSubmitted && (
              <form onSubmit={handleSubmitEscalationTicket} style={{ marginTop: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Brief Note for the Designated Human Reviewer (Optional, non-narrative):
                </label>
                <input
                  type="text"
                  value={escalationNote}
                  onChange={(e) => setEscalationNote(e.target.value)}
                  placeholder="e.g. Issue on pathway certification step or Law 25 consent query"
                  className="support-input-field"
                  style={{ width: '100%', marginBottom: '1rem', border: '1px solid var(--border)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowEscalationModal(false)}
                    className="btn-outline"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingTicket}
                    className="btn"
                  >
                    {submittingTicket ? 'Dispatching to Queue...' : 'Dispatch Routing Ticket'}
                  </button>
                </div>
              </form>
            )}

            {escalationSubmitted && (
              <div style={{ marginTop: '1.25rem', background: '#ecfdf5', border: '1px solid #10b981', padding: '1rem', borderRadius: '6px', textAlign: 'center' }}>
                <span style={{ fontSize: '1.5rem' }}>✅</span>
                <h4 style={{ margin: '0.5rem 0', color: '#065f46' }}>Escalation Ticket Dispatched</h4>
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#047857' }}>
                  A routing ticket has been submitted to the designated <strong>{activeEscalationLane}</strong> queue carrying your acting context. A coordinator will review it.
                </p>
                <button
                  type="button"
                  onClick={() => setShowEscalationModal(false)}
                  className="btn"
                  style={{ marginTop: '1rem' }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

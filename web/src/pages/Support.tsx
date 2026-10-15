/**
 * Support (Phase 3, P3.1) — the 24/7 app support assistant.
 *
 * Identity is visible at all times: "App support assistant — software
 * help only. Not a peer supporter." The assistant cannot see your
 * record, cannot act on your account, and stores no transcript.
 *
 * Do not enter names, case details, health information, passwords, or
 * codes. The server discards any message that looks like it contains
 * personal details.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  askSupportAgent,
  submitSupportFeedback,
  type SupportAnswerResult,
} from '../lib/queries';
import ErrorNotice from '../components/ErrorNotice';

const QUICK_ACTIONS: Array<{ id: string; label: string; starter: string }> = [
  { id: 'how', label: 'How do I…', starter: 'How do I ' },
  { id: 'error', label: 'I see an error', starter: 'I see an error: ' },
  { id: 'role', label: 'Explain this role', starter: 'Explain this role: ' },
  { id: 'contact', label: 'Contact a person', starter: 'I need to contact a person about ' },
];

export default function Support() {
  const { actingRole } = useAuth();
  const [question, setQuestion] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<SupportAnswerResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<string>('');
  const [showRoute, setShowRoute] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setError(null);
    setAnswer(null);
    setFeedback('');
    setShowRoute(false);
    setAsking(true);
    try {
      const result = await askSupportAgent(question, {
        actingRole: actingRole ?? null,
        errorCode: errorCode.trim() || undefined,
      });
      setAnswer(result);
    } catch (err) {
      setError(err);
    } finally {
      setAsking(false);
    }
  };

  const sendFeedback = async (helpful: boolean) => {
    if (!answer) return;
    try {
      await submitSupportFeedback(helpful, answer.category, { actingRole: actingRole ?? null });
      setFeedback(helpful ? 'Thanks — marked helpful.' : 'Thanks — marked not helpful.');
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div data-testid="support-page">
      <h1>Support</h1>
      <div className="gold-rule" />
      <p data-testid="support-identity" className="muted">
        App support assistant — software help only. Not a peer supporter, counsellor, or clinician.
        It cannot see your record and cannot act on your account.
      </p>
      <p data-testid="support-warning" className="notice">
        Do not enter names, case details, health information, passwords, or codes. Messages that
        look like they contain personal details are discarded, not answered.
      </p>
      <ErrorNotice error={error} />

      <section className="card">
        <h2>Ask about the app</h2>
        <div>
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              data-testid={`support-quick-${a.id}`}
              onClick={() => setQuestion(a.starter)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="support-question">Question (max 1000 characters)</label>
            <textarea
              id="support-question"
              data-testid="support-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={1000}
              required
              placeholder="For example: How do I revoke a consent?"
            />
          </div>
          <div className="field">
            <label htmlFor="support-error-code">Error code (optional, e.g. auth/invalid-credential)</label>
            <input
              id="support-error-code"
              data-testid="support-error-code"
              value={errorCode}
              onChange={(e) => setErrorCode(e.target.value)}
              maxLength={64}
              placeholder="Error code only — no messages or stack traces"
            />
          </div>
          <button type="submit" data-testid="support-submit" disabled={asking || !question.trim()}>
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </form>
      </section>

      {answer && (
        <section className="card">
          <h2>Answer</h2>
          <p data-testid="support-answer" style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</p>
          {answer.sources.length > 0 && (
            <div data-testid="support-sources">
              <h3>Sources</h3>
              <ul>
                {answer.sources.map((s) => (
                  <li key={s.id}>
                    <Link to={s.route}>{s.title}</Link> (v{s.version})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {answer.resources.length > 0 && (
            <div data-testid="support-resources" className="notice">
              <h3>Help now</h3>
              <ul>
                {answer.resources.map((r) => (
                  <li key={r.name}>
                    <strong>{r.name}:</strong> {r.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div data-testid="support-route">
            <h3>Human route</h3>
            <p>{answer.route}</p>
          </div>
          <div>
            <span>Was this helpful? </span>
            <button type="button" data-testid="support-feedback-helpful" onClick={() => void sendFeedback(true)}>
              Helpful
            </button>
            <button type="button" data-testid="support-feedback-not-helpful" onClick={() => void sendFeedback(false)}>
              Not helpful
            </button>
            {feedback && <span> {feedback}</span>}
          </div>
          <div>
            <button type="button" data-testid="support-not-solved" onClick={() => setShowRoute(true)}>
              This did not solve it
            </button>
            {showRoute && (
              <p data-testid="support-route-expanded">
                Use the human route above — a person will help you. This assistant cannot act on
                accounts or see records.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import {
  fileComplaint,
  listGovernanceDecisions,
  listWorkQueue,
  listAdaptations,
  createAdaptation,
  listDeveloperBriefs,
} from '../lib/queries';
import {
  formatTimestamp,
  type GovernanceDecision,
  type WorkQueueItem,
  type Adaptation,
  type DeveloperBrief,
  type WithId,
} from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function Governance() {
  const { user, tenantId } = useAuth();
  const { activeRole } = useRole();

  const [decisions, setDecisions] = useState<WithId<GovernanceDecision>[]>([]);
  const [workQueue, setWorkQueue] = useState<WithId<WorkQueueItem>[]>([]);
  const [adaptations, setAdaptations] = useState<WithId<Adaptation>[]>([]);
  const [briefs, setBriefs] = useState<WithId<DeveloperBrief>[]>([]);

  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState('');

  // Adaptation Form State
  const [showAdaptationModal, setShowAdaptationModal] = useState(false);
  const [adaptTitle, setAdaptTitle] = useState('');
  const [adaptCoreOrForm, setAdaptCoreOrForm] = useState<'form' | 'core'>('form');
  const [adaptRationale, setAdaptRationale] = useState('');
  const [submittingAdapt, setSubmittingAdapt] = useState(false);

  const isGovernanceLead =
    activeRole === 'steeringCircle' ||
    activeRole === 'council' ||
    activeRole === 'privacyLead' ||
    activeRole === 'hubCoordinator';

  const load = async () => {
    try {
      const [dList, aList] = await Promise.all([
        listGovernanceDecisions(tenantId),
        listAdaptations(tenantId),
      ]);
      setDecisions(dList);
      setAdaptations(aList);

      if (isGovernanceLead) {
        const [qList, bList] = await Promise.all([
          listWorkQueue(),
          listDeveloperBriefs(),
        ]);
        setWorkQueue(qList);
        setBriefs(bList);
      }
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, activeRole]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setNotice('');
    try {
      await fileComplaint(user.uid, tenantId, summary);
      setSummary('');
      setNotice('Complaint filed. Only you and the governance circle can see it.');
    } catch (err) {
      setError(err);
    }
  };

  const handleCreateAdaptation = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !adaptTitle.trim() || submittingAdapt) return;

    setSubmittingAdapt(true);
    try {
      await createAdaptation({
        title: adaptTitle.trim(),
        hubId: tenantId,
        authorId: user.uid,
        authorName: user.displayName || user.email || 'Facilitator/Worker',
        coreOrForm: adaptCoreOrForm,
        rationale: adaptRationale.trim(),
        status: 'proposed',
      });

      setShowAdaptationModal(false);
      setAdaptTitle('');
      setAdaptRationale('');
      setNotice('Localized adaptation proposal submitted to Learning Circle.');
      const updated = await listAdaptations(tenantId);
      setAdaptations(updated);
    } catch (err) {
      setError(err);
    } finally {
      setSubmittingAdapt(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>Governance & Accountability</h1>
          <div className="gold-rule" />
          <p className="muted">
            Circle decisions are public within the network. Escalation tickets and complaints are handled through deterministic human lanes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdaptationModal(true)}
          className="btn"
        >
          + Propose Hub Adaptation
        </button>
      </div>

      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      {/* Work Queue Section (for Governance, Privacy Lead, Hub Coordinator) */}
      {isGovernanceLead && (
        <section className="card" style={{ border: '2px solid var(--navy)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Deterministic Human Escalation Queue ({workQueue.length})</h2>
            <span className="pill live">Triage Active</span>
          </div>
          <p className="muted" style={{ fontSize: '0.88rem', margin: '0 0 1rem 0' }}>
            High-stakes queries exited from the AI Support Assistant. Carrying sanitized route and context without narrative worker records.
          </p>

          {workQueue.length === 0 ? (
            <p className="muted">No pending escalation tickets in the queue.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem' }}>
              {workQueue.map((item) => (
                <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '0.85rem', background: '#fafaf9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span className="pill" style={{ textTransform: 'uppercase', fontSize: '0.75rem', background: '#fef3c7', color: '#92400e' }}>
                      {item.lane}
                    </span>
                    <span className="pill" style={{ fontSize: '0.72rem' }}>
                      {item.priority}
                    </span>
                  </div>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--navy)' }}>{item.title}</strong>
                  <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Route: <code>{item.sourceRoute || 'General'}</code> · Correlation: <code>{item.correlationId}</code>
                  </div>
                  {item.sanitizedErrorCode && (
                    <div style={{ fontSize: '0.82rem', marginTop: '0.35rem', color: '#4b5563' }}>
                      {item.sanitizedErrorCode}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Decision Records */}
      <section className="card">
        <h2>Circle Decision Records</h2>
        {decisions.length === 0 ? (
          <p className="muted">No decisions recorded yet for this hub.</p>
        ) : (
          <ul>
            {decisions.map((d) => (
              <li key={d.id} style={{ marginBottom: '0.75rem' }}>
                <strong>{d.title}</strong> — {d.body}
                <br />
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  Decided {formatTimestamp(d.decidedAt)} by {d.decidedBy}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Local Hub Adaptations */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Hub Adaptations Registry ({adaptations.length})</h2>
          <span className="pill">Learning Circle</span>
        </div>
        <p className="muted" style={{ fontSize: '0.88rem', margin: '0 0 1rem 0' }}>
          Distinguishing non-negotiable peer core principles from local territorial and cultural expressions (Form).
        </p>

        {adaptations.length === 0 ? (
          <p className="muted">No local adaptations proposed yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem' }}>
            {adaptations.map((a) => (
              <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span className="pill" style={{ fontSize: '0.75rem' }}>
                    Type: {a.coreOrForm.toUpperCase()}
                  </span>
                  <span className="pill" style={{ background: '#dcfce7', color: '#166534', fontSize: '0.75rem' }}>
                    {a.status}
                  </span>
                </div>
                <strong style={{ color: 'var(--navy)' }}>{a.title}</strong>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--ink)' }}>
                  {a.rationale}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Developer Recommendation Briefs (k >= 5 Suppressed Aggregates) */}
      {isGovernanceLead && briefs.length > 0 && (
        <section className="card" style={{ background: '#fdfcf7' }}>
          <h2>Developer Recommendation Briefs (Aggregated Loop)</h2>
          <p className="muted" style={{ fontSize: '0.88rem' }}>
            Synthesized weekly friction and test failure recommendations. Zero raw worker observation.
          </p>
          <ul>
            {briefs.map((b) => (
              <li key={b.id} style={{ marginBottom: '0.5rem' }}>
                <strong>Week {b.weekPeriod}</strong> — Status: <span className="pill">{b.status}</span>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  Needs: {b.synthesizedNeeds.join(', ')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* File a Complaint */}
      <section className="card">
        <h2>File a Private Complaint or Mediation Request</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="summary">Summary</label>
            <textarea
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              required
              placeholder="Describe what happened, in your own words."
            />
          </div>
          <button type="submit">File complaint</button>
        </form>
      </section>

      {/* Propose Adaptation Modal */}
      {showAdaptationModal && (
        <div className="modal-backdrop" onClick={() => setShowAdaptationModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--navy)' }}>Propose Hub Adaptation</h2>
              <button type="button" onClick={() => setShowAdaptationModal(false)} className="btn-outline">✕</button>
            </div>

            <form onSubmit={handleCreateAdaptation} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Proposal Title</label>
                <input
                  type="text"
                  required
                  value={adaptTitle}
                  onChange={(e) => setAdaptTitle(e.target.value)}
                  placeholder="e.g. Bilingual French/Inuktitut Circle Modality"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Adaptation Type</label>
                <select
                  value={adaptCoreOrForm}
                  onChange={(e) => setAdaptCoreOrForm(e.target.value as 'form' | 'core')}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                >
                  <option value="form">Form (Schedule, language, cultural expression — standard review)</option>
                  <option value="core">Core (Ethical boundary or principle adjustment — national circle review)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Rationale & Local Context</label>
                <textarea
                  rows={4}
                  required
                  value={adaptRationale}
                  onChange={(e) => setAdaptRationale(e.target.value)}
                  placeholder="Explain why this adaptation serves local community needs while upholding peer integrity..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" onClick={() => setShowAdaptationModal(false)} className="btn-outline">Cancel</button>
                <button type="submit" disabled={submittingAdapt} className="btn">
                  {submittingAdapt ? 'Submitting...' : 'Submit Proposal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

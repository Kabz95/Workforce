import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { fileComplaint, listGovernanceDecisions } from '../lib/queries';
import { formatTimestamp, type GovernanceDecision, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function Governance() {
  const { user, tenantId } = useAuth();
  const [decisions, setDecisions] = useState<WithId<GovernanceDecision>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState('');

  const load = async () => {
    try {
      setDecisions(await listGovernanceDecisions(tenantId));
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

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

  return (
    <div>
      <h1>Governance</h1>
      <div className="gold-rule" />
      <p className="muted">
        Decision records are public within the network. Complaints are visible
        only to the complainant and the governance circle.
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      <section className="card">
        <h2>Decision records</h2>
        {decisions.length === 0 ? (
          <p className="muted">No decisions recorded yet for this hub.</p>
        ) : (
          <ul>
            {decisions.map((d) => (
              <li key={d.id}>
                <strong>{d.title}</strong> — {d.body}
                <br />
                <span className="muted">Decided {formatTimestamp(d.decidedAt)} by {d.decidedBy}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>File a complaint</h2>
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
    </div>
  );
}

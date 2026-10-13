import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listAggregates, listMyConsents, listMyPathwaySteps } from '../lib/queries';
import { formatTimestamp, type WithId, type Aggregate, type Consent, type PathwayStep } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';
import { hasRole } from '../context/AuthContext';

export default function Dashboard() {
  const { user, roles, tenantId } = useAuth();
  const [steps, setSteps] = useState<WithId<PathwayStep>[]>([]);
  const [consents, setConsents] = useState<WithId<Consent>[]>([]);
  const [aggregates, setAggregates] = useState<WithId<Aggregate>[]>([]);
  const [error, setError] = useState<unknown>(null);

  const isWorker = hasRole(roles, 'worker');
  const isEmployer = hasRole(roles, 'employer');
  const isGovernance = hasRole(roles, 'governance');
  const isAnalyst = hasRole(roles, 'backboneAnalyst');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        if (isWorker) {
          const [s, c] = await Promise.all([
            listMyPathwaySteps(user.uid, tenantId),
            listMyConsents(user.uid, tenantId),
          ]);
          if (!cancelled) {
            setSteps(s);
            setConsents(c.filter((x) => !x.revokedAt && x.expiresAt.toDate() > new Date()));
          }
        }
        if (isAnalyst || isGovernance) {
          const a = await listAggregates(tenantId);
          if (!cancelled) setAggregates(a);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, tenantId, isWorker, isAnalyst, isGovernance]);

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="gold-rule" />
      <p className="muted">
        Signed in as <strong>{user?.email}</strong> · Hub: {tenantId} ·
        Roles: {roles.join(', ') || '—'}
      </p>
      <ErrorNotice error={error} />

      {isWorker && (
        <>
          <section className="card">
            <h2>My pathway</h2>
            {steps.length === 0 ? (
              <p className="muted">No pathway steps yet. <Link to="/pathway">Add your first step</Link>.</p>
            ) : (
              <ul>
                {steps.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    {s.title} — <span className="pill">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/pathway">Manage pathway →</Link>
          </section>
          <section className="card">
            <h2>My live consent grants</h2>
            {consents.length === 0 ? (
              <p className="muted">No live grants. <Link to="/consents">Manage consents</Link>.</p>
            ) : (
              <ul>
                {consents.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    {c.scope} → {c.granteeId} · expires {formatTimestamp(c.expiresAt)}
                  </li>
                ))}
              </ul>
            )}
            <Link to="/consents">Manage consents →</Link>
          </section>
        </>
      )}

      {isEmployer && (
        <section className="card">
          <h2>Employer</h2>
          <p>
            <Link to="/readiness">Employer readiness self-assessment →</Link>
          </p>
          <p>
            <Link to="/opportunities">Postings and applications →</Link>
          </p>
        </section>
      )}

      {isGovernance && (
        <section className="card">
          <h2>Governance</h2>
          <p>
            <Link to="/governance">Decisions and complaints →</Link>
          </p>
        </section>
      )}

      {(isAnalyst || isGovernance) && (
        <section className="card">
          <h2>Workforce aggregates (de-identified)</h2>
          {aggregates.length === 0 ? (
            <p className="muted">No aggregates published yet for this hub.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Metric</th><th>Period</th><th>Value</th></tr>
              </thead>
              <tbody>
                {aggregates.slice(0, 10).map((a) => (
                  <tr key={a.id}>
                    <td>{a.metric}</td>
                    <td>{a.period}</td>
                    <td>{a.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p><Link to="/aggregates">All aggregates →</Link></p>
        </section>
      )}

      {!isWorker && !isEmployer && !isGovernance && !isAnalyst && (
        <section className="card">
          <h2>Welcome</h2>
          <p className="muted">
            Your account holds no recognised role yet. A hub administrator assigns
            roles; until then you can browse governance decisions and opportunities.
          </p>
        </section>
      )}
    </div>
  );
}

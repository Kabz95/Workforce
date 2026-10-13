import { useEffect, useState } from 'react';
import { useAuth, hasRole } from '../context/AuthContext';
import {
  applyToOpportunity,
  getMyEmployer,
  listApplicationsForEmployer,
  listMyApplications,
  listOpportunities,
} from '../lib/queries';
import { formatTimestamp, type Opportunity, type OpportunityApplication, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function Opportunities() {
  const { user, roles, tenantId } = useAuth();
  const [opps, setOpps] = useState<WithId<Opportunity>[]>([]);
  const [myApps, setMyApps] = useState<WithId<OpportunityApplication>[]>([]);
  const [employerApps, setEmployerApps] = useState<WithId<OpportunityApplication>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const isEmployer = hasRole(roles, 'employer');
  const isWorker = hasRole(roles, 'worker');

  const load = async () => {
    if (!user) return;
    try {
      const o = await listOpportunities(tenantId);
      setOpps(o);
      if (isWorker) setMyApps(await listMyApplications(user.uid, tenantId));
      if (isEmployer) {
        const emp = await getMyEmployer(user.uid, tenantId);
        if (emp) setEmployerApps(await listApplicationsForEmployer(emp.id, tenantId));
      }
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId, isWorker, isEmployer]);

  const apply = async (opp: WithId<Opportunity>) => {
    if (!user) return;
    try {
      await applyToOpportunity(user.uid, tenantId, opp);
      setNotice('Application submitted. The employer sees only this application — not your record.');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const appliedIds = new Set(myApps.map((a) => a.opportunityId));

  return (
    <div>
      <h1>Opportunities</h1>
      <div className="gold-rule" />
      <p className="muted">
        Paid opportunities posted within this hub. Applying shares only the
        application itself — never your worker record.
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      <section className="card">
        <h2>Open opportunities</h2>
        {opps.length === 0 ? (
          <p className="muted">No opportunities posted in this hub yet.</p>
        ) : (
          <table>
            <thead><tr><th>Title</th><th>Description</th><th>Location</th><th>Posted</th><th></th></tr></thead>
            <tbody>
              {opps.map((o) => (
                <tr key={o.id}>
                  <td>{o.title}</td>
                  <td>{o.description}</td>
                  <td>{o.location}</td>
                  <td>{formatTimestamp(o.createdAt)}</td>
                  <td>
                    {isWorker && (
                      <button
                        type="button"
                        disabled={appliedIds.has(o.id)}
                        onClick={() => apply(o)}
                      >
                        {appliedIds.has(o.id) ? 'Applied' : 'Apply'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {isWorker && myApps.length > 0 && (
        <section className="card">
          <h2>My applications</h2>
          <table>
            <thead><tr><th>Opportunity</th><th>Status</th></tr></thead>
            <tbody>
              {myApps.map((a) => (
                <tr key={a.id}>
                  <td>{opps.find((o) => o.id === a.opportunityId)?.title ?? a.opportunityId}</td>
                  <td><span className="pill">{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {isEmployer && (
        <section className="card">
          <h2>Applications to my postings</h2>
          {employerApps.length === 0 ? (
            <p className="muted">No applications yet.</p>
          ) : (
            <table>
              <thead><tr><th>Opportunity</th><th>Applicant</th><th>Status</th></tr></thead>
              <tbody>
                {employerApps.map((a) => (
                  <tr key={a.id}>
                    <td>{opps.find((o) => o.id === a.opportunityId)?.title ?? a.opportunityId}</td>
                    <td>{a.ownerId}</td>
                    <td><span className="pill">{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">
            Employers see only the application. Applicant records are never exposed.
          </p>
        </section>
      )}
    </div>
  );
}

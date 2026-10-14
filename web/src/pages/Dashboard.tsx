import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listAggregates } from '../lib/queries';
import {
  ROLE_LABELS,
  type WithId,
  type Aggregate,
} from '../lib/types';
import { getManifest } from '../lib/manifests';
import { registerAbortController } from '../lib/roleState';
import ErrorNotice from '../components/ErrorNotice';
import WorkerDashboard from '../components/dashboards/WorkerDashboard';
import NavigatorDashboard from '../components/dashboards/NavigatorDashboard';
import HubCoordinatorDashboard from '../components/dashboards/HubCoordinatorDashboard';

/**
 * Manifest-driven dashboard (Phase 2).
 *
 * The manifest supplies the shell: acting context, one-sentence
 * purpose, and the explicit boundaries (what this role never sees).
 * The role-specific dashboard components below supply the real work
 * surfaces — Worker, Navigator, and Hub Coordinator are wired to live
 * data; the other roles render the manifest fallback (aggregates for
 * analyst / steering / council, links for the rest) until their
 * dashboards land in later phases.
 */
export default function Dashboard() {
  const { user, actingRole, tenantId } = useAuth();
  const [aggregates, setAggregates] = useState<WithId<Aggregate>[]>([]);
  const [error, setError] = useState<unknown>(null);

  const manifest = actingRole ? getManifest(actingRole) : null;

  useEffect(() => {
    if (!user || !actingRole) return;
    if (!['analyst', 'steeringCircle', 'council'].includes(actingRole)) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    void listAggregates(tenantId)
      .then((a) => {
        if (!cancelled && !controller.signal.aborted) setAggregates(a);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
      unregister();
    };
  }, [user, tenantId, actingRole]);

  if (!manifest || !actingRole) {
    return (
      <div>
        <h1>Dashboard</h1>
        <p className="muted">
          No acting capacity could be verified for this session. If you hold a
          role, it will appear once your grants load.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>{ROLE_LABELS[actingRole]} — Dashboard</h1>
      <div className="gold-rule" />
      <p className="muted">
        Signed in as <strong>{user?.email}</strong> · Hub: {tenantId} ·
        Acting as: <strong>{manifest.label}</strong>
      </p>
      <section className="card">
        <h2>Acting context</h2>
        <p className="muted">{manifest.zones.actingContext}</p>
      </section>
      <section className="card">
        <h2>Role purpose</h2>
        <p className="muted">{manifest.purpose}</p>
        <p className="muted">{manifest.zones.purpose}</p>
      </section>
      <ErrorNotice error={error} />

      {actingRole === 'worker' && <WorkerDashboard />}
      {actingRole === 'navigator' && <NavigatorDashboard />}
      {actingRole === 'hubCoordinator' && <HubCoordinatorDashboard />}

      {actingRole !== 'worker' && actingRole !== 'navigator' && actingRole !== 'hubCoordinator' && (
        <>
          <section className="card">
            <h2>Attention queue</h2>
            <p className="muted">{manifest.zones.attentionQueue}</p>
          </section>
          <section className="card">
            <h2>Core work</h2>
            <p className="muted">{manifest.zones.coreWork}</p>
            {actingRole === 'employer' && (
              <p>
                <Link to="/readiness">Employer readiness self-assessment →</Link>{' '}
                <Link to="/opportunities">Postings and applications →</Link>
              </p>
            )}
            {['analyst', 'steeringCircle', 'council'].includes(actingRole) && (
              <>
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
              </>
            )}
          </section>
          <section className="card">
            <h2>Handoffs</h2>
            <p className="muted">{manifest.zones.handoffs}</p>
            <p><Link to="/handoffs">Handoffs →</Link></p>
          </section>
          <section className="card">
            <h2>Learning + accountability</h2>
            <p className="muted">{manifest.zones.learningAccountability}</p>
            <p>
              <Link to="/audit">My audit log →</Link>{' '}
              <Link to="/grants">My roles &amp; grants →</Link>
            </p>
          </section>
        </>
      )}

      <section className="card">
        <h2>Boundaries — never shows</h2>
        <ul>
          {manifest.neverShows.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

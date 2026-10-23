import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listAggregates, listGovernanceDecisions } from '../lib/queries';
import {
  ROLE_LABELS,
  formatTimestamp,
  type WithId,
  type Aggregate,
  type GovernanceDecision,
} from '../lib/types';
import { getManifest } from '../lib/manifests';
import { registerAbortController } from '../lib/roleState';
import ErrorNotice from '../components/ErrorNotice';
import WorkerDashboard from '../components/dashboards/WorkerDashboard';
import NavigatorDashboard from '../components/dashboards/NavigatorDashboard';
import HubCoordinatorDashboard from '../components/dashboards/HubCoordinatorDashboard';
import SupervisorDashboard from '../components/dashboards/SupervisorDashboard';
import MentorDashboard from '../components/dashboards/MentorDashboard';
import PrivacyLeadDashboard from '../components/dashboards/PrivacyLeadDashboard';
import FacilitatorDashboard from '../components/dashboards/FacilitatorDashboard';
import EmployerDashboard from '../components/dashboards/EmployerDashboard';

/** Roles whose dashboard shows the aggregates widget (matches the
 *  /aggregates read rules: national roles cross-hub, steering hub). */
const AGGREGATE_WIDGET_ROLES = ['analyst', 'steeringCircle', 'council', 'backboneLead', 'researcher'];
/** Governance roles whose dashboard shows the published-decisions widget. */
const DECISION_WIDGET_ROLES = ['steeringCircle', 'council', 'backboneLead'];
/** Roles with the membership & grants view (kernel MEMBERSHIP_VIEW_ROLES). */
const MEMBERSHIP_LINK_ROLES = ['hubCoordinator', 'steeringCircle', 'council', 'backboneLead', 'privacyLead'];

/**
 * Manifest-driven dashboard (Phase 2).
 *
 * The manifest supplies the shell: acting context, one-sentence
 * purpose, and the explicit boundaries (what this role never sees).
 * The role-specific dashboard components below supply the real work
 * surfaces — Worker, Navigator, Hub Coordinator, Supervisor, Mentor,
 * Privacy Lead, Facilitator, and Employer are wired to live data; the
 * remaining governance/intelligence roles render the manifest shell
 * plus real widgets (aggregates for analyst / steering / council /
 * backboneLead / researcher, published decisions for the governance
 * roles) fed by the same reads their pages use.
 */
export default function Dashboard() {
  const { user, actingRole, tenantId } = useAuth();
  const [aggregates, setAggregates] = useState<WithId<Aggregate>[]>([]);
  const [decisions, setDecisions] = useState<WithId<GovernanceDecision>[]>([]);
  const [error, setError] = useState<unknown>(null);

  const manifest = actingRole ? getManifest(actingRole) : null;

  useEffect(() => {
    if (!user || !actingRole) return;
    if (!AGGREGATE_WIDGET_ROLES.includes(actingRole)) return;
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

  useEffect(() => {
    if (!user || !actingRole) return;
    if (!DECISION_WIDGET_ROLES.includes(actingRole)) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    void listGovernanceDecisions(tenantId)
      .then((d) => {
        if (!cancelled && !controller.signal.aborted) setDecisions(d);
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
      {actingRole === 'supervisor' && <SupervisorDashboard />}
      {actingRole === 'mentor' && <MentorDashboard />}
      {actingRole === 'privacyLead' && <PrivacyLeadDashboard />}
      {actingRole === 'facilitator' && <FacilitatorDashboard />}
      {actingRole === 'employer' && <EmployerDashboard />}

      {actingRole !== 'worker' &&
        actingRole !== 'navigator' &&
        actingRole !== 'hubCoordinator' &&
        actingRole !== 'supervisor' &&
        actingRole !== 'mentor' &&
        actingRole !== 'privacyLead' &&
        actingRole !== 'facilitator' &&
        actingRole !== 'employer' && (
        <>
          <section className="card">
            <h2>Attention queue</h2>
            <p className="muted">{manifest.zones.attentionQueue}</p>
          </section>
          <section className="card">
            <h2>Core work</h2>
            <p className="muted">{manifest.zones.coreWork}</p>
            {AGGREGATE_WIDGET_ROLES.includes(actingRole) && (
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
            {MEMBERSHIP_LINK_ROLES.includes(actingRole) && (
              <p><Link to="/membership">Membership &amp; grants →</Link></p>
            )}
          </section>
          {DECISION_WIDGET_ROLES.includes(actingRole) && (
            <section className="card">
              <h2>Published decisions</h2>
              {decisions.length === 0 ? (
                <p className="muted">No governance decisions published for this hub yet.</p>
              ) : (
                <ul>
                  {[...decisions]
                    .sort((a, b) => (b.decidedAt?.toMillis?.() ?? 0) - (a.decidedAt?.toMillis?.() ?? 0))
                    .slice(0, 5)
                    .map((d) => (
                      <li key={d.id}>
                        <strong>{d.title}</strong> · {formatTimestamp(d.decidedAt)}
                      </li>
                    ))}
                </ul>
              )}
              <p><Link to="/governance">Governance →</Link></p>
            </section>
          )}
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

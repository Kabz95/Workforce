import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  listAggregates,
  listMyConsents,
  listMyHandoffs,
  listMyPathwaySteps,
} from '../lib/queries';
import {
  formatTimestamp,
  ROLE_LABELS,
  type WithId,
  type Aggregate,
  type Consent,
  type Handoff,
  type PathwayStep,
} from '../lib/types';
import { getManifest, ZONE_ORDER, ZONE_LABELS } from '../lib/manifests';
import { registerAbortController } from '../lib/roleState';
import ErrorNotice from '../components/ErrorNotice';

/**
 * Manifest-driven dashboard.
 * The seven fixed zones render from the acting role's manifest.
 * Zone contents are Phase 1 placeholders fed by real queries where
 * they exist (worker pathway/consents, aggregates, handoffs); per-role
 * widgets land in later phases inside these same zones.
 */
export default function Dashboard() {
  const { user, actingRole, tenantId } = useAuth();
  const [steps, setSteps] = useState<WithId<PathwayStep>[]>([]);
  const [consents, setConsents] = useState<WithId<Consent>[]>([]);
  const [aggregates, setAggregates] = useState<WithId<Aggregate>[]>([]);
  const [handoffs, setHandoffs] = useState<WithId<Handoff>[]>([]);
  const [error, setError] = useState<unknown>(null);

  const manifest = actingRole ? getManifest(actingRole) : null;

  useEffect(() => {
    if (!user || !actingRole) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          actingRole === 'worker'
            ? listMyPathwaySteps(user.uid, tenantId)
            : Promise.resolve([]),
          actingRole === 'worker'
            ? listMyConsents(user.uid, tenantId)
            : Promise.resolve([]),
          ['analyst', 'steeringCircle', 'council'].includes(actingRole)
            ? listAggregates(tenantId)
            : Promise.resolve([]),
          listMyHandoffs(user.uid, tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [s, c, a, h] = results.map((r) =>
          r.status === 'fulfilled' ? r.value : [],
        );
        setSteps(s as WithId<PathwayStep>[]);
        setConsents(
          (c as WithId<Consent>[]).filter(
            (x) => !x.revokedAt && x.expiresAt.toDate() > new Date(),
          ),
        );
        setAggregates(a as WithId<Aggregate>[]);
        setHandoffs(h as WithId<Handoff>[]);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    void load();
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
      <ErrorNotice error={error} />

      {ZONE_ORDER.map((zone) => (
        <section key={zone} className="card">
          <h2>{ZONE_LABELS[zone]}</h2>
          <p className="muted">{manifest.zones[zone]}</p>
          {zone === 'attentionQueue' && actingRole === 'worker' && (
            <>
              {steps.length > 0 && (
                <ul>
                  {steps.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      {s.title} — <span className="pill">{s.status}</span>
                    </li>
                  ))}
                </ul>
              )}
              {consents.length > 0 && (
                <ul>
                  {consents.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      Live grant: {c.scope} → {c.granteeId} · expires{' '}
                      {formatTimestamp(c.expiresAt)}
                    </li>
                  ))}
                </ul>
              )}
              {steps.length === 0 && consents.length === 0 && (
                <p className="muted">
                  Nothing awaiting you. <Link to="/pathway">Add a pathway step</Link>.
                </p>
              )}
            </>
          )}
          {zone === 'coreWork' && actingRole === 'worker' && (
            <p>
              <Link to="/record">My record →</Link>{' '}
              <Link to="/pathway">Pathway →</Link>{' '}
              <Link to="/consents">Consents →</Link>
            </p>
          )}
          {zone === 'coreWork' && actingRole === 'employer' && (
            <p>
              <Link to="/readiness">Employer readiness self-assessment →</Link>{' '}
              <Link to="/opportunities">Postings and applications →</Link>
            </p>
          )}
          {zone === 'coreWork' && ['analyst', 'steeringCircle', 'council'].includes(actingRole) && (
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
          {zone === 'handoffs' && (
            <>
              {handoffs.length === 0 ? (
                <p className="muted">No handoffs addressed to you or your record.</p>
              ) : (
                <ul>
                  {handoffs.slice(0, 5).map((h) => (
                    <li key={h.id}>
                      {h.purpose} — from {h.senderRole} to {h.recipientRole} ·{' '}
                      <span className="pill">{h.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {zone === 'learningAccountability' && (
            <p>
              <Link to="/audit">My audit log →</Link>{' '}
              <Link to="/grants">My roles &amp; grants →</Link>
            </p>
          )}
          {zone === 'boundaries' && (
            <ul>
              {manifest.neverShows.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

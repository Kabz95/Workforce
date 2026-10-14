import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import {
  listAggregates,
  listMyConsents,
  listMyPathwaySteps,
  listMyAgreements,
  listWorkQueue,
} from '../lib/queries';
import {
  formatTimestamp,
  type WithId,
  type Aggregate,
  type Consent,
  type PathwayStep,
  type CircularAgreement,
  type WorkQueueItem,
} from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';
import { ROLE_MANIFESTS } from '../lib/roleManifests';

export default function Dashboard() {
  const { user, tenantId } = useAuth();
  const { activeRole, activeGrant, catalogEntry } = useRole();
  const [steps, setSteps] = useState<WithId<PathwayStep>[]>([]);
  const [consents, setConsents] = useState<WithId<Consent>[]>([]);
  const [agreements, setAgreements] = useState<WithId<CircularAgreement>[]>([]);
  const [workQueue, setWorkQueue] = useState<WithId<WorkQueueItem>[]>([]);
  const [aggregates, setAggregates] = useState<WithId<Aggregate>[]>([]);
  const [error, setError] = useState<unknown>(null);

  const manifest = ROLE_MANIFESTS[activeRole] || ROLE_MANIFESTS.worker;

  // Role-scoped query loading: Cleans in-flight queries and re-fetches for current acting context
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // Listen to role-switch event to instantly purge old data
    const handleRoleSwitch = () => {
      setSteps([]);
      setConsents([]);
      setAgreements([]);
      setWorkQueue([]);
      setAggregates([]);
    };
    window.addEventListener('workforce:role-switch', handleRoleSwitch);

    const load = async () => {
      try {
        setError(null);
        if (activeRole === 'worker' || activeRole === 'navigator') {
          const [s, c] = await Promise.all([
            listMyPathwaySteps(user.uid, tenantId),
            listMyConsents(user.uid, tenantId),
          ]);
          if (!cancelled) {
            setSteps(s);
            setConsents(c.filter((x) => !x.revokedAt && x.expiresAt && x.expiresAt.toDate() > new Date()));
          }
        } else {
          setSteps([]);
          setConsents([]);
        }

        // Circular agreements for Wave A practice roles
        if (
          activeRole === 'worker' ||
          activeRole === 'supervisor' ||
          activeRole === 'mentor' ||
          activeRole === 'facilitator'
        ) {
          const agrs = await listMyAgreements(user.uid, tenantId);
          if (!cancelled) setAgreements(agrs);
        } else {
          setAgreements([]);
        }

        // Work queue for Privacy Lead & Hub Coordinator
        if (activeRole === 'privacyLead' || activeRole === 'hubCoordinator' || activeRole === 'steeringCircle') {
          const wq = await listWorkQueue();
          if (!cancelled) setWorkQueue(wq);
        } else {
          setWorkQueue([]);
        }

        if (
          activeRole === 'analyst' ||
          activeRole === 'steeringCircle' ||
          activeRole === 'council' ||
          activeRole === 'backboneLead'
        ) {
          const a = await listAggregates(tenantId);
          if (!cancelled) setAggregates(a);
        } else {
          setAggregates([]);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.removeEventListener('workforce:role-switch', handleRoleSwitch);
    };
  }, [user, tenantId, activeRole]);

  const grantExpiryFormatted = activeGrant?.term?.validUntil
    ? formatTimestamp(activeGrant.term.validUntil)
    : 'Session grant';

  return (
    <div className="dashboard-zones">
      {/* Zone 1: Acting Context */}
      <section className="acting-context-bar" aria-label="Current acting capacity context">
        <div className="acting-title-group">
          <h1>{manifest.title} Workspace</h1>
          <div className="acting-meta">
            Capacity ring: <strong>{catalogEntry.ring}</strong> · Hub: <strong>{tenantId}</strong> · Term expiry: <strong>{grantExpiryFormatted}</strong>
          </div>
        </div>
        <div className="acting-scope-badge">
          Scope: <code>{activeGrant?.jurisdictionScope || tenantId}</code>
        </div>
      </section>

      {/* Zone 2: Role Purpose */}
      <section className="charter-banner" aria-label="Role charter">
        <strong>Charter:</strong> {manifest.charter}
      </section>

      <ErrorNotice error={error} />

      {/* Zone 3: Attention Queue */}
      <section className="card" aria-label="Attention Queue">
        <h2>Attention Queue</h2>
        {manifest.attentionQueue.length === 0 ? (
          <p className="muted">No pending alerts or required actions in this queue.</p>
        ) : (
          <ul className="attention-list">
            {manifest.attentionQueue.map((item) => (
              <li key={item.id} className="row" style={{ justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <strong>{item.title}</strong>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>{item.detail}</div>
                </div>
                {item.actionPath && (
                  <Link to={item.actionPath} className="btn" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>
                    {item.actionLabel || 'Action'}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Zone 4: Core Work */}
      <section className="card" aria-label="Core Work Modules">
        <h2>Core Work</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {manifest.coreWork.map((m) => (
            <div key={m.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: 'var(--navy)' }}>{m.title}</h3>
                <p className="muted" style={{ fontSize: '0.88rem', margin: '0 0 1rem 0' }}>{m.description}</p>
              </div>
              <Link to={m.path} style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                {m.commandLabel}
              </Link>
            </div>
          ))}
        </div>

        {/* Worker preview items if in worker capacity */}
        {activeRole === 'worker' && steps.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <h4>Active Pathway Progress ({steps.length})</h4>
            <ul>
              {steps.slice(0, 3).map((s) => (
                <li key={s.id}>
                  {s.title} — <span className="pill">{s.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Aggregate preview if in intelligence/governance capacity */}
        {(activeRole === 'analyst' || activeRole === 'steeringCircle') && aggregates.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <h4>Recent Hub Aggregates ({aggregates.length})</h4>
            <table>
              <thead>
                <tr><th>Metric</th><th>Period</th><th>Value</th></tr>
              </thead>
              <tbody>
                {aggregates.slice(0, 5).map((a) => (
                  <tr key={a.id}>
                    <td>{a.metric}</td>
                    <td>{a.period}</td>
                    <td>{a.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Circular Agreements preview for Wave A roles */}
        {(activeRole === 'worker' || activeRole === 'supervisor' || activeRole === 'mentor' || activeRole === 'facilitator') && agreements.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0 }}>Active Circular Practice Agreements ({agreements.length})</h4>
              <Link to="/agreements" style={{ fontSize: '0.85rem' }}>View All →</Link>
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
              {agreements.slice(0, 3).map((agr) => (
                <li key={agr.id} style={{ marginBottom: '0.35rem' }}>
                  <strong>{agr.title}</strong> — <span className="pill">{agr.type}</span> ({agr.status})
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Work Queue Routing preview for Privacy Lead & Hub Coordinator */}
        {(activeRole === 'privacyLead' || activeRole === 'hubCoordinator' || activeRole === 'steeringCircle') && workQueue.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0 }}>Active Work Routing Tickets ({workQueue.length})</h4>
              <Link to="/governance" style={{ fontSize: '0.85rem' }}>Manage Queue →</Link>
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
              {workQueue.slice(0, 4).map((ticket) => (
                <li key={ticket.id} style={{ marginBottom: '0.35rem' }}>
                  <strong>{ticket.title}</strong> — <span className="pill" style={{ textTransform: 'uppercase' }}>{ticket.lane}</span> [{ticket.priority}]
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Zone 5: Handoffs */}
      <section className="card" aria-label="Handoffs Zone">
        <h2>Handoffs & Boundary Transfers</h2>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          {manifest.handoffs.description}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <span className={`pill ${manifest.handoffs.canInitiate ? 'live' : ''}`}>
            Initiate Handoff: {manifest.handoffs.canInitiate ? 'Authorized' : 'Prohibited'}
          </span>
          <span className={`pill ${manifest.handoffs.canReceive ? 'live' : ''}`}>
            Receive Handoff: {manifest.handoffs.canReceive ? 'Authorized' : 'Prohibited'}
          </span>
        </div>
      </section>

      {/* Zone 6: Learning & Accountability */}
      <section className="card" aria-label="Learning and Accountability">
        <h2>Learning & Accountability</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {manifest.learningAccountability.map((item, idx) => (
            <div key={idx} style={{ background: 'var(--gold-light)', padding: '0.85rem', borderRadius: '6px' }}>
              <strong style={{ color: 'var(--navy)' }}>{item.title}</strong>
              <p style={{ margin: '0.35rem 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--ink)' }}>
                {item.description}
              </p>
              <Link to={item.path} style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Access →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Zone 7: Boundaries */}
      <section className="boundary-zone-card" aria-label="Role Boundaries">
        <h3>Role Boundaries (What this role never shows or accesses)</h3>
        <ul>
          {manifest.boundaries.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

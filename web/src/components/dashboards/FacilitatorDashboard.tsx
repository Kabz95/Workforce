import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listAdaptationLogs,
  listGovernanceDecisions,
  listMyRoleGrants,
  listOpportunities,
} from '../../lib/queries';
import {
  ROLE_LABELS,
  formatTimestamp,
  type AdaptationLog,
  type GovernanceDecision,
  type Opportunity,
  type RoleGrant,
  type WithId,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Facilitator dashboard — informational only.
 *
 * Built strictly from data the facilitator may lawfully read today:
 * published hub governance decisions, the tenant opportunities list,
 * hub adaptation logs (tenant-visible), and the facilitator's own
 * grants. There is NO learning-space data model yet (no communities-
 * of-practice / training-session collections exist), so this
 * dashboard says so plainly instead of inventing one. Hub membership
 * counts are NOT shown: the memberships read is restricted to
 * authoriser roles in the rules, and the facilitator is not one.
 */
export default function FacilitatorDashboard() {
  const { user, tenantId } = useAuth();
  const [decisions, setDecisions] = useState<WithId<GovernanceDecision>[]>([]);
  const [opportunities, setOpportunities] = useState<WithId<Opportunity>[]>([]);
  const [adaptations, setAdaptations] = useState<WithId<AdaptationLog>[]>([]);
  const [grants, setGrants] = useState<WithId<RoleGrant>[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          listGovernanceDecisions(tenantId),
          listOpportunities(tenantId),
          listAdaptationLogs(tenantId),
          listMyRoleGrants(user.uid, tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [d, o, a, g] = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
        setDecisions((d as WithId<GovernanceDecision>[]) ?? []);
        setOpportunities((o as WithId<Opportunity>[]) ?? []);
        setAdaptations((a as WithId<AdaptationLog>[]) ?? []);
        setGrants((g as WithId<RoleGrant>[]) ?? []);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    void load();
    return () => {
      cancelled = true;
      unregister();
    };
  }, [user, tenantId]);

  const byDate = (a: WithId<GovernanceDecision>, b: WithId<GovernanceDecision>) =>
    (b.decidedAt?.toMillis?.() ?? 0) - (a.decidedAt?.toMillis?.() ?? 0);
  const recentDecisions = [...decisions].sort(byDate).slice(0, 5);

  return (
    <div className="dashboard" data-testid="facilitator-dashboard">
      <ErrorNotice error={error} />

      <section className="card">
        <h2>Learning spaces</h2>
        <p className="muted">
          Communities of practice and training sessions do not have a data
          model in the platform yet — there is nothing to list here until
          one is designed. What a facilitator can see today is the hub&apos;s
          published decisions, its adaptation logs, and its open
          opportunities, below.
        </p>
      </section>

      <section className="card">
        <h2>Hub decisions</h2>
        {recentDecisions.length === 0 ? (
          <p className="muted">No governance decisions published for this hub yet.</p>
        ) : (
          <ul>
            {recentDecisions.map((d) => (
              <li key={d.id}>
                <strong>{d.title}</strong> · {formatTimestamp(d.decidedAt)}
              </li>
            ))}
          </ul>
        )}
        <p><Link to="/governance">Governance →</Link></p>
      </section>

      <section className="card">
        <h2>Hub adaptation logs</h2>
        {adaptations.length === 0 ? (
          <p className="muted">No adaptation logs for this hub yet.</p>
        ) : (
          <ul>
            {adaptations.slice(0, 5).map((a) => (
              <li key={a.id}>
                {a.changeDescription} ({a.coreOrForm}) — {a.rationale}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Open opportunities in this hub ({opportunities.length})</h2>
        {opportunities.length === 0 ? (
          <p className="muted">No opportunities posted in this hub yet.</p>
        ) : (
          <ul>
            {opportunities.slice(0, 5).map((o) => (
              <li key={o.id}>
                <strong>{o.title}</strong> · {o.location}
              </li>
            ))}
          </ul>
        )}
        <p><Link to="/opportunities">Opportunities →</Link></p>
      </section>

      <section className="card">
        <h2>Your roles &amp; accountability</h2>
        {grants.length === 0 ? (
          <p className="muted">No grants loaded for this session.</p>
        ) : (
          <ul>
            {grants.map((g) => (
              <li key={g.id}>
                {ROLE_LABELS[g.role] ?? g.role} · <span className="pill">{g.status}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/audit">My audit log →</Link>{' '}
          <Link to="/grants">My roles &amp; grants →</Link>
        </p>
        <p className="muted">
          Facilitation is recorded under this acting capacity. Facilitation
          never inspects individual worker records.
        </p>
      </section>
    </div>
  );
}

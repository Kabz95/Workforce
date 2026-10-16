import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listAdaptationLogs,
  listGovernanceDecisions,
  listHubAssignments,
  listHubConflicts,
  listHubMemberships,
  listHubRoleGrants,
  listMyHandoffs,
} from '../../lib/queries';
import {
  formatTimestamp,
  ROLE_LABELS,
  type AdaptationLog,
  type Assignment,
  type ConflictDeclaration,
  type GovernanceDecision,
  type Handoff,
  type Membership,
  type RoleGrant,
  type WithId,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Hub Coordinator dashboard — the hub's operating desk.
 *
 * Local capacity (role grants by role), hub agreements (governance
 * decisions), membership, safety procedures (adaptation logs), and
 * handoffs the coordinator sent. The coordinator sees NO worker
 * records: this dashboard queries grants, memberships, assignments,
 * conflicts, decisions and adaptation logs only — never workers,
 * first-contact forms, pathway steps, or supervision content.
 */
export default function HubCoordinatorDashboard() {
  const { user, tenantId } = useAuth();
  const [grants, setGrants] = useState<WithId<RoleGrant>[]>([]);
  const [memberships, setMemberships] = useState<WithId<Membership>[]>([]);
  const [assignments, setAssignments] = useState<WithId<Assignment>[]>([]);
  const [conflicts, setConflicts] = useState<WithId<ConflictDeclaration>[]>([]);
  const [decisions, setDecisions] = useState<WithId<GovernanceDecision>[]>([]);
  const [adaptations, setAdaptations] = useState<WithId<AdaptationLog>[]>([]);
  const [handoffs, setHandoffs] = useState<WithId<Handoff>[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          listHubRoleGrants(tenantId),
          listHubMemberships(tenantId),
          listHubAssignments(tenantId),
          listHubConflicts(tenantId),
          listGovernanceDecisions(tenantId),
          listAdaptationLogs(tenantId),
          listMyHandoffs(user.uid, tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [g, m, a, c, d, al, h] = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
        setGrants((g as WithId<RoleGrant>[]) ?? []);
        setMemberships((m as WithId<Membership>[]) ?? []);
        setAssignments((a as WithId<Assignment>[]) ?? []);
        setConflicts((c as WithId<ConflictDeclaration>[]) ?? []);
        setDecisions((d as WithId<GovernanceDecision>[]) ?? []);
        setAdaptations((al as WithId<AdaptationLog>[]) ?? []);
        setHandoffs((h as WithId<Handoff>[]) ?? []);
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

  const activeGrants = grants.filter((g) => g.status === 'active');
  const proposedGrants = grants.filter((g) => g.status === 'proposed');
  const openConflicts = conflicts.filter((c) => c.status === 'open');
  const activeAssignments = assignments.filter((a) => a.status === 'active');
  const sentHandoffs = handoffs.filter((h) => h.senderId === user?.uid);
  const offeredHandoffs = sentHandoffs.filter((h) => h.status === 'offered');

  // Local capacity: active grants by role.
  const byRole = new Map<string, number>();
  for (const g of activeGrants) byRole.set(g.role, (byRole.get(g.role) ?? 0) + 1);

  return (
    <div className="dashboard">
      <ErrorNotice error={error} />
      <section className="card">
        <h2>Attention queue</h2>
        {proposedGrants.length === 0 && openConflicts.length === 0 && offeredHandoffs.length === 0 ? (
          <p className="muted">Nothing awaiting the hub.</p>
        ) : (
          <ul>
            {proposedGrants.map((g) => (
              <li key={g.id}>
                Role-grant request awaiting review: {ROLE_LABELS[g.role]} for {g.granteeId} ·{' '}
                <Link to="/grants">review →</Link>
              </li>
            ))}
            {openConflicts.map((c) => (
              <li key={c.id}>
                Open conflict declaration: {c.description}
              </li>
            ))}
            {offeredHandoffs.map((h) => (
              <li key={h.id}>
                Handoff you sent, awaiting the recipient: {h.purpose} ·{' '}
                <span className="pill">{h.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Core work — local capacity</h2>
        <p className="muted">
          Active role grants in this hub (capacity, not people under
          surveillance — no worker records are shown here):
        </p>
        {byRole.size === 0 ? (
          <p className="muted">No active grants in this hub yet.</p>
        ) : (
          <ul>
            {[...byRole.entries()].map(([role, count]) => (
              <li key={role}>
                {ROLE_LABELS[role as keyof typeof ROLE_LABELS]}: {count}
              </li>
            ))}
          </ul>
        )}
        <p>
          Memberships: {memberships.length} · Active assignments: {activeAssignments.length} ·{' '}
          Proposed grants: {proposedGrants.length}
        </p>
      </section>

      <section className="card">
        <h2>Hub agreements</h2>
        {decisions.length === 0 ? (
          <p className="muted">No governance decisions published for this hub yet.</p>
        ) : (
          <ul>
            {decisions.slice(0, 5).map((d) => (
              <li key={d.id}>
                <strong>{d.title}</strong> · {formatTimestamp(d.decidedAt)}
              </li>
            ))}
          </ul>
        )}
        <p><Link to="/governance">Governance →</Link></p>
      </section>

      <section className="card">
        <h2>Safety procedures + local adaptations</h2>
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
        <h2>Handoffs</h2>
        {sentHandoffs.length === 0 ? (
          <p className="muted">You have not sent any handoffs.</p>
        ) : (
          <ul>
            {sentHandoffs.slice(0, 5).map((h) => (
              <li key={h.id}>
                {h.purpose} — to {h.recipientRole} · <span className="pill">{h.status}</span>
              </li>
            ))}
          </ul>
        )}
        <p><Link to="/handoffs">Offer / view handoffs →</Link></p>
      </section>

      <section className="card">
        <h2>Learning + accountability</h2>
        <p>
          <Link to="/audit">My audit log →</Link>{' '}
          <Link to="/grants">My roles &amp; grants →</Link>{' '}
          <Link to="/governance">Governance →</Link>
        </p>
        <p className="muted">
          Hub decisions and grants are recorded under this acting capacity.
          Coordination never opens a worker&apos;s record.
        </p>
      </section>
    </div>
  );
}

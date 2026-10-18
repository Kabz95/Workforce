import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listAggregates,
  listHubAccessEvents,
  listHubComplaints,
} from '../../lib/queries';
import {
  formatTimestamp,
  type AccessEvent,
  type Aggregate,
  type Complaint,
  type WithId,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Privacy Lead dashboard — guard the floor, never inspect records.
 *
 * Oversight here is AGGREGATES + ACCESS EVENTS + COMPLAINTS, never
 * record contents:
 * - The consent rules allow only granter / grantee reads, so there
 *   is deliberately NO hub-wide consent listing. The consent
 *   overview is built from access events (grant / revoke / expire
 *   actions) and published aggregates.
 * - Every displayed count smaller than 5 is suppressed ("fewer
 *   than 5"), including totals — a small count is still a signal
 *   about real people.
 * - Audit oversight shows aggregates + the most recent DENIED
 *   events (the exceptions that need review). It is NOT an
 *   activity feed: allowed events are counted, not listed.
 * - Deletion requests are owner-only (rules) and are never shown
 *   here. Record contents are never shown here.
 */
const SUPPRESSION_FLOOR = 5;

/** A count below the floor is shown as suppressed, never as a number. */
function displayCount(n: number): string {
  return n < SUPPRESSION_FLOOR ? 'fewer than 5' : String(n);
}

const CONSENT_ACTIONS = ['grantAccess', 'revokeConsent', 'expireConsent'] as const;

export default function PrivacyLeadDashboard() {
  const { tenantId } = useAuth();
  const [events, setEvents] = useState<WithId<AccessEvent>[]>([]);
  const [complaints, setComplaints] = useState<WithId<Complaint>[]>([]);
  const [aggregates, setAggregates] = useState<WithId<Aggregate>[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          listHubAccessEvents(tenantId),
          listHubComplaints(tenantId),
          listAggregates(tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [e, c, a] = results.map((x) => (x.status === 'fulfilled' ? x.value : []));
        setEvents((e as WithId<AccessEvent>[]) ?? []);
        setComplaints((c as WithId<Complaint>[]) ?? []);
        setAggregates((a as WithId<Aggregate>[]) ?? []);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    void load();
    return () => {
      cancelled = true;
      unregister();
    };
  }, [tenantId]);

  const denied = useMemo(
    () => events.filter((e) => e.result === 'denied'),
    [events],
  );
  const recentDenied = useMemo(
    () =>
      [...denied]
        .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
        .slice(0, 5),
    [denied],
  );
  const consentActionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const action of CONSENT_ACTIONS) counts.set(action, 0);
    for (const e of events) {
      if (CONSENT_ACTIONS.includes(e.action as (typeof CONSENT_ACTIONS)[number])) {
        counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
      }
    }
    return counts;
  }, [events]);
  const actionBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);
  const openComplaints = complaints.filter((c) => c.status === 'open' || c.status === 'in-review');
  const complaintStatusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of complaints) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [complaints]);

  return (
    <div className="dashboard" data-testid="privacy-lead-dashboard">
      <ErrorNotice error={error} />
      <section className="card">
        <h2>Attention queue</h2>
        {openComplaints.length === 0 && denied.length === 0 ? (
          <p className="muted">No open complaints. No denied accesses to review.</p>
        ) : (
          <ul>
            {openComplaints.map((c) => (
              <li key={c.id}>
                Complaint ({c.status}): {c.summary} · from {c.complainantId}
              </li>
            ))}
            {denied.length > 0 && (
              <li>
                {displayCount(denied.length)} denied access {denied.length === 1 ? 'attempt' : 'attempts'} — review below.
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Core work — consent overview (aggregates)</h2>
        <p className="muted">
          There is no hub-wide listing of individual consents — the
          consent rules allow only granter / grantee reads, by design.
          This overview counts consent actions from the access log.
          Every count below {SUPPRESSION_FLOOR} is suppressed.
        </p>
        <table>
          <thead><tr><th>Consent action</th><th>Count</th></tr></thead>
          <tbody>
            {[...consentActionCounts.entries()].map(([action, count]) => (
              <tr key={action}>
                <td>{action}</td>
                <td>{displayCount(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Audit oversight — exceptions only</h2>
        <p className="muted">
          Allowed accesses are counted, not listed. Only denied
          attempts — the exceptions that may need review — are shown
          individually. This is oversight, not an activity feed.
        </p>
        <table>
          <thead><tr><th>Action</th><th>Count</th></tr></thead>
          <tbody>
            {actionBreakdown.length === 0 ? (
              <tr><td colSpan={2} className="muted">No access events recorded for this hub.</td></tr>
            ) : (
              actionBreakdown.map(([action, count]) => (
                <tr key={action}>
                  <td>{action}</td>
                  <td>{displayCount(count)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {recentDenied.length > 0 && (
          <>
            <h3>Most recent denied attempts</h3>
            <ul>
              {recentDenied.map((e) => (
                <li key={e.id}>
                  {formatTimestamp(e.createdAt)} · {e.action} on {e.resourceType}/{e.resourceId} ·
                  actor {e.actorId} ({e.actingRole}) · purpose: {e.purpose}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>Complaints</h2>
        <table>
          <thead><tr><th>Status</th><th>Count</th></tr></thead>
          <tbody>
            {complaintStatusCounts.length === 0 ? (
              <tr><td colSpan={2} className="muted">No complaints for this hub.</td></tr>
            ) : (
              complaintStatusCounts.map(([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{displayCount(count)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Data-minimisation report</h2>
        <p className="muted">
          Published aggregates are de-identified before they are
          written; cells below {SUPPRESSION_FLOOR} are suppressed at
          the source. Record contents, deletion requests, and
          individual consent records never appear in this view.
        </p>
        <ul>
          <li>Published aggregates for this hub: {displayCount(aggregates.length)}</li>
          <li>Complaints on file: {displayCount(complaints.length)}</li>
          <li>Access events on file: {displayCount(events.length)}</li>
          <li>Denied access attempts: {displayCount(denied.length)}</li>
        </ul>
        {aggregates.length > 0 && (
          <table>
            <thead><tr><th>Metric</th><th>Period</th><th>Value</th></tr></thead>
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

      <section className="card">
        <h2>Learning + accountability</h2>
        <p>
          <Link to="/audit">My audit log →</Link>{' '}
          <Link to="/grants">My roles &amp; grants →</Link>{' '}
          <Link to="/governance">Governance →</Link>
        </p>
        <p className="muted">
          Privacy review inspects access events and grants — never
          record contents. Privacy decisions are recorded under this
          acting capacity.
        </p>
      </section>
    </div>
  );
}

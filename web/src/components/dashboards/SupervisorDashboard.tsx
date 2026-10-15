import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listConsentsReceived,
  listMyAssignmentsForRole,
  listMyHandoffs,
  listSharedSupervisionSessions,
} from '../../lib/queries';
import {
  formatTimestamp,
  type Assignment,
  type Consent,
  type Handoff,
  type SupervisionSession,
  type WithId,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Supervisor dashboard — reflective supervision, by lived experience.
 *
 * The supervisor sees ONLY what workers consented to share with them:
 * supervision sessions in their sharedWith (via a live consent), the
 * assignments where they are the holder, consents naming them as
 * grantee, and handoffs addressed to them. The supervisorId link on a
 * session confers NO read by itself — a session appears here only
 * through a live worker consent. There is no queue of unshared
 * sessions, no worker-record view, no "last active", and no
 * productivity measure of any kind: supervision is reflective
 * practice, not surveillance.
 */
export default function SupervisorDashboard() {
  const { user, tenantId } = useAuth();
  const [sessions, setSessions] = useState<WithId<SupervisionSession>[]>([]);
  const [assignments, setAssignments] = useState<WithId<Assignment>[]>([]);
  const [handoffs, setHandoffs] = useState<WithId<Handoff>[]>([]);
  const [received, setReceived] = useState<WithId<Consent>[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          listSharedSupervisionSessions(user.uid, tenantId),
          listMyAssignmentsForRole(user.uid, tenantId, 'supervisor'),
          listMyHandoffs(user.uid, tenantId),
          listConsentsReceived(user.uid, tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [s, a, h, r] = results.map((x) => (x.status === 'fulfilled' ? x.value : []));
        setSessions((s as WithId<SupervisionSession>[]) ?? []);
        setAssignments((a as WithId<Assignment>[]) ?? []);
        setHandoffs((h as WithId<Handoff>[]) ?? []);
        setReceived((r as WithId<Consent>[]) ?? []);
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

  const incoming = handoffs.filter((h) => h.recipientId === user?.uid);
  const offered = incoming.filter((h) => h.status === 'offered');
  const activeAssignments = assignments.filter((a) => a.status === 'active');
  // Live consents for supervision sessions naming this supervisor.
  const liveSessionConsents = received.filter(
    (c) =>
      c.resourceType === 'supervisionSessions' &&
      !c.revokedAt &&
      c.expiresAt.toDate() > new Date(),
  );

  return (
    <div data-testid="supervisor-dashboard">
      <ErrorNotice error={error} />
      <section className="card">
        <h2>Attention queue</h2>
        {offered.length === 0 && liveSessionConsents.length === 0 ? (
          <p className="muted">No handoffs awaiting your response, no new supervision consents.</p>
        ) : (
          <ul>
            {offered.map((h) => (
              <li key={h.id}>
                Handoff awaiting you: {h.purpose} (about worker {h.workerId}) ·{' '}
                <Link to="/handoffs">respond →</Link>
              </li>
            ))}
            {liveSessionConsents.map((c) => (
              <li key={c.id}>
                Live supervision consent from worker {c.granterId} — {c.purpose} · expires{' '}
                {formatTimestamp(c.expiresAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Core work — supervision</h2>
        <p className="muted">
          Only sessions workers consented to share with you appear here.
          A session is never visible through the supervisor link alone.
        </p>
        <h3>My supervision assignments ({activeAssignments.length} active)</h3>
        {activeAssignments.length === 0 ? (
          <p className="muted">No active supervision assignments.</p>
        ) : (
          <ul>
            {activeAssignments.map((a) => (
              <li key={a.id}>
                Supervision for worker {a.workerId} · since {formatTimestamp(a.startedAt)}
              </li>
            ))}
          </ul>
        )}
        <h3>Supervision sessions shared with me ({sessions.length})</h3>
        {sessions.length === 0 ? (
          <p className="muted">No supervision sessions shared with you yet.</p>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                Session {formatTimestamp(s.date)} · worker {s.ownerId}
                <br />
                <span className="muted">{s.notes || '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Handoffs</h2>
        {incoming.length === 0 ? (
          <p className="muted">No handoffs addressed to you.</p>
        ) : (
          <ul>
            {incoming.slice(0, 5).map((h) => (
              <li key={h.id}>
                {h.purpose} — from {h.senderRole} · <span className="pill">{h.status}</span>
              </li>
            ))}
          </ul>
        )}
        <p><Link to="/handoffs">All handoffs →</Link></p>
      </section>

      <section className="card">
        <h2>Learning + accountability</h2>
        <p>
          <Link to="/audit">My audit log →</Link>{' '}
          <Link to="/grants">My roles &amp; grants →</Link>
        </p>
        <p className="muted">
          Supervision is recorded under this acting capacity, never routed
          to a line manager. Supervision observations reach an employer
          ONLY through the agreed channel.
        </p>
      </section>
    </div>
  );
}

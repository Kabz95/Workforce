import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listConsentsReceived,
  listMyAssignmentsForRole,
  listMyHandoffs,
  listMyMentorships,
  listSharedMentorships,
} from '../../lib/queries';
import {
  formatTimestamp,
  type Assignment,
  type Consent,
  type Handoff,
  type Mentorship,
  type WithId,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Mentor dashboard — companionship, not case management.
 *
 * The mentor sees ONLY their own mentorships: relationships they
 * participate in (participantIds) or records shared with them by
 * consent (sharedWith), plus their mentorship assignments, consents
 * naming them as grantee, and handoffs addressed to them. There is
 * no list of workers, no worker-record view, no "last active", and
 * no measure of a mentee's activity: mentorship holds the
 * relationship, not the record. Mentorship never reaches the line
 * manager.
 */
export default function MentorDashboard() {
  const { user, tenantId } = useAuth();
  const [mentorships, setMentorships] = useState<WithId<Mentorship>[]>([]);
  const [shared, setShared] = useState<WithId<Mentorship>[]>([]);
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
          listMyMentorships(user.uid, tenantId),
          listSharedMentorships(user.uid, tenantId),
          listMyAssignmentsForRole(user.uid, tenantId, 'mentor'),
          listMyHandoffs(user.uid, tenantId),
          listConsentsReceived(user.uid, tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [m, sh, a, h, r] = results.map((x) => (x.status === 'fulfilled' ? x.value : []));
        setMentorships((m as WithId<Mentorship>[]) ?? []);
        setShared((sh as WithId<Mentorship>[]) ?? []);
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
  const liveReceived = received.filter(
    (c) => !c.revokedAt && c.expiresAt.toDate() > new Date(),
  );
  // A mentorship shared with me by consent that I do not participate in.
  const sharedOnly = shared.filter((s) => !mentorships.some((m) => m.id === s.id));

  return (
    <div className="dashboard" data-testid="mentor-dashboard">
      <ErrorNotice error={error} />
      <section className="card">
        <h2>Attention queue</h2>
        {offered.length === 0 && liveReceived.length === 0 ? (
          <p className="muted">No handoffs awaiting your response, no new consents naming you.</p>
        ) : (
          <ul>
            {offered.map((h) => (
              <li key={h.id}>
                Handoff awaiting you: {h.purpose} (about worker {h.workerId}) ·{' '}
                <Link to="/handoffs">respond →</Link>
              </li>
            ))}
            {liveReceived.map((c) => (
              <li key={c.id}>
                Live consent from worker {c.granterId} — {c.scope} · {c.purpose} · expires{' '}
                {formatTimestamp(c.expiresAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Core work — mentorship</h2>
        <p className="muted">
          Only mentorships you participate in, or records shared with you
          by consent, appear here. There is no list of workers.
        </p>
        <h3>My mentorship assignments ({activeAssignments.length} active)</h3>
        {activeAssignments.length === 0 ? (
          <p className="muted">No active mentorship assignments.</p>
        ) : (
          <ul>
            {activeAssignments.map((a) => (
              <li key={a.id}>
                Mentorship for worker {a.workerId} · since {formatTimestamp(a.startedAt)}
              </li>
            ))}
          </ul>
        )}
        <h3>My mentorships ({mentorships.length})</h3>
        {mentorships.length === 0 ? (
          <p className="muted">No mentorships yet.</p>
        ) : (
          <ul>
            {mentorships.map((m) => (
              <li key={m.id}>
                With {m.participantIds.filter((p) => p !== user?.uid).join(', ') || '—'}
                <br />
                <span className="muted">{m.notes || '—'}</span>
              </li>
            ))}
          </ul>
        )}
        {sharedOnly.length > 0 && (
          <>
            <h3>Shared with me by consent ({sharedOnly.length})</h3>
            <ul>
              {sharedOnly.map((m) => (
                <li key={m.id}>
                  Mentorship · participants {m.participantIds.join(', ')}
                  <br />
                  <span className="muted">{m.notes || '—'}</span>
                </li>
              ))}
            </ul>
          </>
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
          Mentorship activity is recorded under this acting capacity.
          Mentorship never reaches the line manager.
        </p>
      </section>
    </div>
  );
}

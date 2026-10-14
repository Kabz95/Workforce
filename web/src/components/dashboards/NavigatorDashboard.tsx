import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listConsentsReceived,
  listMyHandoffs,
  listSharedFirstContactForms,
  listSharedPathwaySteps,
} from '../../lib/queries';
import {
  formatTimestamp,
  type Consent,
  type FirstContactForm,
  type Handoff,
  type PathwayStep,
  type WithId,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Navigator dashboard — wayfinding only.
 *
 * The navigator sees ONLY what workers consented to share with them:
 * first-contact forms and pathway steps in their sharedWith, plus the
 * handoffs addressed to them. There is no intake queue of unshared
 * forms — a queue of unconsented records would be surveillance, not
 * wayfinding. This dashboard never predicts, never assesses: there is
 * no prediction or assessment field anywhere in it.
 */
export default function NavigatorDashboard() {
  const { user, tenantId } = useAuth();
  const [handoffs, setHandoffs] = useState<WithId<Handoff>[]>([]);
  const [forms, setForms] = useState<WithId<FirstContactForm>[]>([]);
  const [steps, setSteps] = useState<WithId<PathwayStep>[]>([]);
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
          listMyHandoffs(user.uid, tenantId),
          listSharedFirstContactForms(user.uid, tenantId),
          listSharedPathwaySteps(user.uid, tenantId),
          listConsentsReceived(user.uid, tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [h, f, s, r] = results.map((x) => (x.status === 'fulfilled' ? x.value : []));
        setHandoffs((h as WithId<Handoff>[]) ?? []);
        setForms((f as WithId<FirstContactForm>[]) ?? []);
        setSteps((s as WithId<PathwayStep>[]) ?? []);
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
  const active = incoming.filter((h) => h.status === 'accepted');
  const liveReceived = received.filter((c) => !c.revokedAt && c.expiresAt.toDate() > new Date());

  return (
    <div>
      <ErrorNotice error={error} />
      <section className="card">
        <h2>Attention queue</h2>
        {offered.length === 0 ? (
          <p className="muted">No handoffs awaiting your response.</p>
        ) : (
          <ul>
            {offered.map((h) => (
              <li key={h.id}>
                Handoff awaiting you: {h.purpose} (about worker {h.workerId}) ·{' '}
                <Link to="/handoffs">respond →</Link>
              </li>
            ))}
          </ul>
        )}
        {active.length > 0 && (
          <p className="muted">
            {active.length} accepted handoff{active.length === 1 ? '' : 's'} in progress —{' '}
            <Link to="/handoffs">view →</Link>
          </p>
        )}
      </section>

      <section className="card">
        <h2>Core work — wayfinding</h2>
        <p className="muted">
          Only records workers consented to share with you appear here.
          Wayfinding only: this dashboard never predicts or assesses.
        </p>
        <h3>Shared first-contact forms ({forms.length})</h3>
        {forms.length === 0 ? (
          <p className="muted">No forms shared with you yet.</p>
        ) : (
          <ul>
            {forms.map((f) => (
              <li key={f.id}>
                <strong>{f.contactName}</strong> via {f.contactMethod} · needs: {f.needs || '—'}
                <br />
                <span className="muted">From worker {f.ownerId} · {formatTimestamp(f.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <h3>Shared pathway steps ({steps.length})</h3>
        {steps.length === 0 ? (
          <p className="muted">No pathway steps shared with you yet.</p>
        ) : (
          <ul>
            {steps.map((s) => (
              <li key={s.id}>
                {s.title} ({s.type}) — <span className="pill">{s.status}</span>{' '}
                <span className="muted">· worker {s.ownerId}</span>
              </li>
            ))}
          </ul>
        )}
        <h3>Consents granted to me ({liveReceived.length} live)</h3>
        {liveReceived.length === 0 ? (
          <p className="muted">No live consents naming you as grantee.</p>
        ) : (
          <ul>
            {liveReceived.map((c) => (
              <li key={c.id}>
                {c.scope} from worker {c.granterId} — {c.purpose} · expires{' '}
                {formatTimestamp(c.expiresAt)}
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
          Navigation work is recorded under this acting capacity. Accesses
          you make to shared records appear in the worker&apos;s audit log.
        </p>
      </section>
    </div>
  );
}

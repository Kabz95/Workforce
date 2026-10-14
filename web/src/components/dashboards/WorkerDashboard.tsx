import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  getMyWorker,
  listMyAuditLogs,
  listMyConsents,
  listMyHandoffs,
  listMyPathwaySteps,
} from '../../lib/queries';
import {
  formatTimestamp,
  type AccessEvent,
  type Consent,
  type Handoff,
  type PathwayStep,
  type WithId,
  type Worker,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Worker dashboard — the centre of the circle.
 * Own record, pathway, consents, audit, handoffs about me. Nothing
 * here shows another worker's record; every number below is the
 * worker's own.
 */
export default function WorkerDashboard() {
  const { user, tenantId } = useAuth();
  const [worker, setWorker] = useState<WithId<Worker> | null>(null);
  const [steps, setSteps] = useState<WithId<PathwayStep>[]>([]);
  const [consents, setConsents] = useState<WithId<Consent>[]>([]);
  const [handoffs, setHandoffs] = useState<WithId<Handoff>[]>([]);
  const [audit, setAudit] = useState<WithId<AccessEvent>[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          getMyWorker(user.uid, tenantId),
          listMyPathwaySteps(user.uid, tenantId),
          listMyConsents(user.uid, tenantId),
          listMyHandoffs(user.uid, tenantId),
          listMyAuditLogs(user.uid),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [w, s, c, h, a] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
        setWorker(w as WithId<Worker> | null);
        setSteps((s as WithId<PathwayStep>[]) ?? []);
        setConsents((c as WithId<Consent>[]) ?? []);
        setHandoffs((h as WithId<Handoff>[]) ?? []);
        const events = ((a as WithId<AccessEvent>[]) ?? []).sort(
          (x, y) => y.createdAt.toMillis() - x.createdAt.toMillis(),
        );
        setAudit(events.slice(0, 5));
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

  const liveConsents = consents.filter((c) => !c.revokedAt && c.expiresAt.toDate() > new Date());
  const expiringSoon = liveConsents.filter(
    (c) => c.expiresAt.toDate().getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000,
  );
  const offeredHandoffs = handoffs.filter((h) => h.workerId === user?.uid && h.status === 'offered');
  const inProgress = steps.filter((s) => s.status === 'in-progress');

  return (
    <div>
      <ErrorNotice error={error} />
      <section className="card">
        <h2>Attention queue</h2>
        {expiringSoon.length === 0 && offeredHandoffs.length === 0 && inProgress.length === 0 ? (
          <p className="muted">
            Nothing awaiting you. <Link to="/pathway">Add a pathway step</Link> or{' '}
            <Link to="/consents">review your consents</Link>.
          </p>
        ) : (
          <ul>
            {expiringSoon.map((c) => (
              <li key={c.id}>
                Consent expiring soon: {c.scope} → {c.granteeId} · expires{' '}
                {formatTimestamp(c.expiresAt)} — <Link to="/consents">renew or revoke</Link>
              </li>
            ))}
            {offeredHandoffs.map((h) => (
              <li key={h.id}>
                Handoff about you, awaiting the recipient: {h.purpose} ·{' '}
                <span className="pill">{h.status}</span>
              </li>
            ))}
            {inProgress.map((s) => (
              <li key={s.id}>
                Pathway step in progress: {s.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Core work</h2>
        <p>
          {worker ? (
            <>
              <strong>{worker.displayName}</strong> · <span className="pill">{worker.status}</span>
            </>
          ) : (
            'No worker profile yet.'
          )}{' '}
          <Link to="/record">My record →</Link>
        </p>
        <p>
          Pathway: {steps.length} step{steps.length === 1 ? '' : 's'} ·{' '}
          <Link to="/pathway">Pathway →</Link>
        </p>
        <p>
          Consents: {liveConsents.length} live grant{liveConsents.length === 1 ? '' : 's'} ·{' '}
          <Link to="/consents">Consents →</Link>
        </p>
        <p>
          Handoffs about me: {handoffs.filter((h) => h.workerId === user?.uid).length} ·{' '}
          <Link to="/handoffs">Handoffs →</Link>
        </p>
      </section>

      <section className="card">
        <h2>Handoffs</h2>
        {handoffs.filter((h) => h.workerId === user?.uid).length === 0 ? (
          <p className="muted">No handoffs about your record.</p>
        ) : (
          <ul>
            {handoffs
              .filter((h) => h.workerId === user?.uid)
              .slice(0, 5)
              .map((h) => (
                <li key={h.id}>
                  {h.purpose} — from {h.senderRole} to {h.recipientRole} ·{' '}
                  <span className="pill">{h.status}</span>
                </li>
              ))}
          </ul>
        )}
        <p><Link to="/handoffs">All handoffs →</Link></p>
      </section>

      <section className="card">
        <h2>Learning + accountability</h2>
        <p className="muted">Recent accesses to your records (latest 5):</p>
        {audit.length === 0 ? (
          <p className="muted">No audit entries yet.</p>
        ) : (
          <ul>
            {audit.map((e) => (
              <li key={e.id}>
                {formatTimestamp(e.createdAt)} — {e.action} by {e.actorId} ({e.actingRole}) ·{' '}
                {e.purpose} · <span className="pill">{e.result}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/audit">My audit log →</Link>{' '}
          <Link to="/grants">My roles &amp; grants →</Link>
        </p>
      </section>
    </div>
  );
}

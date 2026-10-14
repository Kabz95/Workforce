import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  closeHandoff,
  createHandoff,
  listMyHandoffs,
  respondHandoff,
} from '../lib/queries';
import {
  formatTimestamp,
  ROLE_LABELS,
  WORKER_PURPOSE_OPTIONS,
  type AnyRole,
  type Handoff,
  type WithId,
} from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

/** Mirror of the Kernel's HANDOFF_SENDERS (the server enforces it). */
const HANDOFF_SENDER_ROLES: AnyRole[] = ['navigator', 'hubCoordinator', 'supervisor', 'mentor'];
const RECIPIENT_ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as AnyRole[]).filter(
  (r) => r !== 'systemAdmin',
);

/**
 * Handoffs — the consented handoff machine, end to end.
 *
 * Who does what (Phase 1, B1 — do not reintroduce worker-responds):
 * - The SENDER offers (navigator / hubCoordinator / supervisor / mentor).
 * - The RECIPIENT responds (accept / decline) and closes when done.
 * - The WORKER is the subject: they see every handoff about them, and
 *   they control access through Consents — revoking the underlying
 *   consent ends access even if the handoff is accepted.
 *
 * The handoff itself carries routing metadata only (purpose +
 * payloadSummary) — never the worker's story. The record travels
 * through the consent grant, not the handoff.
 */
export default function Handoffs() {
  const { user, tenantId, actingRole, actingGrant } = useAuth();
  const [handoffs, setHandoffs] = useState<WithId<Handoff>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const [workerId, setWorkerId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [recipientRole, setRecipientRole] = useState<AnyRole>('navigator');
  const [purpose, setPurpose] = useState('handoff coordination');
  const [payloadSummary, setPayloadSummary] = useState('');

  const acting = {
    actingGrantId: actingGrant?.id ?? null,
    actingRole,
  };

  const load = async () => {
    if (!user) return;
    try {
      setHandoffs(await listMyHandoffs(user.uid, tenantId));
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);

  const offer = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setNotice('');
    try {
      await createHandoff(
        {
          workerId: workerId.trim(),
          recipientId: recipientId.trim(),
          recipientRole,
          purpose,
          payloadSummary: payloadSummary.trim(),
          tenantId,
        },
        { ...acting, purpose },
      );
      setNotice('Handoff offered. The recipient accepts or declines; the worker controls access through Consents.');
      setWorkerId('');
      setRecipientId('');
      setPayloadSummary('');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const respond = async (h: WithId<Handoff>, decision: 'accept' | 'decline') => {
    setError(null);
    setNotice('');
    try {
      await respondHandoff({ handoffId: h.id, decision }, { ...acting, purpose: 'respond to a handoff' });
      setNotice(`Handoff ${decision === 'accept' ? 'accepted' : 'declined'}.`);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const close = async (h: WithId<Handoff>) => {
    if (!window.confirm('Close this handoff?')) return;
    setError(null);
    setNotice('');
    try {
      await closeHandoff({ handoffId: h.id }, { ...acting, purpose: 'handoff coordination' });
      setNotice('Handoff closed.');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const canSend = actingRole !== null && HANDOFF_SENDER_ROLES.includes(actingRole);
  const mine = (h: WithId<Handoff>) => user && h.workerId === user.uid;
  const toMe = (h: WithId<Handoff>) => user && h.recipientId === user.uid;
  const fromMe = (h: WithId<Handoff>) => user && h.senderId === user.uid;

  const rows = (list: WithId<Handoff>[]) => (
    <table>
      <thead>
        <tr><th>Purpose</th><th>From → To</th><th>Status</th><th>Offered</th><th>Updated</th><th></th></tr>
      </thead>
      <tbody>
        {list.map((h) => (
          <tr key={h.id}>
            <td>{h.purpose}{h.payloadSummary ? ` — ${h.payloadSummary}` : ''}</td>
            <td>{ROLE_LABELS[h.senderRole]} → {ROLE_LABELS[h.recipientRole]}</td>
            <td><span className="pill">{h.status}</span></td>
            <td>{formatTimestamp(h.createdAt)}</td>
            <td>{formatTimestamp(h.updatedAt)}</td>
            <td>
              {toMe(h) && h.status === 'offered' && (
                <>
                  <button type="button" onClick={() => respond(h, 'accept')}>Accept</button>{' '}
                  <button type="button" className="secondary" onClick={() => respond(h, 'decline')}>Decline</button>{' '}
                </>
              )}
              {toMe(h) && (h.status === 'offered' || h.status === 'accepted') && (
                <button type="button" className="secondary" onClick={() => close(h)}>Close</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      <h1>Handoffs</h1>
      <div className="gold-rule" />
      <p className="muted">
        A handoff carries routing metadata only — purpose and a short
        summary, never the worker&apos;s story. The record itself travels
        through the worker&apos;s consent grant, not through the handoff.
        The recipient responds; the worker is the subject and controls
        access through <Link to="/consents">Consents</Link>.
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      {canSend && (
        <section className="card">
          <h2>Offer a handoff</h2>
          <p className="muted">
            You are offering as {actingRole ? ROLE_LABELS[actingRole] : '—'}. The
            recipient must hold a live grant for the recipient role, and (unless
            you are the hub coordinator) an active assignment must link you to
            this worker.
          </p>
          <form onSubmit={offer}>
            <div className="field">
              <label htmlFor="workerId">Worker account ID (the handoff is about this worker)</label>
              <input id="workerId" value={workerId} onChange={(e) => setWorkerId(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="recipientId">Recipient account ID</label>
              <input id="recipientId" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="recipientRole">Recipient role</label>
              <select id="recipientRole" value={recipientRole} onChange={(e) => setRecipientRole(e.target.value as AnyRole)}>
                {RECIPIENT_ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="handoffPurpose">Purpose</label>
              <select id="handoffPurpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                {WORKER_PURPOSE_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="payloadSummary">Summary (routing metadata only — never the worker&apos;s story)</label>
              <textarea id="payloadSummary" value={payloadSummary} onChange={(e) => setPayloadSummary(e.target.value)} />
            </div>
            <button type="submit">Offer handoff</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Handoffs to me</h2>
        {handoffs.filter(toMe).length === 0 ? (
          <p className="muted">No handoffs addressed to you.</p>
        ) : (
          rows(handoffs.filter(toMe))
        )}
      </section>

      <section className="card">
        <h2>Handoffs about me (I am the subject)</h2>
        {handoffs.filter(mine).length === 0 ? (
          <p className="muted">No handoffs about your record.</p>
        ) : (
          <>
            {rows(handoffs.filter(mine))}
            <p className="muted">
              You do not respond to handoffs — the recipient does. You control
              access: revoking the underlying consent in{' '}
              <Link to="/consents">Consents</Link> ends access immediately.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Handoffs I sent</h2>
        {handoffs.filter(fromMe).length === 0 ? (
          <p className="muted">You have not sent any handoffs.</p>
        ) : (
          rows(handoffs.filter(fromMe))
        )}
      </section>
    </div>
  );
}

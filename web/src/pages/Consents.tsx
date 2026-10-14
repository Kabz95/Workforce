import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { grantConsent, listMyConsents, revokeConsent } from '../lib/queries';
import { formatTimestamp, WORKER_PURPOSE_OPTIONS, type Consent, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

/** Whole days until expiry (negative = expired). */
function daysUntil(c: WithId<Consent>): number {
  const ms = c.expiresAt.toDate().getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function Consents() {
  const { user, tenantId, actingRole, actingGrant } = useAuth();
  const [consents, setConsents] = useState<WithId<Consent>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [granteeId, setGranteeId] = useState('');
  const [resourceType, setResourceType] = useState('firstContactForms');
  const [resourceId, setResourceId] = useState('');
  const [expiryDays, setExpiryDays] = useState(90);
  const [purpose, setPurpose] = useState(WORKER_PURPOSE_OPTIONS[0]);

  const load = async () => {
    if (!user) return;
    try {
      setConsents(await listMyConsents(user.uid, tenantId));
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setNotice('');
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiryDays);
      // Scope is derived from the record type (the rules require
      // scope == 'read:' + resourceType) — one dropdown, no mismatch.
      await grantConsent(user.uid, tenantId, {
        granteeId,
        scope: `read:${resourceType}`,
        resourceType,
        resourceId: resourceId.trim() || '',
        expiresAt,
        purpose,
      }, {
        actingGrantId: actingGrant?.id ?? null,
        actingRole,
        purpose,
      });
      setNotice('Grant created. It expires automatically — nothing here is open-ended.');
      setGranteeId('');
      setResourceId('');
      setPurpose(WORKER_PURPOSE_OPTIONS[0]);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const revoke = async (c: WithId<Consent>) => {
    if (!user) return;
    if (!window.confirm('Revoke this grant? Access ends immediately.')) return;
    try {
      await revokeConsent(c);
      setNotice('Grant revoked. Access ended immediately.');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const statusOf = (c: WithId<Consent>): 'live' | 'revoked' | 'expired' => {
    if (c.revokedAt) return 'revoked';
    if (c.expiresAt.toDate() <= new Date()) return 'expired';
    return 'live';
  };

  const live = consents.filter((c) => statusOf(c) === 'live');
  const ended = consents.filter((c) => statusOf(c) !== 'live');

  const consentRows = (rows: WithId<Consent>[]) => (
    <table>
      <thead>
        <tr><th>Record</th><th>Grantee</th><th>Purpose</th><th>Expires</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const st = statusOf(c);
          const days = daysUntil(c);
          const expiringSoon = st === 'live' && days <= 7;
          return (
            <tr key={c.id}>
              <td>{c.resourceType} / {c.resourceId}</td>
              <td>{c.granteeId}</td>
              <td>{c.purpose}</td>
              <td>
                {formatTimestamp(c.expiresAt)}
                {st === 'live' && (
                  <span className={`pill ${expiringSoon ? 'warning' : ''}`}>
                    {expiringSoon ? `expires in ${days} day${days === 1 ? '' : 's'} — renew or revoke` : `in ${days} days`}
                  </span>
                )}
              </td>
              <td><span className={`pill ${st}`}>{st}</span></td>
              <td>
                {st === 'live' && (
                  <button type="button" className="danger" onClick={() => revoke(c)}>Revoke</button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div>
      <h1>Consents</h1>
      <div className="gold-rule" />
      <p className="muted">
        You decide who sees what, for how long, and why. Every grant expires.
        Revocation ends access immediately: the server strips the grantee
        from the record and writes an audit event you can see in My audit log.
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      <section className="card">
        <h2>Grant access</h2>
        <form onSubmit={grant}>
          <div className="field">
            <label htmlFor="granteeId">Grantee user ID (navigator / supervisor)</label>
            <input
              id="granteeId"
              value={granteeId}
              onChange={(e) => setGranteeId(e.target.value)}
              required
              placeholder="Their account UID"
            />
            <small>Ask the person for their account ID.</small>
          </div>
          <div className="field">
            <label htmlFor="resourceType">Record type</label>
            <select id="resourceType" value={resourceType} onChange={(e) => setResourceType(e.target.value)}>
              <option value="firstContactForms">First-contact forms</option>
              <option value="pathwaySteps">Pathway steps</option>
              <option value="certificationNavigation">Certification navigation</option>
              <option value="supervisionSessions">Supervision sessions</option>
            </select>
            {resourceType === 'supervisionSessions' && (
              <small>
                Supervision sharing: the supervisor reads this session ONLY
                through this consent. Their supervisorId on the session
                confers no access by itself.
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="resourceId">Record ID (the specific record being shared)</label>
            <input id="resourceId" value={resourceId} onChange={(e) => setResourceId(e.target.value)} required />
            <small>Grants are per-document: one grant per record, so access can be revoked precisely.</small>
          </div>
          <div className="field">
            <label htmlFor="expiryDays">Expires after (days)</label>
            <input
              id="expiryDays"
              type="number"
              min={1}
              max={365}
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="purpose">Purpose (why this person needs access)</label>
            <select id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required>
              {WORKER_PURPOSE_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <small>Purposes come from a fixed list — the server rejects anything else, so your audit log stays legible.</small>
          </div>
          <button type="submit">Grant access</button>
        </form>
      </section>

      <section className="card">
        <h2>Live grants</h2>
        {live.length === 0 ? (
          <p className="muted">No live grants. Nothing of yours is shared right now.</p>
        ) : (
          consentRows(live)
        )}
      </section>

      <section className="card">
        <h2>Ended grants (revoked / expired)</h2>
        {ended.length === 0 ? (
          <p className="muted">No ended grants yet.</p>
        ) : (
          consentRows(ended)
        )}
      </section>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { grantConsent, listMyConsents, revokeConsent } from '../lib/queries';
import { formatTimestamp, type Consent, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

const SCOPES = ['read:firstContactForms', 'read:pathwaySteps', 'read:certificationNavigation'];

export default function Consents() {
  const { user, tenantId, actingRole, actingGrant } = useAuth();
  const [consents, setConsents] = useState<WithId<Consent>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [granteeId, setGranteeId] = useState('');
  const [scope, setScope] = useState(SCOPES[0]);
  const [resourceType, setResourceType] = useState('firstContactForms');
  const [resourceId, setResourceId] = useState('');
  const [expiryDays, setExpiryDays] = useState(90);
  const [purpose, setPurpose] = useState('');

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
      await grantConsent(user.uid, tenantId, {
        granteeId,
        scope,
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
      setPurpose('');
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

  return (
    <div>
      <h1>Consents</h1>
      <div className="gold-rule" />
      <p className="muted">
        You decide who sees what, for how long, and why. Every grant expires.
        Revocation ends access immediately.
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
            <label htmlFor="scope">Scope</label>
            <select id="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="resourceType">Record type</label>
            <select id="resourceType" value={resourceType} onChange={(e) => setResourceType(e.target.value)}>
              <option value="firstContactForms">First-contact forms</option>
              <option value="pathwaySteps">Pathway steps</option>
              <option value="certificationNavigation">Certification navigation</option>
            </select>
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
            <label htmlFor="purpose">Purpose (in your own words)</label>
            <textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
          </div>
          <button type="submit">Grant access</button>
        </form>
      </section>

      <section className="card">
        <h2>My grants</h2>
        {consents.length === 0 ? (
          <p className="muted">No grants yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Scope</th><th>Grantee</th><th>Purpose</th><th>Expires</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {consents.map((c) => {
                const st = statusOf(c);
                return (
                  <tr key={c.id}>
                    <td>{c.scope}</td>
                    <td>{c.granteeId}</td>
                    <td>{c.purpose}</td>
                    <td>{formatTimestamp(c.expiresAt)}</td>
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
        )}
      </section>
    </div>
  );
}

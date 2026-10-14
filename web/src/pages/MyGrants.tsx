import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  declareConflict,
  listMyConflicts,
  requestRoleGrant,
} from '../lib/queries';
import {
  formatTimestampOrMs,
  ROLE_LABELS,
  toMillis,
  type WithId,
  type ConflictDeclaration,
  type Role,
  type ScopeType,
} from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

/**
 * My Roles & Grants — the worker-visible face of the Role Kernel.
 * Lists the person's live role grants (from the server), lets them
 * request a new role grant (goes to 'proposed' for an authorizer), and
 * declare a conflict of interest.
 */
const REQUESTABLE_ROLES: Role[] = [
  'worker', 'mentor', 'supervisor', 'navigator', 'facilitator',
  'hubCoordinator', 'privacyLead', 'steeringCircle', 'council',
  'backboneLead', 'analyst', 'researcher', 'employer',
];

export default function MyGrants() {
  const { user, grants, actingRole, actingGrant, grantsSource, tenantId, refreshGrants } = useAuth();
  const [conflicts, setConflicts] = useState<WithId<ConflictDeclaration>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reqRole, setReqRole] = useState<Role>('mentor');
  const [reqScopeType, setReqScopeType] = useState<ScopeType>('hub');
  const [reqScopeId, setReqScopeId] = useState(tenantId);
  const [reqValidUntil, setReqValidUntil] = useState('');
  const [reqJustification, setReqJustification] = useState('');

  const [conflictDescription, setConflictDescription] = useState('');
  const [conflictMitigation, setConflictMitigation] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void listMyConflicts(user.uid, tenantId)
      .then((c) => { if (!cancelled) setConflicts(c); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [user, tenantId]);

  const acting = {
    actingGrantId: actingGrant?.id ?? null,
    actingRole: actingRole,
  };

  const handleRequestGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await requestRoleGrant(
        {
          role: reqRole,
          scopeType: reqScopeType,
          scopeId: reqScopeType === 'network' ? 'network' : reqScopeId,
          tenantId,
          validUntil: reqValidUntil || undefined,
          justification: reqJustification,
        },
        { ...acting, purpose: 'request a role grant' },
      );
      setNotice('Role-grant request submitted for review. It is not active until an authorizer approves it.');
      await refreshGrants();
    } catch (err) {
      setError(err);
    }
  };

  const handleDeclareConflict = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await declareConflict(
        {
          grantId: actingGrant?.id ?? undefined,
          description: conflictDescription,
          mitigation: conflictMitigation || undefined,
          tenantId,
        },
        { ...acting, purpose: 'declare a conflict' },
      );
      setNotice('Conflict declared. It is now on the record for your acting capacity.');
      setConflictDescription('');
      setConflictMitigation('');
      if (user) setConflicts(await listMyConflicts(user.uid, tenantId));
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <h1>My Roles &amp; Grants</h1>
      <div className="gold-rule" />
      <p className="muted">
        Acting as <strong>{actingRole ? ROLE_LABELS[actingRole] : '—'}</strong> ·{' '}
        Grants source: {grantsSource ?? '—'}
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h2>My role grants</h2>
        {grants.length === 0 ? (
          <p className="muted">
            No role grants on record. Your roles come from your account claims
            until grants are issued. A grant is what authorises action — a
            claim alone does not.
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>Role</th><th>Scope</th><th>Status</th><th>Expires</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {grants.map((g) => {
                const untilMs = toMillis(g.validUntil);
                const daysLeft = untilMs === null ? null : Math.ceil((untilMs - Date.now()) / (24 * 60 * 60 * 1000));
                const expiringSoon = g.status === 'active' && daysLeft !== null && daysLeft <= 7 && daysLeft >= 0;
                return (
                  <tr key={g.id}>
                    <td>{ROLE_LABELS[g.role]}</td>
                    <td>{g.scopeType}:{g.scopeId}</td>
                    <td><span className="pill">{g.status}</span></td>
                    <td>
                      {formatTimestampOrMs(g.validUntil)}
                      {expiringSoon && (
                        <span className="pill warning">
                          expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}
                        </span>
                      )}
                    </td>
                    <td>{g.basis}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <button type="button" onClick={() => void refreshGrants()}>Refresh grants</button>
        <p className="muted">
          See <Link to="/audit">My audit log</Link> for every action taken
          under these grants, and <Link to="/consents">Consents</Link> for
          the access you have granted to others.
        </p>
      </section>

      <section className="card">
        <h2>Request a role grant</h2>
        <p className="muted">
          Requests go to an authorizer as “proposed”. They grant nothing until approved.
        </p>
        <form onSubmit={handleRequestGrant}>
          <label>
            Role
            <select value={reqRole} onChange={(e) => setReqRole(e.target.value as Role)}>
              {REQUESTABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <label>
            Scope type
            <select value={reqScopeType} onChange={(e) => setReqScopeType(e.target.value as ScopeType)}>
              <option value="self">self (this person only)</option>
              <option value="hub">hub</option>
              <option value="network">network (national)</option>
              <option value="employer">employer</option>
            </select>
          </label>
          <label>
            Scope ID
            <input
              value={reqScopeType === 'network' ? 'network' : reqScopeId}
              onChange={(e) => setReqScopeId(e.target.value)}
              disabled={reqScopeType === 'network'}
              required
            />
          </label>
          <label>
            Valid until (optional, ISO date)
            <input type="date" value={reqValidUntil} onChange={(e) => setReqValidUntil(e.target.value)} />
          </label>
          <label>
            Justification (why this role, in this scope)
            <input value={reqJustification} onChange={(e) => setReqJustification(e.target.value)} required />
          </label>
          <button type="submit">Submit request</button>
        </form>
      </section>

      <section className="card">
        <h2>Declare a conflict</h2>
        <form onSubmit={handleDeclareConflict}>
          <label>
            Description (what the conflict is)
            <textarea value={conflictDescription} onChange={(e) => setConflictDescription(e.target.value)} required />
          </label>
          <label>
            Mitigation (how you will handle it)
            <textarea value={conflictMitigation} onChange={(e) => setConflictMitigation(e.target.value)} />
          </label>
          <button type="submit">Declare conflict</button>
        </form>
        {conflicts.length > 0 && (
          <ul>
            {conflicts.map((c) => (
              <li key={c.id}>
                {c.description}
                {c.mitigation ? ` — mitigation: ${c.mitigation}` : ''} ·{' '}
                <span className="pill">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

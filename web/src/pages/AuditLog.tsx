import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listMyAuditLogs } from '../lib/queries';
import { formatTimestamp, type AuditLog, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

/**
 * Plain-language labels for access-event actions. The raw action is
 * the audit key; the label is what the worker reads.
 */
const ACTION_LABELS: Record<string, string> = {
  grantAccess: 'Access granted to a record',
  revokeConsent: 'Consent revoked — access removed',
  expireConsent: 'Consent expired — access removed',
  createHandoff: 'Handoff offered',
  acceptHandoff: 'Handoff accepted',
  declineHandoff: 'Handoff declined',
  closeHandoff: 'Handoff closed',
  requestExport: 'Data exported',
  requestDeletion: 'Data deleted',
  ensurePerson: 'Person record created',
  createRoleGrant: 'Role grant created',
  'createRoleGrant-needsReview': 'Role grant created — needs review',
  approveRoleGrant: 'Role grant approved',
  denyRoleGrant: 'Role grant denied',
  revokeRoleGrant: 'Role grant revoked',
  requestRoleGrant: 'Role grant requested',
  declareConflict: 'Conflict declared',
};

export default function AuditLog() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WithId<AuditLog>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [actionFilter, setActionFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const logs = await listMyAuditLogs(user.uid);
        logs.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
        setEntries(logs);
      } catch (err) {
        setError(err);
      }
    };
    void load();
  }, [user]);

  const actions = useMemo(
    () => [...new Set(entries.map((e) => e.action))].sort(),
    [entries],
  );

  const visible = entries.filter(
    (e) =>
      (actionFilter === 'all' || e.action === actionFilter) &&
      (resultFilter === 'all' || e.result === resultFilter),
  );

  const granted = entries.filter((e) => e.action === 'grantAccess').length;
  const removed = entries.filter(
    (e) => e.action === 'revokeConsent' || e.action === 'expireConsent',
  ).length;

  return (
    <div>
      <h1>My audit log</h1>
      <div className="gold-rule" />
      <p className="muted">
        Every recorded access to your data, visible to you. You see only your
        own entries — nobody else&apos;s. Each entry names who acted, in what
        acting role, under which grant, for what purpose, with what result,
        and when.
      </p>
      <ErrorNotice error={error} />
      <section className="card">
        <p className="muted">
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · {granted} access grant{granted === 1 ? '' : 's'} ·{' '}
          {removed} access removal{removed === 1 ? '' : 's'} (revoked / expired).
        </p>
        <div className="row">
          <label>
            Action
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
              ))}
            </select>
          </label>
          <label>
            Result
            <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
              <option value="all">All results</option>
              <option value="allowed">Allowed</option>
              <option value="denied">Denied</option>
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="muted">No audit entries match these filters.</p>
        ) : (
          <table data-testid="audit-table">
            <thead><tr><th>When</th><th>What happened</th><th>Resource</th><th>Who</th><th>Acting role</th><th>Grant</th><th>Purpose</th><th>Result</th></tr></thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id}>
                  <td>{formatTimestamp(e.createdAt)}</td>
                  <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td>{e.resourceType}/{e.resourceId}</td>
                  <td>{e.actorId}</td>
                  <td>{e.actingRole}</td>
                  <td>{e.actingGrantId ?? '—'}</td>
                  <td>{e.purpose}</td>
                  <td><span className="pill">{e.result}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

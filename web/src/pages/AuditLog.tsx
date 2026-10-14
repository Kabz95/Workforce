import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listMyAuditLogs } from '../lib/queries';
import { formatTimestamp, type AuditLog, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function AuditLog() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WithId<AuditLog>[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        setEntries(await listMyAuditLogs(user.uid));
      } catch (err) {
        setError(err);
      }
    };
    void load();
  }, [user]);

  return (
    <div>
      <h1>My audit log</h1>
      <div className="gold-rule" />
      <p className="muted">
        Every recorded access to your data, visible to you. You see only your
        own entries — nobody else's.
      </p>
      <ErrorNotice error={error} />
      <section className="card">
        {entries.length === 0 ? (
          <p className="muted">No audit entries yet.</p>
        ) : (
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Resource</th><th>Actor</th><th>Acting role</th><th>Purpose</th><th>Result</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatTimestamp(e.createdAt)}</td>
                  <td>{e.action}</td>
                  <td>{e.resourceType}/{e.resourceId}</td>
                  <td>{e.actorId}</td>
                  <td>{e.actingRole}</td>
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

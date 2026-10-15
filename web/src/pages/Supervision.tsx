import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  createSupervisionSession,
  listMyAssignments,
  listMySupervisionSessions,
  listSharedSupervisionSessions,
} from '../lib/queries';
import {
  formatTimestamp,
  type Assignment,
  type SupervisionSession,
  type WithId,
} from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

/**
 * Supervision — the worker's supervision sessions.
 *
 * Who does what:
 * - The WORKER creates their own session record and names their
 *   supervisor (picked from their active supervisor assignments).
 * - The supervisorId is a LINK, not access: the supervisor reads a
 *   session ONLY through a live worker consent (Consents page).
 * - The worker shares a session with the supervisor from Consents;
 *   revoking that consent ends access immediately.
 */
export default function Supervision() {
  const { user, tenantId, actingRole, actingGrant } = useAuth();
  const [mine, setMine] = useState<WithId<SupervisionSession>[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<WithId<SupervisionSession>[]>([]);
  const [assignments, setAssignments] = useState<WithId<Assignment>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const [supervisorId, setSupervisorId] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');

  const acting = {
    actingGrantId: actingGrant?.id ?? null,
    actingRole,
  };

  // Supervisors the worker is assigned to (picker source).
  const supervisors = assignments.filter(
    (a) => a.role === 'supervisor' && a.workerId === user?.uid && a.status === 'active',
  );

  const load = async () => {
    if (!user) return;
    try {
      const [m, s, a] = await Promise.all([
        listMySupervisionSessions(user.uid, tenantId),
        listSharedSupervisionSessions(user.uid, tenantId),
        listMyAssignments(user.uid, tenantId),
      ]);
      setMine(m);
      setSharedWithMe(s);
      setAssignments(a);
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setNotice('');
    try {
      await createSupervisionSession(
        {
          supervisorId: supervisorId.trim(),
          tenantId,
          notes: notes.trim(),
          dateMs: date ? new Date(date).getTime() : undefined,
        },
        { ...acting, purpose: 'supervision reflection' },
      );
      setNotice('Supervision session recorded. Share it with your supervisor from Consents if you want them to read it.');
      setSupervisorId('');
      setNotes('');
      setDate('');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <h1>Supervision</h1>
      <p>Your supervision sessions. You own these records; your supervisor reads one only when you consent to share it.</p>
      <ErrorNotice error={error} />
      {notice && <p role="status">{notice}</p>}

      {actingRole === 'worker' && (
        <form onSubmit={create}>
          <h2>Record a session</h2>
          <div className="field">
            <label htmlFor="supervisor">Supervisor</label>
            <select
              id="supervisor"
              data-testid="supervision-supervisor"
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value)}
              required
            >
              <option value="">— choose your supervisor —</option>
              {supervisors.map((a) => (
                <option key={a.id} value={a.holderId}>
                  {a.holderId}
                </option>
              ))}
            </select>
            <small>Only supervisors you are assigned to are listed. The supervisor reads this session only through your consent.</small>
          </div>
          <div className="field">
            <label htmlFor="supervision-date">Date</label>
            <input
              id="supervision-date"
              data-testid="supervision-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="supervision-notes">Notes</label>
            <textarea
              id="supervision-notes"
              data-testid="supervision-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </div>
          <button type="submit" data-testid="supervision-create">Record session</button>
        </form>
      )}

      <h2>My sessions</h2>
      {mine.length === 0 && <p>No sessions yet.</p>}
      <ul>
        {mine.map((s) => (
          <li key={s.id} data-testid="supervision-session">
            <strong>{formatTimestamp(s.date)}</strong> — supervisor {s.supervisorId}
            <br />
            {s.notes}
            <br />
            <small>Shared with: {s.sharedWith.length === 0 ? 'nobody' : s.sharedWith.join(', ')}</small>
          </li>
        ))}
      </ul>

      {sharedWithMe.length > 0 && (
        <>
          <h2>Shared with me</h2>
          <ul>
            {sharedWithMe.map((s) => (
              <li key={s.id} data-testid="supervision-shared">
                <strong>{formatTimestamp(s.date)}</strong> — worker {s.ownerId}
                <br />
                {s.notes}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

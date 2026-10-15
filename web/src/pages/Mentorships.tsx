import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  createMentorship,
  listMyAssignments,
  listMyMentorships,
} from '../lib/queries';
import {
  type Assignment,
  type Mentorship,
  type WithId,
} from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

/**
 * Mentorships — the worker's / mentor's mentorship pairs.
 *
 * A mentorship is a pair: exactly two participants, and the creator
 * must be one of them. The other participant must hold a live mentor
 * or worker grant in the hub. Sharing a mentorship with a third party
 * goes through the consent machinery (Consents page); participantIds
 * and tenantId never change after creation.
 */
export default function Mentorships() {
  const { user, tenantId, actingRole, actingGrant } = useAuth();
  const [mentorships, setMentorships] = useState<WithId<Mentorship>[]>([]);
  const [assignments, setAssignments] = useState<WithId<Assignment>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const [otherId, setOtherId] = useState('');
  const [notes, setNotes] = useState('');

  const acting = {
    actingGrantId: actingGrant?.id ?? null,
    actingRole,
  };

  // People I am assigned with (picker source): the other party of any
  // active assignment where I am the worker or the holder.
  const otherParties = new Map<string, string>();
  for (const a of assignments) {
    if (a.status !== 'active') continue;
    if (a.workerId === user?.uid && a.holderId !== user?.uid) {
      otherParties.set(a.holderId, a.role);
    } else if (a.holderId === user?.uid && a.workerId !== user?.uid) {
      otherParties.set(a.workerId, a.role);
    }
  }

  const load = async () => {
    if (!user) return;
    try {
      const [m, a] = await Promise.all([
        listMyMentorships(user.uid, tenantId),
        listMyAssignments(user.uid, tenantId),
      ]);
      setMentorships(m);
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
      await createMentorship(
        {
          participantIds: [user.uid, otherId.trim()],
          tenantId,
          notes: notes.trim(),
        },
        { ...acting, purpose: 'peer mentorship' },
      );
      setNotice('Mentorship created. Share it from Consents if a third party needs to read it.');
      setOtherId('');
      setNotes('');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <h1>Mentorships</h1>
      <p>Your mentorship pairs. Each mentorship has exactly two participants, and you are one of them.</p>
      <ErrorNotice error={error} />
      {notice && <p role="status">{notice}</p>}

      <form onSubmit={create}>
        <h2>Start a mentorship</h2>
        <div className="field">
          <label htmlFor="mentorship-other">Other participant</label>
          <select
            id="mentorship-other"
            data-testid="mentorship-other"
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
            required
          >
            <option value="">— choose the other participant —</option>
            {[...otherParties.entries()].map(([uid, role]) => (
              <option key={uid} value={uid}>
                {uid} ({role})
              </option>
            ))}
          </select>
          <small>Only people you are assigned with are listed. They must hold a live mentor or worker grant in this hub.</small>
        </div>
        <div className="field">
          <label htmlFor="mentorship-notes">Notes</label>
          <textarea
            id="mentorship-notes"
            data-testid="mentorship-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </div>
        <button type="submit" data-testid="mentorship-create">Start mentorship</button>
      </form>

      <h2>My mentorships</h2>
      {mentorships.length === 0 && <p>No mentorships yet.</p>}
      <ul>
        {mentorships.map((m) => (
          <li key={m.id} data-testid="mentorship">
            Participants: {m.participantIds.join(', ')}
            <br />
            {m.notes}
            <br />
            <small>Shared with: {m.sharedWith.length === 0 ? 'nobody' : m.sharedWith.join(', ')}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

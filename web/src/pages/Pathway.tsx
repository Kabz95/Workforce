import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  addPathwayStep,
  deletePathwayStep,
  listMyPathwaySteps,
  listSharedPathwaySteps,
  updatePathwayStep,
} from '../lib/queries';
import { formatTimestamp, type PathwayStep, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

const STEP_TYPES = ['entry', 'induction', 'navigation', 'experience', 'mentorship', 'supervision', 'certification', 'other'];

export default function Pathway() {
  const { user, tenantId, actingRole } = useAuth();
  const [steps, setSteps] = useState<WithId<PathwayStep>[]>([]);
  const [sharedSteps, setSharedSteps] = useState<WithId<PathwayStep>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [type, setType] = useState('entry');
  const [title, setTitle] = useState('');

  const load = async () => {
    if (!user) return;
    try {
      setSteps(await listMyPathwaySteps(user.uid, tenantId));
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);

  // Shared-with-me (navigator / supervisor acting capacities): the
  // SAME query the navigator dashboard uses — steps a worker consented
  // to share with the caller (sharedWith), nothing else. The worker's
  // own view of this page is unchanged.
  const showShared = actingRole === 'navigator' || actingRole === 'supervisor';
  useEffect(() => {
    if (!user || !showShared) return;
    let cancelled = false;
    void listSharedPathwaySteps(user.uid, tenantId)
      .then((s) => {
        if (!cancelled) setSharedSteps(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [user, tenantId, showShared]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setNotice('');
    try {
      await addPathwayStep(user.uid, tenantId, { type, title, status: 'not-started' });
      setTitle('');
      setNotice('Step added.');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const setStatus = async (id: string, status: PathwayStep['status']) => {
    try {
      await updatePathwayStep(id, { status });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this pathway step?')) return;
    try {
      await deletePathwayStep(id);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <h1>Pathway</h1>
      <div className="gold-rule" />
      <p className="muted">
        Your pathway, in your words. Only you see these steps unless you grant
        access to a named navigator or supervisor through Consents.
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      <section className="card">
        <h2>Add a step</h2>
        <form onSubmit={add}>
          <div className="field">
            <label htmlFor="stepType">Type</label>
            <select id="stepType" value={type} onChange={(e) => setType(e.target.value)}>
              {STEP_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="stepTitle">Title</label>
            <input id="stepTitle" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <button type="submit">Add step</button>
        </form>
      </section>

      <section className="card">
        <h2>My steps</h2>
        {steps.length === 0 ? (
          <p className="muted">No steps yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Type</th><th>Title</th><th>Status</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.id}>
                  <td>{s.type}</td>
                  <td>{s.title}</td>
                  <td>
                    <select
                      aria-label={`Status for ${s.title}`}
                      value={s.status}
                      onChange={(e) => setStatus(s.id, e.target.value as PathwayStep['status'])}
                    >
                      <option value="not-started">Not started</option>
                      <option value="in-progress">In progress</option>
                      <option value="done">Done</option>
                      <option value="paused">Paused</option>
                    </select>
                  </td>
                  <td>{formatTimestamp(s.createdAt)}</td>
                  <td>
                    <button type="button" className="danger" onClick={() => remove(s.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showShared && (
        <section className="card" data-testid="shared-with-me">
          <h2>Shared with me</h2>
          <p className="muted">
            Pathway steps workers consented to share with you. Separate from
            your own steps above — read-only, and nothing unshared is visible.
          </p>
          {sharedSteps.length === 0 ? (
            <p className="muted">No pathway steps shared with you yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Type</th><th>Title</th><th>Status</th><th>Worker</th><th>Created</th></tr>
              </thead>
              <tbody>
                {sharedSteps.map((s) => (
                  <tr key={s.id}>
                    <td>{s.type}</td>
                    <td>{s.title}</td>
                    <td><span className="pill">{s.status}</span></td>
                    <td>{s.ownerId}</td>
                    <td>{formatTimestamp(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

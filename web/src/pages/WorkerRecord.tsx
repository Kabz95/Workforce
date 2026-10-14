import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  createForm,
  createWorker,
  deleteForm,
  deleteWorker,
  getDeletionRequest,
  getMyWorker,
  listMyForms,
  processDeletion,
  requestMyDeletion,
  requestMyExport,
  updateForm,
  updateWorker,
} from '../lib/queries';
import { formatTimestamp, type WithId, type FirstContactForm, type Worker } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function WorkerRecord() {
  const { user, tenantId, actingRole, actingGrant } = useAuth();
  const [worker, setWorker] = useState<WithId<Worker> | null>(null);
  const [forms, setForms] = useState<WithId<FirstContactForm>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(false);

  // First-contact form state
  const [contactName, setContactName] = useState('');
  const [contactMethod, setContactMethod] = useState('');
  const [needs, setNeeds] = useState('');
  const [notes, setNotes] = useState('');
  const [editingFormId, setEditingFormId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    try {
      const [w, f] = await Promise.all([getMyWorker(user.uid, tenantId), listMyForms(user.uid, tenantId)]);
      setWorker(w);
      setForms(f);
      if (w) {
        setDisplayName(w.displayName);
        setStatus(w.status);
      }
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);

  const saveWorker = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setNotice('');
    try {
      if (worker) {
        await updateWorker(worker.id, { displayName, status });
        setNotice('Profile saved.');
      } else {
        await createWorker(user.uid, tenantId, displayName, status);
        setNotice('Profile created. This record belongs to you and only you.');
      }
      setEditing(false);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const removeWorker = async () => {
    if (!worker) return;
    if (!window.confirm('Delete your worker profile? This cannot be undone.')) return;
    try {
      await deleteWorker(worker.id);
      setWorker(null);
      setNotice('Profile deleted.');
    } catch (err) {
      setError(err);
    }
  };

  const resetForm = () => {
    setContactName('');
    setContactMethod('');
    setNeeds('');
    setNotes('');
    setEditingFormId(null);
  };

  const saveForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setNotice('');
    try {
      if (editingFormId) {
        await updateForm(editingFormId, { contactName, contactMethod, needs, notes });
        setNotice('First-contact form updated.');
      } else {
        await createForm(user.uid, tenantId, { contactName, contactMethod, needs, notes });
        setNotice('First-contact form saved. You hold a copy; nobody else sees it unless you grant access.');
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const editForm = (f: WithId<FirstContactForm>) => {
    setEditingFormId(f.id);
    setContactName(f.contactName);
    setContactMethod(f.contactMethod);
    setNeeds(f.needs);
    setNotes(f.notes);
  };

  const removeForm = async (id: string) => {
    if (!window.confirm('Delete this first-contact form?')) return;
    try {
      await deleteForm(id);
      setNotice('Form deleted.');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const exportMyData = async () => {
    try {
      const url = await requestMyExport({
        actingGrantId: actingGrant?.id ?? null,
        actingRole,
        purpose: 'export my data',
      });
      setNotice('Export ready — the download link is valid for 7 days.');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err);
    }
  };

  const deleteMyData = async () => {
    if (!window.confirm(
      'Delete ALL of your data? Your records are deleted and shared records are anonymised. This cannot be undone. Export your data first if you want a copy.',
    )) return;
    const typed = window.prompt('Type DELETE to confirm.');
    if (typed !== 'DELETE') {
      setNotice('Deletion cancelled.');
      return;
    }
    try {
      // Job-based deletion: request the job, then advance it pass by
      // pass until it is done. If the window ends first, the hourly
      // sweeper finishes the job — the worker can sign out.
      const job = await requestMyDeletion({
        actingGrantId: actingGrant?.id ?? null,
        actingRole,
        purpose: 'delete my data',
      });
      setNotice(`Deletion started (job ${job.requestId}). Processing…`);
      let attempts = 0;
      while (attempts < 30) {
        attempts += 1;
        const pass = await processDeletion(job.requestId, {
          actingGrantId: actingGrant?.id ?? null,
          actingRole,
          purpose: 'delete my data',
        });
        if (pass.status === 'done') {
          setWorker(null);
          setForms([]);
          setNotice(
            `Your data has been deleted (${pass.deleted} records deleted, ${pass.anonymised} shared records anonymised).` +
            (pass.exportError ? ' Note: the automatic pre-deletion export failed — use Export first next time to keep a copy.' : ''),
          );
          return;
        }
        setNotice(`Deletion in progress… ${pass.processed} records processed.`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      // Window ended: check the job once more, then hand off to the sweeper.
      const current = await getDeletionRequest(job.requestId);
      if (current?.status === 'done') {
        setWorker(null);
        setForms([]);
        setNotice('Your data has been deleted.');
      } else {
        setNotice(
          'Deletion continues in the background — the system finishes it even if you sign out. ' +
          'Your records are being removed; shared records are being anonymised.',
        );
      }
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <h1>My record</h1>
      <div className="gold-rule" />
      <p className="muted">
        Your record belongs to you. Only you can see it unless you grant access
        through Consents. Nothing here is shared with employers.
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      <section className="card">
        <h2>Worker profile</h2>
        {worker && !editing ? (
          <>
            <p><strong>{worker.displayName}</strong> · <span className="pill">{worker.status}</span></p>
            <p className="muted">Created {formatTimestamp(worker.createdAt)} · Updated {formatTimestamp(worker.updatedAt)}</p>
            <div className="row">
              <button type="button" onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="danger" onClick={removeWorker}>Delete profile</button>
            </div>
          </>
        ) : (
          <form onSubmit={saveWorker}>
            <div className="field">
              <label htmlFor="displayName">Display name</label>
              <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="on-leave">On leave</option>
                <option value="paused">Paused</option>
                <option value="alumni">Alumni</option>
              </select>
            </div>
            <div className="row">
              <button type="submit">{worker ? 'Save' : 'Create profile'}</button>
              {worker && (
                <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
              )}
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <h2>My data</h2>
        <p className="muted">
          Export everything the platform holds about you, or delete it entirely.
          Deletion removes your records and anonymises anything shared — it cannot be undone.
        </p>
        <div className="row">
          <button type="button" onClick={exportMyData}>Export my data</button>
          <button type="button" className="danger" onClick={deleteMyData}>Delete all my data</button>
        </div>
      </section>

      <section className="card">
        <h2>First-contact forms</h2>
        <p className="muted">The worker-facing replacement for intake. You hold a copy of every form.</p>
        {forms.length === 0 ? (
          <p className="muted">No first-contact forms yet.</p>
        ) : (
          <ul>
            {forms.map((f) => (
              <li key={f.id}>
                <strong>{f.contactName}</strong> via {f.contactMethod} · {formatTimestamp(f.createdAt)}
                <div className="row">
                  <button type="button" className="secondary" onClick={() => editForm(f)}>Edit</button>
                  <button type="button" className="danger" onClick={() => removeForm(f.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <h3>{editingFormId ? 'Edit form' : 'New first-contact form'}</h3>
        <form onSubmit={saveForm}>
          <div className="field">
            <label htmlFor="contactName">Contact name</label>
            <input id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="contactMethod">Preferred contact method</label>
            <input id="contactMethod" value={contactMethod} onChange={(e) => setContactMethod(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="needs">Needs / what would help</label>
            <textarea id="needs" value={needs} onChange={(e) => setNeeds(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="notes">Notes (private to you)</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="row">
            <button type="submit">{editingFormId ? 'Save changes' : 'Save form'}</button>
            {editingFormId && (
              <button type="button" className="secondary" onClick={resetForm}>Cancel</button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  createEmployer,
  getMyEmployer,
  listMyReadiness,
  submitReadiness,
} from '../lib/queries';
import { formatTimestamp, type Employer, type ReadinessAssessment, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

const QUESTIONS = [
  { key: 'roleClarity', label: 'Role clarity: is the peer role defined in its own terms, not as a junior clinical role?' },
  { key: 'supervision', label: 'Supervision: is supervision peer-informed and separate from performance management?' },
  { key: 'pay', label: 'Pay: is pay at or above the indexed floor for peer work in your region?' },
  { key: 'coDesign', label: 'Co-design: do peer workers shape the program, not only deliver it?' },
  { key: 'boundaries', label: 'Boundaries: can a worker decline a task that conflicts with peer practice without penalty?' },
];

export default function EmployerReadiness() {
  const { user, tenantId } = useAuth();
  const [employer, setEmployer] = useState<WithId<Employer> | null>(null);
  const [assessments, setAssessments] = useState<WithId<ReadinessAssessment>[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [orgName, setOrgName] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = async () => {
    if (!user) return;
    try {
      const e = await getMyEmployer(user.uid, tenantId);
      setEmployer(e);
      if (e) setAssessments(await listMyReadiness(e.id, tenantId));
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
    try {
      await createEmployer(user.uid, tenantId, orgName);
      setNotice('Employer profile created.');
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!employer) return;
    setError(null);
    setNotice('');
    try {
      // Gate outcome is a self-assessment summary, not a verdict:
      // count of "yes" answers. Governance reviews, it does not rubber-stamp.
      const yesCount = QUESTIONS.filter((q) => answers[q.key] === 'yes').length;
      const gateOutcome =
        yesCount === QUESTIONS.length
          ? 'self-assessed-ready'
          : yesCount >= 3
            ? 'self-assessed-partial'
            : 'self-assessed-not-ready';
      await submitReadiness(employer.id, tenantId, answers, gateOutcome);
      setNotice(`Assessment submitted. Self-assessed outcome: ${gateOutcome}.`);
      setAnswers({});
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <h1>Employer readiness</h1>
      <div className="gold-rule" />
      <p className="muted">
        A readiness self-assessment for employers. This assesses the
        organisation — never individual workers. Worker data is not visible here.
      </p>
      <ErrorNotice error={error} />
      {notice && <div className="notice success">{notice}</div>}

      {!employer ? (
        <section className="card">
          <h2>Create employer profile</h2>
          <form onSubmit={create}>
            <div className="field">
              <label htmlFor="orgName">Organisation name</label>
              <input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            </div>
            <button type="submit">Create profile</button>
          </form>
        </section>
      ) : (
        <>
          <section className="card">
            <h2>{employer.orgName}</h2>
            <p className="muted">Employer profile · created {formatTimestamp(employer.createdAt)}</p>
          </section>
          <section className="card">
            <h2>Readiness self-assessment</h2>
            <form onSubmit={submit}>
              {QUESTIONS.map((q) => (
                <div className="field" key={q.key}>
                  <label>{q.label}</label>
                  <select
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
                    required
                  >
                    <option value="" disabled>Choose…</option>
                    <option value="yes">Yes</option>
                    <option value="partial">Partially</option>
                    <option value="no">No</option>
                  </select>
                </div>
              ))}
              <button type="submit">Submit assessment</button>
            </form>
          </section>
          <section className="card">
            <h2>Past assessments</h2>
            {assessments.length === 0 ? (
              <p className="muted">No assessments yet.</p>
            ) : (
              <table>
                <thead><tr><th>Outcome</th><th>Answers</th></tr></thead>
                <tbody>
                  {assessments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.gateOutcome}</td>
                      <td>{Object.entries(a.answers).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  getMyEmployer,
  listApplicationsForEmployer,
  listMyReadiness,
  listOpportunities,
} from '../../lib/queries';
import {
  type Employer,
  type Opportunity,
  type OpportunityApplication,
  type ReadinessAssessment,
  type WithId,
} from '../../lib/types';
import { registerAbortController } from '../../lib/roleState';
import ErrorNotice from '../ErrorNotice';

/**
 * Employer dashboard summary — informational widgets only.
 *
 * Everything here is the employer's OWN data, read through the same
 * queries the Readiness and Opportunities pages already use: own
 * profile, own readiness assessments, own postings, and the
 * applications to those postings grouped by status. Applicants are
 * counted, never identified beyond what the Opportunities page
 * already shows. There is deliberately no posting-creation control
 * here (or anywhere in the employer UI yet).
 */
export default function EmployerDashboard() {
  const { user, tenantId } = useAuth();
  const [employer, setEmployer] = useState<WithId<Employer> | null>(null);
  const [assessments, setAssessments] = useState<WithId<ReadinessAssessment>[]>([]);
  const [postings, setPostings] = useState<WithId<Opportunity>[]>([]);
  const [applications, setApplications] = useState<WithId<OpportunityApplication>[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const unregister = registerAbortController(controller);
    let cancelled = false;
    const load = async () => {
      try {
        const emp = await getMyEmployer(user.uid, tenantId);
        if (cancelled || controller.signal.aborted) return;
        setEmployer(emp);
        // Employer-owned reads (readiness assessments, opportunity
        // applications) are keyed by the owner's USER UID in
        // firestore.rules: readiness create/list and application
        // get/list/update all require employerId == uid(). The
        // /readiness and /opportunities pages pass the employer
        // document id instead, which those rules can never
        // satisfy — a pre-existing defect in the shipped employer
        // flows, flagged in the build report and not fixed here
        // (this dashboard is read-only). These widgets follow the
        // enforceable uid convention.
        const results = await Promise.allSettled([
          listMyReadiness(user.uid, tenantId),
          listOpportunities(tenantId),
          listApplicationsForEmployer(user.uid, tenantId),
        ]);
        if (cancelled || controller.signal.aborted) return;
        const [r, o, a] = results.map((x) => (x.status === 'fulfilled' ? x.value : []));
        setAssessments((r as WithId<ReadinessAssessment>[]) ?? []);
        const allOpps = (o as WithId<Opportunity>[]) ?? [];
        // Own postings: opportunities carry employerId — the employer
        // document id in the Opportunities page's convention, or the
        // owner uid under the rules' create shape. Match either so
        // the count is the employer's own under both conventions.
        setPostings(
          allOpps.filter((opp) => opp.employerId === emp?.id || opp.employerId === user.uid),
        );
        setApplications((a as WithId<OpportunityApplication>[]) ?? []);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    void load();
    return () => {
      cancelled = true;
      unregister();
    };
  }, [user, tenantId]);

  const latest = assessments.length > 0 ? assessments[assessments.length - 1] : null;
  const byStatus = new Map<string, number>();
  for (const a of applications) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);

  return (
    <div className="dashboard" data-testid="employer-dashboard">
      <ErrorNotice error={error} />

      <section className="card">
        <h2>Your organisation</h2>
        {!loaded ? (
          <p className="muted">Loading…</p>
        ) : employer ? (
          <p>
            <strong>{employer.orgName}</strong> · employer profile for this hub
          </p>
        ) : (
          <p className="muted">
            No employer profile yet. Create one on the readiness page to
            complete a self-assessment and receive applications.
          </p>
        )}
        <p><Link to="/readiness">Employer readiness self-assessment →</Link></p>
      </section>

      <section className="card">
        <h2>Readiness</h2>
        {latest ? (
          <p>
            Latest self-assessment: <span className="pill">{latest.gateOutcome}</span> ·{' '}
            {assessments.length} assessment{assessments.length === 1 ? '' : 's'} submitted
          </p>
        ) : (
          <p className="muted">No readiness assessment submitted yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Your postings ({postings.length})</h2>
        {postings.length === 0 ? (
          <p className="muted">No postings under your organisation yet.</p>
        ) : (
          <ul>
            {postings.slice(0, 5).map((o) => (
              <li key={o.id}>
                <strong>{o.title}</strong> · {o.location}
              </li>
            ))}
          </ul>
        )}
        <p><Link to="/opportunities">Postings and applications →</Link></p>
      </section>

      <section className="card">
        <h2>Applications by status ({applications.length})</h2>
        {applications.length === 0 ? (
          <p className="muted">No applications to your postings yet.</p>
        ) : (
          <ul>
            {[...byStatus.entries()].map(([status, count]) => (
              <li key={status}>
                {status}: {count}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Employers see only the application itself — applicant records are
          never exposed.
        </p>
      </section>
    </div>
  );
}

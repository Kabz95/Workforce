import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listAggregateReleases, listAggregates } from '../lib/queries';
import { formatTimestamp, type Aggregate, type AggregateRelease, type WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

/** Roles that see the release records: the intelligence + governance
 *  roles whose charters cover aggregate publication (the manifest's
 *  "every release is recorded: what was published, what was
 *  suppressed, and why"). Hub roles keep the aggregates table only. */
const RELEASE_ROLES = ['analyst', 'council', 'backboneLead', 'researcher'];

export default function Aggregates() {
  const { tenantId, actingRole } = useAuth();
  const [rows, setRows] = useState<WithId<Aggregate>[]>([]);
  const [releases, setReleases] = useState<WithId<AggregateRelease>[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setRows(await listAggregates(tenantId));
      } catch (err) {
        setError(err);
      }
    };
    void load();
  }, [tenantId]);

  useEffect(() => {
    if (!actingRole || !RELEASE_ROLES.includes(actingRole)) return;
    const load = async () => {
      try {
        setReleases(await listAggregateReleases(tenantId));
      } catch (err) {
        setError(err);
      }
    };
    void load();
  }, [tenantId, actingRole]);

  return (
    <div>
      <h1>Workforce aggregates</h1>
      <div className="gold-rule" />
      <p className="muted">
        De-identified aggregates only. No raw records ever reach this view —
        the backbone sees counts and distributions, never people.
      </p>
      <ErrorNotice error={error} />
      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">No aggregates published yet for this hub.</p>
        ) : (
          <table>
            <thead><tr><th>Metric</th><th>Period</th><th>Value</th><th>Breakdown</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.metric}</td>
                  <td>{a.period}</td>
                  <td>{a.value}</td>
                  <td>{Object.entries(a.breakdown).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {actingRole && RELEASE_ROLES.includes(actingRole) && (
        <section className="card" data-testid="aggregate-releases">
          <h2>Releases</h2>
          <p className="muted">
            Release records written by the server when aggregates are
            computed: what was published, what was suppressed at the
            minimum-cell floor, and when. Read-only — releases are
            server-authored; there is no release action here.
          </p>
          {releases.length === 0 ? (
            <p className="muted">No release records yet for this hub.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Period</th>
                  <th>Published</th>
                  <th>Suppressed</th>
                  <th>Min cell</th>
                  <th>Released</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.id}>
                    <td>{r.metric}</td>
                    <td>{r.period}</td>
                    <td>{r.published}</td>
                    <td>{r.suppressed}</td>
                    <td>{r.minCell}</td>
                    <td>{formatTimestamp(r.releasedAt)}</td>
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

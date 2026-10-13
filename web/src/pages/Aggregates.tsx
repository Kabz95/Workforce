import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listAggregates } from '../lib/queries';
import type { Aggregate, WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function Aggregates() {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<WithId<Aggregate>[]>([]);
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
    </div>
  );
}

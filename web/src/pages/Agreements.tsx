import { useState, useEffect } from 'react';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { listMyAgreements, createAgreement, updateAgreement } from '../lib/queries';
import type { CircularAgreement, WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function Agreements() {
  const { user, tenantId } = useAuth();
  const { activeRole } = useRole();

  const [agreements, setAgreements] = useState<WithId<CircularAgreement>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [type, setType] = useState<CircularAgreement['type']>('mentorship');
  const [partnerId, setPartnerId] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [terms, setTerms] = useState('');
  const [reviewDays, setReviewDays] = useState(90);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchAgreements = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listMyAgreements(user.uid, tenantId);
        if (!cancelled) setAgreements(data);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchAgreements();
    return () => {
      cancelled = true;
    };
  }, [user, tenantId]);

  const handleCreateAgreement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim() || submitting) return;

    setSubmitting(true);
    try {
      const now = new Date();
      const reviewDate = new Date();
      reviewDate.setDate(now.getDate() + Number(reviewDays));

      const untilDate = new Date();
      untilDate.setDate(now.getDate() + 365); // 1 year term default

      const participantIds = [user.uid];
      if (partnerId.trim()) participantIds.push(partnerId.trim());

      const participantNames = [user.displayName || user.email || 'You'];
      if (partnerName.trim()) participantNames.push(partnerName.trim());

      await createAgreement({
        title: title.trim(),
        type,
        participantIds,
        participantNames,
        tenantId,
        status: 'active',
        terms: terms.trim() || 'Mutual peer commitments to role integrity and reflective practice.',
        reviewDate: Timestamp.fromDate(reviewDate),
        effectiveFrom: Timestamp.fromDate(now),
        effectiveUntil: Timestamp.fromDate(untilDate),
      });

      setShowCreateModal(false);
      setTitle('');
      setPartnerId('');
      setPartnerName('');
      setTerms('');

      // Refresh list
      const refreshed = await listMyAgreements(user.uid, tenantId);
      setAgreements(refreshed);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteAgreement = async (id: string) => {
    try {
      await updateAgreement(id, { status: 'completed' });
      setAgreements((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'completed' } : a))
      );
    } catch (err) {
      setError(err);
    }
  };

  const filtered = agreements.filter((a) => {
    if (filterStatus === 'all') return true;
    return a.status === filterStatus;
  });

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.5rem 0', color: 'var(--navy)' }}>Circular Cohesion Agreements</h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.95rem' }}>
            Reciprocal practice, supervision, and mentorship commitments held between peers without employer hierarchy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="btn"
        >
          + Propose New Agreement
        </button>
      </div>

      <ErrorNotice error={error} />

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {['all', 'active', 'in-review', 'completed'].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setFilterStatus(st)}
            className={`btn-ghost ${filterStatus === st ? 'active' : ''}`}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '20px',
              border: filterStatus === st ? '2px solid var(--navy)' : '1px solid var(--border)',
              background: filterStatus === st ? 'var(--navy)' : '#fff',
              color: filterStatus === st ? '#fff' : 'var(--ink)',
              fontWeight: 600,
              fontSize: '0.85rem',
            }}
          >
            {st.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Agreements Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          Loading your circular agreements...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            No circular agreements found matching this filter.
          </p>
          <button type="button" onClick={() => setShowCreateModal(true)} className="btn">
            Create First Agreement
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem' }}>
          {filtered.map((agr) => {
            const reviewStr = agr.reviewDate
              ? agr.reviewDate.toDate().toLocaleDateString()
              : 'Ongoing';
            const untilStr = agr.effectiveUntil
              ? agr.effectiveUntil.toDate().toLocaleDateString()
              : '1 Year';

            return (
              <div key={agr.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span className="pill" style={{ background: '#e0e7ff', color: '#3730a3', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      {agr.type}
                    </span>
                    <span className={`pill ${agr.status === 'active' ? 'live' : ''}`}>
                      {agr.status}
                    </span>
                  </div>

                  <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--navy)', fontSize: '1.15rem' }}>
                    {agr.title}
                  </h3>

                  <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                    Participants: <strong>{agr.participantNames?.join(' · ') || 'Peers'}</strong>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--ink)', marginBottom: '0.75rem' }}>
                    {agr.terms}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    <span>Next Review: <strong>{reviewStr}</strong></span>
                    <span>Valid Until: <strong>{untilStr}</strong></span>
                  </div>

                  {agr.status === 'active' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => handleCompleteAgreement(agr.id)}
                        className="btn-outline"
                        style={{ flex: 1, fontSize: '0.85rem', padding: '0.35rem' }}
                      >
                        Conclude Gracefully
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Propose Agreement Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--navy)' }}>
                Propose Circular Cohesion Agreement
              </h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="btn-outline">✕</button>
            </div>

            <form onSubmit={handleCreateAgreement} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Agreement Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Bi-Weekly Reflective Supervision Practice"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Agreement Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as CircularAgreement['type'])}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                  >
                    <option value="mentorship">Mentorship</option>
                    <option value="supervision">Practice Supervision</option>
                    <option value="cop">Community of Practice</option>
                    <option value="hubCommitment">Hub Capacity Commitment</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Review Interval (Days)</label>
                  <select
                    value={reviewDays}
                    onChange={(e) => setReviewDays(Number(e.target.value))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                  >
                    <option value={30}>30 Days</option>
                    <option value={60}>60 Days</option>
                    <option value={90}>90 Days (Recommended)</option>
                    <option value={180}>180 Days</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Partner Peer / Colleague Name</label>
                <input
                  type="text"
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                  placeholder="e.g. Jordan River (Navigator / Peer)"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Partner UID (Optional)</label>
                <input
                  type="text"
                  value={partnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                  placeholder="Partner's UID (if known)"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Mutual Commitments & Boundaries</label>
                <textarea
                  rows={4}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Describe agreed meeting frequency, reflective goals, and confidentiality boundaries..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-outline">Cancel</button>
                <button type="submit" disabled={submitting} className="btn">
                  {submitting ? 'Creating...' : 'Confirm Mutual Agreement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

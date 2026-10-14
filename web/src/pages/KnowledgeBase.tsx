import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { listHelpArticles, createHelpArticle } from '../lib/queries';
import type { HelpArticle, WithId } from '../lib/types';
import ErrorNotice from '../components/ErrorNotice';

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { activeRole } = useRole();

  const [articles, setArticles] = useState<WithId<HelpArticle>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedAudience, setSelectedAudience] = useState<string>('all');
  const [activeArticle, setActiveArticle] = useState<WithId<HelpArticle> | null>(null);

  // New Article Proposal State (Governance / Privacy Lead)
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<HelpArticle['category']>('roles');
  const [newAudience, setNewAudience] = useState<HelpArticle['audience']>('all');
  const [newJurisdiction, setNewJurisdiction] = useState<HelpArticle['jurisdiction']>('national');
  const [newVersion, setNewVersion] = useState('1.0.0');

  const canAuthor = activeRole === 'steeringCircle' || activeRole === 'council' || activeRole === 'privacyLead' || activeRole === 'hubCoordinator';

  useEffect(() => {
    let cancelled = false;
    const fetchArticles = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listHelpArticles(
          selectedCategory === 'all' ? undefined : selectedCategory,
          selectedAudience === 'all' ? undefined : selectedAudience
        );
        if (!cancelled) setArticles(data);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchArticles();
    return () => {
      cancelled = true;
    };
  }, [selectedCategory, selectedAudience]);

  const filteredArticles = articles.filter((art) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      art.title.toLowerCase().includes(q) ||
      art.summary.toLowerCase().includes(q) ||
      art.content.toLowerCase().includes(q) ||
      art.tags?.some((t) => t.toLowerCase().includes(q))
    );
  });

  const handleProposeArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim() || submitting) return;

    setSubmitting(true);
    try {
      await createHelpArticle({
        title: newTitle.trim(),
        summary: newSummary.trim() || newTitle.trim(),
        content: newContent.trim(),
        category: newCategory,
        audience: newAudience,
        jurisdiction: newJurisdiction,
        version: newVersion,
        status: 'published',
        authorCircle: `${activeRole.toUpperCase()} circle authoring`,
        tags: [newCategory, newAudience, newJurisdiction],
      });

      setShowSubmitModal(false);
      setNewTitle('');
      setNewSummary('');
      setNewContent('');

      // Refresh list
      const refreshed = await listHelpArticles(
        selectedCategory === 'all' ? undefined : selectedCategory,
        selectedAudience === 'all' ? undefined : selectedAudience
      );
      setArticles(refreshed);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.5rem 0', color: 'var(--navy)' }}>Public Knowledge & Standards Explorer</h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.95rem' }}>
            Authoritative, citation-grounded public charters, boundary matrices, and Law 25 compliance procedures.
          </p>
        </div>
        {canAuthor && (
          <button
            type="button"
            onClick={() => setShowSubmitModal(true)}
            className="btn"
          >
            + Propose Knowledge Article
          </button>
        )}
      </div>

      <ErrorNotice error={error} />

      {/* Filter and Search Bar */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 300px' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search charters, Law 25 rules, error codes, supervision boundaries..."
              style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: '0.95rem' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--muted)' }}>Category:</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{ padding: '0.45rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
            >
              <option value="all">All Categories</option>
              <option value="roles">Roles & Charters</option>
              <option value="governance">Governance & Law 25</option>
              <option value="pathway">Pathway & Navigation</option>
              <option value="supervision">Practice Supervision</option>
              <option value="practice">Mentorship & Practice</option>
              <option value="learning">Communities of Practice</option>
              <option value="safeguarding">Safeguarding & Crisis</option>
              <option value="technical">Error Codes & Technical</option>
            </select>

            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--muted)', marginLeft: '0.5rem' }}>Audience:</span>
            <select
              value={selectedAudience}
              onChange={(e) => setSelectedAudience(e.target.value)}
              style={{ padding: '0.45rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
            >
              <option value="all">All Audiences</option>
              <option value="worker">Workers</option>
              <option value="supervisor">Supervisors</option>
              <option value="mentor">Mentors</option>
              <option value="facilitator">Facilitators</option>
              <option value="navigator">Navigators</option>
              <option value="privacyLead">Privacy Leads</option>
              <option value="employer">Employers</option>
            </select>
          </div>
        </div>
      </div>

      {/* Article Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          Loading public help corpus...
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="muted">No knowledge articles match the current filter or query.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {filteredArticles.map((art) => (
            <div
              key={art.id}
              className="card"
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', cursor: 'pointer', transition: 'border-color 0.2s', border: '1px solid var(--border)' }}
              onClick={() => setActiveArticle(art)}
            >
              <div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <span className="pill" style={{ background: '#e0e7ff', color: '#3730a3', fontSize: '0.75rem' }}>
                    {art.category}
                  </span>
                  <span className="pill" style={{ background: '#fef3c7', color: '#92400e', fontSize: '0.75rem' }}>
                    v{art.version}
                  </span>
                  {art.jurisdiction === 'qc' && (
                    <span className="pill" style={{ background: '#dbeafe', color: '#1e40af', fontSize: '0.75rem' }}>
                      Quebec (Law 25)
                    </span>
                  )}
                  <span className="pill" style={{ fontSize: '0.75rem' }}>
                    for: {art.audience}
                  </span>
                </div>

                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: 'var(--navy)' }}>
                  {art.title}
                </h3>
                <p className="muted" style={{ fontSize: '0.88rem', lineHeight: 1.5 }}>
                  {art.summary}
                </p>
              </div>

              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Author: {art.authorCircle || 'National Circle'}
                </span>
                <span style={{ color: 'var(--navy)', fontWeight: 600, fontSize: '0.85rem' }}>
                  Read Article →
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Article Reader Modal */}
      {activeArticle && (
        <div className="modal-backdrop" onClick={() => setActiveArticle(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '780px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <span className="pill">{activeArticle.category}</span>
                  <span className="pill">v{activeArticle.version}</span>
                  <span className="pill">Audience: {activeArticle.audience}</span>
                  <span className="pill" style={{ background: '#dcfce7', color: '#166534' }}>Verified Grounding</span>
                </div>
                <h2 style={{ margin: 0, color: 'var(--navy)', fontSize: '1.35rem' }}>
                  {activeArticle.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveArticle(null)}
                className="btn-outline"
                style={{ padding: '0.2rem 0.5rem' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '6px', borderLeft: '4px solid var(--navy)', marginBottom: '1.25rem', fontSize: '0.9rem', color: 'var(--ink)' }}>
              <strong>Summary:</strong> {activeArticle.summary}
            </div>

            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.95rem', color: 'var(--ink)' }}>
              {activeArticle.content}
            </div>

            <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--muted)' }}>
              <div>
                Provenance: <strong>{activeArticle.authorCircle || 'National Steering Circle'}</strong> · Jurisdiction: <code>{activeArticle.jurisdiction}</code>
              </div>
              <button
                type="button"
                onClick={() => setActiveArticle(null)}
                className="btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Propose Article Modal */}
      {showSubmitModal && (
        <div className="modal-backdrop" onClick={() => setShowSubmitModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--navy)' }}>Propose Knowledge Article</h2>
              <button type="button" onClick={() => setShowSubmitModal(false)} className="btn-outline">✕</button>
            </div>

            <form onSubmit={handleProposeArticle} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Facilitator Guidelines for Trauma-Informed Circles"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as HelpArticle['category'])}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                  >
                    <option value="roles">Roles</option>
                    <option value="governance">Governance</option>
                    <option value="pathway">Pathway</option>
                    <option value="supervision">Supervision</option>
                    <option value="practice">Practice</option>
                    <option value="learning">Learning</option>
                    <option value="safeguarding">Safeguarding</option>
                    <option value="technical">Technical</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Audience</label>
                  <select
                    value={newAudience}
                    onChange={(e) => setNewAudience(e.target.value as HelpArticle['audience'])}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                  >
                    <option value="all">All Audiences</option>
                    <option value="worker">Worker</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="mentor">Mentor</option>
                    <option value="facilitator">Facilitator</option>
                    <option value="navigator">Navigator</option>
                    <option value="privacyLead">Privacy Lead</option>
                    <option value="employer">Employer</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Jurisdiction</label>
                  <select
                    value={newJurisdiction}
                    onChange={(e) => setNewJurisdiction(e.target.value as HelpArticle['jurisdiction'])}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                  >
                    <option value="national">National</option>
                    <option value="qc">Quebec (Law 25)</option>
                    <option value="on">Ontario</option>
                    <option value="bc">British Columbia</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Summary</label>
                <input
                  type="text"
                  required
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="One or two sentences explaining the scope and purpose."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Article Content (Markdown)</label>
                <textarea
                  required
                  rows={8}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Write the full authoritative guidelines, boundary rules, and procedures..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowSubmitModal(false)} className="btn-outline">Cancel</button>
                <button type="submit" disabled={submitting} className="btn">
                  {submitting ? 'Publishing...' : 'Publish to Help Corpus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

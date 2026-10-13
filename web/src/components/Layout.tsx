import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../lib/types';

const NAV: { to: string; label: string; roles?: Role[] }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/record', label: 'My Record', roles: ['worker', 'navigator', 'supervisor'] },
  { to: '/pathway', label: 'Pathway', roles: ['worker', 'navigator'] },
  { to: '/consents', label: 'Consents', roles: ['worker'] },
  { to: '/readiness', label: 'Employer Readiness', roles: ['employer', 'hubAdmin'] },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/governance', label: 'Governance' },
  { to: '/aggregates', label: 'Aggregates', roles: ['backboneAnalyst', 'governance'] },
  { to: '/audit', label: 'My Audit Log' },
];

export default function Layout() {
  const { user, roles, tenantId, signOut } = useAuth();
  const navigate = useNavigate();

  const visible = NAV.filter((item) => {
    if (!item.roles) return true;
    return item.roles.some((r) => roles.includes(r));
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Link to="/">Peer Support Workforce Network</Link>
        </div>
        {user && (
          <nav>
            {visible.map((item) => (
              <Link key={item.to} to={item.to}>{item.label}</Link>
            ))}
          </nav>
        )}
        <div className="userbox">
          {user ? (
            <>
              <span>{user.email}</span>
              {roles.map((r) => (
                <span key={r} className="role-badge">{r}</span>
              ))}
              <span className="pill">hub: {tenantId}</span>
              <button type="button" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <Link to="/login" style={{ color: '#fff' }}>Sign in</Link>
          )}
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        Worker-controlled records. No surveillance. Aggregates only, upward.
      </footer>
    </div>
  );
}

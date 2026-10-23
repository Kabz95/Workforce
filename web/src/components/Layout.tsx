import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { AnyRole } from '../lib/types';
import ActingRoleIndicator from './ActingRoleIndicator';
import ActingRoleSwitcher from './ActingRoleSwitcher';
import ThemeSwitcher from './ThemeSwitcher';

const NAV: { to: string; label: string; roles?: AnyRole[] }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/record', label: 'My Record', roles: ['worker', 'navigator', 'supervisor', 'mentor'] },
  { to: '/pathway', label: 'Pathway', roles: ['worker', 'navigator', 'supervisor'] },
  { to: '/consents', label: 'Consents', roles: ['worker'] },
  { to: '/handoffs', label: 'Handoffs', roles: ['worker', 'navigator', 'hubCoordinator', 'supervisor', 'mentor'] },
  { to: '/supervision', label: 'Supervision', roles: ['worker', 'supervisor'] },
  { to: '/mentorships', label: 'Mentorships', roles: ['worker', 'mentor'] },
  { to: '/readiness', label: 'Employer Readiness', roles: ['employer', 'hubCoordinator'] },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/governance', label: 'Governance' },
  { to: '/aggregates', label: 'Aggregates', roles: ['analyst', 'steeringCircle', 'council', 'backboneLead', 'hubCoordinator', 'privacyLead', 'researcher'] },
  { to: '/membership', label: 'Membership & Grants', roles: ['hubCoordinator', 'steeringCircle', 'council', 'backboneLead', 'privacyLead'] },
  { to: '/audit', label: 'My Audit Log' },
  { to: '/grants', label: 'My Roles & Grants' },
  { to: '/support', label: 'Support' },
];

// One expressive texture per view (index.css `.main.view-*`): the route
// slug selects the view class. Unknown paths get the base grid texture.
function viewClass(pathname: string): string {
  const slug = pathname.replace(/^\//, '').replace(/[^a-z0-9-]/g, '') || 'dashboard';
  return `view-${slug}`;
}

export default function Layout() {
  const { user, actingRole, tenantId, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Navigation follows the ACTING capacity, not the held roles.
  const visible = NAV.filter((item) => {
    if (!item.roles) return true;
    if (!actingRole) return false;
    return item.roles.includes(actingRole);
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <Link to="/">Peer Support Workforce Network</Link>
        </div>
        {user && (
          <nav aria-label="Primary">
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="userbox">
          {user ? (
            <>
              <span className="user-email">{user.email}</span>
              <span className="pill">hub: {tenantId}</span>
              <ThemeSwitcher />
              <button type="button" data-testid="sign-out" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <>
              <ThemeSwitcher />
              <Link to="/login">Sign in</Link>
            </>
          )}
        </div>
      </header>
      {user && (
        <>
          <ActingRoleIndicator />
          <ActingRoleSwitcher />
        </>
      )}
      <main className={`main ${viewClass(location.pathname)}`}>
        <Outlet />
      </main>
      <footer className="footer">
        <span>Worker-controlled records. No surveillance. Aggregates only, upward.</span>
        <span className="footer-stamp">WORKFORCE / VISUAL SYSTEM / 2026 · WF-DS 0.1</span>
      </footer>
    </div>
  );
}

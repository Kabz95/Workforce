import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { AnyRole } from '../lib/types';
import ActingRoleIndicator from './ActingRoleIndicator';
import ActingRoleSwitcher from './ActingRoleSwitcher';

const NAV: { to: string; label: string; roles?: AnyRole[] }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/record', label: 'My Record', roles: ['worker', 'navigator', 'supervisor'] },
  { to: '/pathway', label: 'Pathway', roles: ['worker', 'navigator'] },
  { to: '/consents', label: 'Consents', roles: ['worker'] },
  { to: '/handoffs', label: 'Handoffs', roles: ['worker', 'navigator', 'hubCoordinator', 'supervisor', 'mentor'] },
  { to: '/supervision', label: 'Supervision', roles: ['worker', 'supervisor'] },
  { to: '/mentorships', label: 'Mentorships', roles: ['worker', 'mentor'] },
  { to: '/readiness', label: 'Employer Readiness', roles: ['employer', 'hubCoordinator'] },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/governance', label: 'Governance' },
  { to: '/aggregates', label: 'Aggregates', roles: ['analyst', 'steeringCircle', 'council', 'backboneLead', 'hubCoordinator', 'privacyLead'] },
  { to: '/audit', label: 'My Audit Log' },
  { to: '/grants', label: 'My Roles & Grants' },
  { to: '/support', label: 'Support' },
];

export default function Layout() {
  const { user, actingRole, tenantId, signOut } = useAuth();
  const navigate = useNavigate();

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
              <span className="pill">hub: {tenantId}</span>
              <button type="button" data-testid="sign-out" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <Link to="/login" style={{ color: '#fff' }}>Sign in</Link>
          )}
        </div>
      </header>
      {user && (
        <>
          <ActingRoleIndicator />
          <ActingRoleSwitcher />
        </>
      )}
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        Worker-controlled records. No surveillance. Aggregates only, upward.
      </footer>
    </div>
  );
}

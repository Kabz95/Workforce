import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import RoleSwitcher from './RoleSwitcher';
import type { Role, CanonicalRoleId } from '../lib/types';
import { mapLegacyRole } from '../lib/roleCatalog';
import SupportAssistant from './SupportAssistant';

const NAV: { to: string; label: string; roles?: (Role | CanonicalRoleId)[] }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/record', label: 'My Record', roles: ['worker', 'navigator', 'supervisor'] },
  { to: '/pathway', label: 'Pathway', roles: ['worker', 'navigator'] },
  { to: '/agreements', label: 'Agreements' },
  { to: '/consents', label: 'Consents', roles: ['worker', 'privacyLead'] },
  { to: '/knowledge', label: 'Knowledge Base' },
  { to: '/readiness', label: 'Employer Readiness', roles: ['employer', 'hubCoordinator', 'hubAdmin'] },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/governance', label: 'Governance' },
  { to: '/aggregates', label: 'Aggregates', roles: ['analyst', 'backboneAnalyst', 'steeringCircle', 'council', 'governance'] },
  { to: '/audit', label: 'My Audit Log' },
];

export default function Layout() {
  const { user, tenantId, signOut } = useAuth();
  const { activeRole, heldGrants } = useRole();
  const navigate = useNavigate();

  const visible = NAV.filter((item) => {
    if (!item.roles) return true;
    const allowed = item.roles.map((r) => mapLegacyRole(r as string));
    // Item is visible if current acting role or any held grant has permission
    return allowed.includes(activeRole) || heldGrants.some((g) => allowed.includes(g.role));
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
              <RoleSwitcher />
              <span>{user.email}</span>
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
      <SupportAssistant />
    </div>
  );
}

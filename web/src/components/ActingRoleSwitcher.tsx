import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, grantIsLiveClient } from '../context/AuthContext';
import { getManifest } from '../lib/manifests';
import { ROLE_LABELS, type AnyRole } from '../lib/types';

/**
 * Acting-capacity switcher.
 * Lists ONLY the roles the person holds (live grants, or claims during
 * the migration fallback). Sensitive transitions (employer, privacy,
 * governance, research, operational) show the boundary reminder and
 * require explicit confirmation. On switch, role-scoped state is
 * cleared first (AuthContext.switchActingRole → roleState.ts) and the
 * view returns to the dashboard — closing whatever role-specific view
 * was open.
 */
export default function ActingRoleSwitcher() {
  const { roles, grants, actingRole, switchActingRole } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<AnyRole | null>(null);

  // Held roles: live grants when the server answered, else claims.
  const held: AnyRole[] = grants.length > 0
    ? [...new Set(grants.filter((g) => grantIsLiveClient(g)).map((g) => g.role))]
    : roles;

  if (held.length <= 1) return null;

  const handleSelect = (role: AnyRole) => {
    if (role === actingRole) return;
    const manifest = getManifest(role);
    if (manifest.sensitive && manifest.boundaryReminder) {
      setPending(role);
      return;
    }
    switchActingRole(role);
    navigate('/');
  };

  const confirmSwitch = () => {
    if (!pending) return;
    switchActingRole(pending);
    setPending(null);
    navigate('/');
  };

  return (
    <div className="acting-switcher">
      <label htmlFor="acting-role-select">Acting as</label>
      <select
        id="acting-role-select"
        value={actingRole ?? ''}
        onChange={(e) => handleSelect(e.target.value as AnyRole)}
      >
        {held.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      {pending && (
        <div className="notice" role="alert">
          <p>
            <strong>Switch to {ROLE_LABELS[pending]}?</strong>
          </p>
          <p>{getManifest(pending).boundaryReminder}</p>
          <button type="button" onClick={confirmSwitch}>
            Yes, switch — I understand the boundary
          </button>{' '}
          <button type="button" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

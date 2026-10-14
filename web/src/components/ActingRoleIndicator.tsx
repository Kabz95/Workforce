import { useAuth } from '../context/AuthContext';
import { getManifest } from '../lib/manifests';
import { ROLE_LABELS } from '../lib/types';

/**
 * Always-visible acting-role indicator.
 * Shows the acting capacity, its scope, and the audit stamp:
 * every action is recorded with this role.
 */
export default function ActingRoleIndicator() {
  const { actingRole, actingGrant, grantsSource, tenantId } = useAuth();

  if (!actingRole) {
    return (
      <div className="notice error" role="status">
        No acting capacity. Your roles could not be verified — you can view
        public pages only until your grants load.
      </div>
    );
  }

  const manifest = getManifest(actingRole);
  const scope = actingGrant
    ? `${actingGrant.scopeType}:${actingGrant.scopeId}`
    : 'claims fallback (server verification pending)';

  return (
    <div className="acting-indicator" role="status">
      <span>
        Acting as: <strong>{ROLE_LABELS[actingRole]}</strong>
        {' '}· Scope: <strong>{scope}</strong>
        {' '}· Hub: {tenantId}
      </span>
      <span className="muted">
        Every action is recorded with this role.
        {grantsSource === 'claims-fallback' && ' · Grants unverified — claims fallback.'}
      </span>
      <span className="muted" title={manifest.purpose}>
        {manifest.purpose}
      </span>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import type { Role, CanonicalRoleId } from '../lib/types';
import { mapLegacyRole } from '../lib/roleCatalog';

export default function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: (Role | CanonicalRoleId)[];
}) {
  const { user, loading: authLoading } = useAuth();
  const { heldGrants, loading: roleLoading } = useRole();

  if (authLoading || roleLoading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;

  if (roles && roles.length > 0) {
    const canonicalAllowed = roles.map((r) => mapLegacyRole(r as string));
    const holdsRequiredGrant = heldGrants.some((g) => canonicalAllowed.includes(g.role));
    if (!holdsRequiredGrant) {
      return (
        <div className="notice error">
          Access denied. Your account does not hold an active grant for this capability.
        </div>
      );
    }
  }

  return <>{children}</>;
}

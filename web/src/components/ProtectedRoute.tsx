import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { AnyRole } from '../lib/types';
import { ROLE_LABELS } from '../lib/types';

/**
 * Route guard bound to the ACTING capacity, not to held roles.
 * A person who holds a role but is acting in another capacity cannot
 * open that role's pages by deep link — the guard re-checks the
 * acting role on every navigation.
 * Fail-closed: no acting capacity → no access.
 */
export default function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: AnyRole[];
}) {
  const { user, actingRole, loading } = useAuth();

  if (loading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (!actingRole) {
    return (
      <div className="notice error">
        Access denied. No acting capacity could be verified for this session.
      </div>
    );
  }
  if (roles && roles.length > 0 && !roles.includes(actingRole)) {
    return (
      <div className="notice error">
        Access denied. This page requires acting as{' '}
        {roles.map((r) => ROLE_LABELS[r]).join(' or ')}. You are acting as{' '}
        {ROLE_LABELS[actingRole]}. Use the acting-capacity switcher to change
        capacity, if you hold that role.
      </div>
    );
  }
  return <>{children}</>;
}

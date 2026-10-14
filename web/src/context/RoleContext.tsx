import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import {
  type CanonicalRoleId,
  type RoleGrant,
  type WithId,
} from '../lib/types';
import { ROLE_CATALOG, mapLegacyRole, type EnrichedRoleCatalogEntry } from '../lib/roleCatalog';

const SESSION_ROLE_KEY = 'peer_workforce_active_role';

export interface RoleContextValue {
  activeRole: CanonicalRoleId;
  activeGrant: WithId<RoleGrant> | null;
  heldGrants: WithId<RoleGrant>[];
  catalogEntry: EnrichedRoleCatalogEntry;
  switchRole: (role: CanonicalRoleId) => Promise<boolean>;
  isSensitiveTransition: boolean;
  clearSensitiveModal: () => void;
  pendingSensitiveRole: CanonicalRoleId | null;
  confirmSensitiveSwitch: () => void;
  cancelSensitiveSwitch: () => void;
  loading: boolean;
  error: string | null;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, roles: legacyRoles, tenantId } = useAuth();
  const [heldGrants, setHeldGrants] = useState<WithId<RoleGrant>[]>([]);
  const [activeRole, setActiveRole] = useState<CanonicalRoleId>('worker');
  const [activeGrant, setActiveGrant] = useState<WithId<RoleGrant> | null>(null);
  const [pendingSensitiveRole, setPendingSensitiveRole] = useState<CanonicalRoleId | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load verified active grants for current user
  useEffect(() => {
    if (!user) {
      setHeldGrants([]);
      setActiveGrant(null);
      setActiveRole('worker');
      sessionStorage.removeItem(SESSION_ROLE_KEY);
      setLoading(false);
      return;
    }

    const currentUid = user.uid;
    let isSubscribed = true;

    async function fetchGrants() {
      setLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, 'roleGrants'),
          where('authUid', '==', currentUid),
          where('status', '==', 'active'),
        );
        const snap = await getDocs(q);
        const now = Timestamp.now();
        const validGrants: WithId<RoleGrant>[] = [];

        snap.forEach((d) => {
          const g = d.data() as RoleGrant;
          // Fail-closed expiry check
          if (g.term && g.term.validUntil && g.term.validUntil.toMillis() > now.toMillis()) {
            validGrants.push({ id: d.id, ...g });
          }
        });

        // Dual-read migration support: If no Firestore grants yet, map from legacy claims/profile
        if (validGrants.length === 0 && legacyRoles && legacyRoles.length > 0) {
          legacyRoles.forEach((r, idx) => {
            const canonical = mapLegacyRole(r, tenantId === 'national' ? 'national' : undefined);
            validGrants.push({
              id: `claim-grant-${idx}-${canonical}`,
              personId: currentUid,
              authUid: currentUid,
              role: canonical,
              circle: canonical === 'council' || canonical === 'backboneLead' ? 'national' : 'hub',
              jurisdictionScope: tenantId || 'demo-hub',
              term: {
                validFrom: now,
                validUntil: new Timestamp(now.seconds + 86400 * 365, 0),
              },
              authorizedBy: 'bootstrap-migration',
              status: 'active',
              createdAt: now,
              updatedAt: now,
            });
          });
        }

        if (!isSubscribed) return;

        setHeldGrants(validGrants);

        // Determine active role from session storage preference
        const storedRole = sessionStorage.getItem(SESSION_ROLE_KEY) as CanonicalRoleId | null;
        const grantForStored = storedRole ? validGrants.find((g) => g.role === storedRole) : null;

        if (grantForStored) {
          setActiveRole(storedRole!);
          setActiveGrant(grantForStored);
        } else {
          // Default: 'worker' if held, otherwise first held grant or 'worker'
          const workerGrant = validGrants.find((g) => g.role === 'worker');
          if (workerGrant) {
            setActiveRole('worker');
            setActiveGrant(workerGrant);
            sessionStorage.setItem(SESSION_ROLE_KEY, 'worker');
          } else if (validGrants.length > 0) {
            setActiveRole(validGrants[0].role);
            setActiveGrant(validGrants[0]);
            sessionStorage.setItem(SESSION_ROLE_KEY, validGrants[0].role);
          } else {
            setActiveRole('worker');
            setActiveGrant(null);
            sessionStorage.removeItem(SESSION_ROLE_KEY);
          }
        }
      } catch (err) {
        console.warn('Error loading role grants (using claim fallback):', err);
        // Fallback gracefully on claim mapping
        if (isSubscribed && legacyRoles) {
          const fallbackRole = mapLegacyRole(legacyRoles[0] || 'worker');
          setActiveRole(fallbackRole);
        }
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    void fetchGrants();

    return () => {
      isSubscribed = false;
    };
  }, [user, legacyRoles, tenantId]);

  // Execute role switch and clear role-scoped states
  const executeRoleSwitch = useCallback(
    (targetRole: CanonicalRoleId) => {
      const grant = heldGrants.find((g) => g.role === targetRole);
      if (!grant) {
        setError(`You do not hold an active grant for role: ${targetRole}`);
        return false;
      }

      // Check expiry (fail closed)
      const now = Timestamp.now();
      if (grant.term && grant.term.validUntil && grant.term.validUntil.toMillis() <= now.toMillis()) {
        setError(`Your grant for role "${targetRole}" has expired. Returning to default role.`);
        return false;
      }

      // 1. Scoped state cleanup on switch:
      // Invalidate caches & notify components of role switch event
      window.dispatchEvent(new CustomEvent('workforce:role-switch', { detail: { from: activeRole, to: targetRole } }));

      // 2. Persist in session only
      sessionStorage.setItem(SESSION_ROLE_KEY, targetRole);
      setActiveRole(targetRole);
      setActiveGrant(grant);
      setError(null);
      setPendingSensitiveRole(null);
      return true;
    },
    [heldGrants, activeRole],
  );

  const switchRole = useCallback(
    async (targetRole: CanonicalRoleId): Promise<boolean> => {
      if (targetRole === activeRole) return true;

      const targetEntry = ROLE_CATALOG[targetRole];
      if (targetEntry?.isSensitive) {
        // Trigger boundary reminder modal for sensitive transition
        setPendingSensitiveRole(targetRole);
        return false;
      }

      return executeRoleSwitch(targetRole);
    },
    [activeRole, executeRoleSwitch],
  );

  const confirmSensitiveSwitch = useCallback(() => {
    if (pendingSensitiveRole) {
      executeRoleSwitch(pendingSensitiveRole);
    }
  }, [pendingSensitiveRole, executeRoleSwitch]);

  const cancelSensitiveSwitch = useCallback(() => {
    setPendingSensitiveRole(null);
  }, []);

  const clearSensitiveModal = useCallback(() => {
    setPendingSensitiveRole(null);
  }, []);

  const catalogEntry = ROLE_CATALOG[activeRole] || ROLE_CATALOG.worker;

  return (
    <RoleContext.Provider
      value={{
        activeRole,
        activeGrant,
        heldGrants,
        catalogEntry,
        switchRole,
        isSensitiveTransition: Boolean(pendingSensitiveRole),
        pendingSensitiveRole,
        confirmSensitiveSwitch,
        cancelSensitiveSwitch,
        clearSensitiveModal,
        loading,
        error,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error('useRole must be used within a RoleProvider');
  }
  return ctx;
}

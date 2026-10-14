import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../lib/firebase';
import type { AnyRole, RoleGrant, Role } from '../lib/types';
import { ROLE_DEFAULT_ORDER, canonicalRole, toMillis } from '../lib/types';
import { clearRoleScopedState } from '../lib/roleState';

/** Client-side live check: active AND inside the validity window.
 *  Fail-closed: an expired grant never becomes an acting capacity,
 *  even if its status field still reads 'active'. */
export function grantIsLiveClient(grant: RoleGrant, nowMs: number = Date.now()): boolean {
  if (grant.status !== 'active') return false;
  const from = toMillis(grant.validFrom);
  if (from !== null && from > nowMs) return false;
  const until = toMillis(grant.validUntil);
  if (until !== null && nowMs > until) return false;
  return true;
}

/**
 * Auth + acting capacity.
 *
 * - `roles` = canonical roles from custom claims (display + fallback).
 * - `grants` = live role grants from the server (getMyGrants). The
 *   server is the enforcement point; the client never trusts its own
 *   claims for consequential actions.
 * - `actingRole` / `actingGrant` = the current acting capacity.
 *   SESSION-ONLY: held in React state, never localStorage. Default:
 *   worker if held, else least-privileged held role. Switching clears
 *   all role-scoped state first (see roleState.ts).
 * - `grantsSource`: 'grants' when the server answered, 'claims-fallback'
 *   when it did not (migration / offline). Fail-closed: an expired or
 *   suspended grant never becomes an acting capacity; a grant-load
 *   failure falls back to claims for display only, and every
 *   consequential command still verifies server-side.
 */

export interface AuthState {
  user: User | null;
  roles: AnyRole[];
  grants: (RoleGrant & { id: string })[];
  actingRole: AnyRole | null;
  actingGrant: (RoleGrant & { id: string }) | null;
  grantsSource: 'grants' | 'claims-fallback' | null;
  tenantId: string;
  loading: boolean;
  grantsLoading: boolean;
  switchActingRole: (role: AnyRole) => void;
  refreshGrants: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEFAULT_TENANT = 'demo-hub';
const DEFAULT_ROLE: Role = 'worker';

const getMyGrantsFn = httpsCallable(functions, 'getMyGrants');

/** Pick the default acting role from held roles: worker if held, else least-privileged. */
export function defaultActingRole(roles: AnyRole[]): AnyRole | null {
  for (const candidate of ROLE_DEFAULT_ORDER) {
    if (roles.includes(candidate)) return candidate;
  }
  return roles.length > 0 ? roles[0] : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AnyRole[]>([]);
  const [grants, setGrants] = useState<(RoleGrant & { id: string })[]>([]);
  const [actingRole, setActingRole] = useState<AnyRole | null>(null);
  const [grantsSource, setGrantsSource] = useState<'grants' | 'claims-fallback' | null>(null);
  const [tenantId, setTenantId] = useState<string>(DEFAULT_TENANT);
  const [loading, setLoading] = useState(true);
  const [grantsLoading, setGrantsLoading] = useState(false);

  const refreshGrants = async (uid?: string) => {
    const targetUid = uid ?? user?.uid;
    if (!targetUid) return;
    setGrantsLoading(true);
    try {
      const result = await getMyGrantsFn({});
      const payload = result.data as {
        grants: (RoleGrant & { id: string })[];
        defaultGrantId?: string | null;
      };
      const serverGrants = payload.grants ?? [];
      setGrants(serverGrants);
      setGrantsSource('grants');
      // Fail-closed: if the current acting grant is gone / not live,
      // drop back to the server's default acting grant.
      setActingRole((current) => {
        if (!current) return current;
        const stillLive = serverGrants.some(
          (g) => g.role === current && grantIsLiveClient(g),
        );
        if (stillLive) return current;
        const defaultGrant = serverGrants.find((g) => g.id === payload.defaultGrantId);
        if (defaultGrant && grantIsLiveClient(defaultGrant)) return defaultGrant.role;
        const liveRoles = serverGrants.filter((g) => grantIsLiveClient(g)).map((g) => g.role);
        return defaultActingRole(liveRoles.length > 0 ? liveRoles : roles);
      });
    } catch {
      // Server unreachable: claims fallback for display. Consequential
      // commands still verify server-side, so a stale client cannot act.
      setGrantsSource('claims-fallback');
    } finally {
      setGrantsLoading(false);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const token = await u.getIdTokenResult();
          const claims = token.claims as { role?: string; roles?: string[]; tenantId?: string };
          const rawRoles: string[] = Array.isArray(claims.roles)
            ? claims.roles
            : claims.role
              ? [claims.role]
              : [];
          // Canonicalise: legacy claim roles map to their replacements.
          const claimedRoles: AnyRole[] = rawRoles
            .map((r) => canonicalRole(r))
            .filter((r): r is AnyRole => r !== null);
          const effectiveRoles = claimedRoles.length > 0 ? claimedRoles : [DEFAULT_ROLE];
          setRoles(effectiveRoles);
          setTenantId(
            typeof claims.tenantId === 'string' && claims.tenantId.length > 0
              ? claims.tenantId
              : DEFAULT_TENANT,
          );
          // Default acting capacity: worker if held, else least-privileged.
          setActingRole(defaultActingRole(effectiveRoles));
          // Load live grants (server is the enforcement point).
          setGrantsLoading(true);
          try {
            const result = await getMyGrantsFn({});
            const payload = result.data as {
              grants: (RoleGrant & { id: string })[];
              defaultGrantId?: string | null;
            };
            const serverGrants = payload.grants ?? [];
            setGrants(serverGrants);
            setGrantsSource('grants');
            const defaultGrant = serverGrants.find((g) => g.id === payload.defaultGrantId);
            if (defaultGrant && grantIsLiveClient(defaultGrant)) {
              setActingRole(defaultGrant.role);
            } else {
              const liveRoles = serverGrants.filter((g) => grantIsLiveClient(g)).map((g) => g.role);
              if (liveRoles.length > 0) {
                setActingRole(defaultActingRole(liveRoles));
              }
            }
          } catch {
            setGrantsSource('claims-fallback');
          } finally {
            setGrantsLoading(false);
          }
        } catch {
          setRoles([DEFAULT_ROLE]);
          setTenantId(DEFAULT_TENANT);
          setActingRole(DEFAULT_ROLE);
          setGrantsSource('claims-fallback');
        }
      } else {
        setRoles([]);
        setGrants([]);
        setActingRole(null);
        setGrantsSource(null);
        setTenantId(DEFAULT_TENANT);
      }
      setLoading(false);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actingGrant = useMemo(() => {
    if (!actingRole) return null;
    return grants.find((g) => g.role === actingRole && grantIsLiveClient(g)) ?? null;
  }, [actingRole, grants]);

  /** Switch acting capacity: clear role-scoped state FIRST, then set. */
  const switchActingRole = (role: AnyRole) => {
    // Only roles the person actually holds (live grants) may be switched into.
    const held = grants.length > 0
      ? grants.filter((g) => grantIsLiveClient(g)).map((g) => g.role)
      : roles;
    if (!held.includes(role)) return;
    clearRoleScopedState();
    setActingRole(role);
  };

  const signIn = async (email: string, password: string): Promise<void> => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName: string): Promise<void> => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Create the users/{uid} profile doc. Roles/tenant come from custom claims
    // in production; the doc carries the same defaults for emulator dev.
    await setDoc(doc(db, 'users', cred.user.uid), {
      displayName,
      email,
      tenantId: DEFAULT_TENANT,
      roles: [DEFAULT_ROLE],
      createdAt: new Date(),
    });
  };

  const signInGoogle = async (): Promise<void> => {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    await setDoc(
      doc(db, 'users', cred.user.uid),
      {
        displayName: cred.user.displayName ?? '',
        email: cred.user.email ?? '',
        tenantId: DEFAULT_TENANT,
        roles: [DEFAULT_ROLE],
      },
      { merge: true },
    );
  };

  const doSignOut = async (): Promise<void> => {
    clearRoleScopedState();
    setGrants([]);
    setActingRole(null);
    setGrantsSource(null);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        roles,
        grants,
        actingRole,
        actingGrant,
        grantsSource,
        tenantId,
        loading,
        grantsLoading,
        switchActingRole,
        refreshGrants: () => refreshGrants(),
        signIn,
        signUp,
        signInGoogle,
        signOut: doSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function hasRole(roles: AnyRole[], role: AnyRole): boolean {
  return roles.includes(role);
}

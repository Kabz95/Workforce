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
  updateProfile,
  type User,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';
import type { AnyRole, RoleGrant } from '../lib/types';
import { ROLE_DEFAULT_ORDER, canonicalRole, toMillis } from '../lib/types';
import { clearRoleScopedState } from '../lib/roleState';
import { ensureMyPerson } from '../lib/queries';

/**
 * Persons docs already ensured this page session (one attempt per
 * account per load). ensureMyPerson is idempotent server-side, but
 * there is no reason to call it on every auth-state flicker.
 */
const personsEnsured = new Set<string>();

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
 * After sign-in/up: claim any pending invitation (server-side,
 * best-effort — the auth-state listener also attempts it), then
 * refuse the session when the account holds no live grant. A bare
 * account (no invitation) gets a clear message and is signed out,
 * instead of landing on a broken dashboard.
 */
async function requireLiveGrantOrRefuse(): Promise<void> {
  try {
    await ensureMyPerson();
  } catch {
    // Transient claim failure: fall through to the grants check.
    // A user with existing grants still passes; a new user retries
    // via sign-in, which re-attempts the claim.
  }
  const result = await getMyGrantsFn({});
  const payload = result.data as { grants: (RoleGrant & { id: string })[] };
  const hasLive = (payload.grants ?? []).some((g) => grantIsLiveClient(g));
  if (!hasLive) {
    await signOut(auth);
    throw new Error(NO_INVITATION_MESSAGE);
  }
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

/**
 * Production onboarding: no demo defaults. A user with no claims and
 * no grants has NO roles and NO tenant (bare record) — never a
 * default worker capacity in a default hub. Fail-closed: no live
 * grant → no acting capacity → ProtectedRoute denies access.
 */
const getMyGrantsFn = httpsCallable(functions, 'getMyGrants');

const NO_INVITATION_MESSAGE =
  'No active invitation or role grant for this account. Ask your organisation to invite you.';

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
  const [tenantId, setTenantId] = useState<string>('');
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
        // Ensure the caller's persons doc exists (server-side, exactly
        // once). Fire-and-forget: a failure here must never block
        // sign-in — the doc is not needed to render the session.
        if (!personsEnsured.has(u.uid)) {
          personsEnsured.add(u.uid);
          void ensureMyPerson().catch(() => {
            // The persons doc will be retried on the next page load.
          });
        }
        try {
          const token = await u.getIdTokenResult();
          const claims = token.claims as { role?: string; roles?: string[]; tenantId?: string };
          const rawRoles: string[] = Array.isArray(claims.roles)
            ? claims.roles
            : claims.role
              ? [claims.role]
              : [];
          // Canonicalise: legacy claim roles map to their replacements.
          // No fallback: a user with no claims has no roles (bare
          // record) — never a default worker capacity.
          const claimedRoles: AnyRole[] = rawRoles
            .map((r) => canonicalRole(r))
            .filter((r): r is AnyRole => r !== null);
          const effectiveRoles = claimedRoles;
          setRoles(effectiveRoles);
          setTenantId(
            typeof claims.tenantId === 'string' && claims.tenantId.length > 0
              ? claims.tenantId
              : '',
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
          // No claims readable: bare record — no roles, no tenant.
          setRoles([]);
          setTenantId('');
          setActingRole(null);
          setGrantsSource('claims-fallback');
        }
      } else {
        setRoles([]);
        setGrants([]);
        setActingRole(null);
        setGrantsSource(null);
        setTenantId('');
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
    await requireLiveGrantOrRefuse();
  };

  const signUp = async (email: string, password: string, displayName: string): Promise<void> => {
    // Production onboarding: the Auth account is created, then the
    // server claims any pending invitation for this email. There is
    // NO client-created users/persons doc (the rules deny it) and
    // NO default worker role. If no live grant results, the session
    // is refused with the no-invitation message.
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
    await requireLiveGrantOrRefuse();
  };

  const signInGoogle = async (): Promise<void> => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    await requireLiveGrantOrRefuse();
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

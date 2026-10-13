import {
  createContext,
  useContext,
  useEffect,
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
import { auth, db } from '../lib/firebase';
import type { Role } from '../lib/types';

export interface AuthState {
  user: User | null;
  roles: Role[];
  tenantId: string;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEFAULT_TENANT = 'demo-hub';
const DEFAULT_ROLE: Role = 'worker';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [tenantId, setTenantId] = useState<string>(DEFAULT_TENANT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const token = await u.getIdTokenResult();
          const claims = token.claims as { role?: string; roles?: string[]; tenantId?: string };
          const claimedRoles: Role[] = Array.isArray(claims.roles)
            ? (claims.roles as Role[])
            : claims.role
              ? [claims.role as Role]
              : [];
          // Local emulator dev: no custom claims yet → default worker/demo-hub.
          setRoles(claimedRoles.length > 0 ? claimedRoles : [DEFAULT_ROLE]);
          setTenantId(
            typeof claims.tenantId === 'string' && claims.tenantId.length > 0
              ? claims.tenantId
              : DEFAULT_TENANT,
          );
        } catch {
          setRoles([DEFAULT_ROLE]);
          setTenantId(DEFAULT_TENANT);
        }
      } else {
        setRoles([]);
        setTenantId(DEFAULT_TENANT);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

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
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, roles, tenantId, loading, signIn, signUp, signInGoogle, signOut: doSignOut }}
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

export function hasRole(roles: Role[], role: Role): boolean {
  return roles.includes(role);
}

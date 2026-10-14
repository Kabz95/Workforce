/**
 * Playwright globalSetup: seed the EMULATOR stack for the Phase 2
 * walkthrough, then write the test accounts to web/e2e/.e2e-users.json
 * (gitignored) for the spec to read.
 *
 * Seeding mirrors functions/test/callable.test.mjs `makeUser`: an Auth
 * user + custom claims (roles + tenantId) + a live roleGrants doc +
 * persons + users docs. The gateway resolves grants, not claims, so
 * the roleGrants doc is what lets each seeded user act.
 *
 * EMULATOR ONLY. This file never touches the live project: it talks
 * to firebase-admin pointed at FIRESTORE_EMULATOR_HOST /
 * FIREBASE_AUTH_EMULATOR_HOST, and fails fast if the emulators are
 * not up. Passwords below are test-only ('Test1234!') for disposable
 * emulator accounts — never real credentials.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const PROJECT = process.env.FIREBASE_PROJECT || 'demo-workforce';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const HUB = 'hub-1';
const RUN = `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Test1234!';

type Role = 'worker' | 'navigator' | 'hubCoordinator';

interface SeededUser {
  uid: string;
  email: string;
  password: string;
  role: Role;
}

async function probeEmulators(): Promise<void> {
  const res = await fetch(`http://${FIRESTORE_HOST}/`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Firestore emulator unreachable (${res.status})`);
  }
  const authRes = await fetch(`http://${AUTH_HOST}/`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!authRes) throw new Error(`Auth emulator unreachable at ${AUTH_HOST}`);
}

async function seedUser(
  auth: admin.auth.Auth,
  db: admin.firestore.Firestore,
  role: Role,
): Promise<SeededUser> {
  const email = `${RUN}-${role}@example.test`;
  const user = await auth.createUser({ email, password: PASSWORD });
  await auth.setCustomUserClaims(user.uid, { roles: [role], tenantId: HUB });
  // Live grant: the gateway resolves grants, not claims.
  await db.collection('roleGrants').add({
    granteeId: user.uid,
    role,
    scopeType: role === 'worker' ? 'self' : 'hub',
    scopeId: role === 'worker' ? user.uid : HUB,
    tenantId: HUB,
    status: 'active',
    validFrom: new Date(Date.now() - 1000),
    validUntil: null,
    grantedBy: 'e2e-seed',
    basis: 'playwright-e2e',
    needsReview: false,
  });
  await db.collection('persons').doc(user.uid).set({
    displayName: `E2E ${role}`,
    email,
    tenantId: HUB,
  });
  await db.collection('users').doc(user.uid).set({
    displayName: `E2E ${role}`,
    email,
    tenantId: HUB,
    roles: [role],
  });
  return { uid: user.uid, email, password: PASSWORD, role };
}

export default async function globalSetup(): Promise<void> {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  await probeEmulators().catch((err: Error) => {
    throw new Error(
      `${err.message}\n` +
        'Start the emulators first: firebase emulators:start --project demo-workforce --only auth,firestore,functions',
    );
  });
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: PROJECT });
  }
  const db = admin.firestore();
  const auth = admin.auth();

  const worker = await seedUser(auth, db, 'worker');
  const navigator = await seedUser(auth, db, 'navigator');
  const coordinator = await seedUser(auth, db, 'hubCoordinator');

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '.e2e-users.json');
  writeFileSync(
    outPath,
    JSON.stringify({ run: RUN, hub: HUB, users: { worker, navigator, coordinator } }, null, 2),
  );
  console.log(`[e2e seed] run=${RUN} worker=${worker.uid} navigator=${navigator.uid} coordinator=${coordinator.uid}`);
}

/**
 * Playwright globalSetup: seed PENDING invitations into the EMULATOR
 * stack for the walkthrough, then write the test accounts to
 * web/e2e/.e2e-users.json (gitignored) for the spec to read.
 *
 * Production onboarding: the setup seeds ONLY pending roleGrants —
 * no Auth users, no custom claims, no persons/users docs. Each spec
 * run signs UP via the invitation-gated UI (helpers.signUp), which
 * exercises the real claim path (ensureMyPerson): the invitation is
 * claimed on first sign-in, and the uid is resolved afterwards via
 * getUidByEmail. The test users are then ordinary accounts with
 * claimed grants, exactly like production.
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

interface InvitedUser {
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

  // Seed emails are built from the lowercased role slug: production stores
  // granteeEmail lowercased and the claim query lowercases the sign-in
  // email, and Firestore string equality is case-sensitive — a mixed-case
  // seed email (e.g. hubCoordinator) would never match the claim query.
  const makeUser = (role: Role): InvitedUser => ({
    email: `${RUN}-${role.toLowerCase()}@example.test`,
    password: PASSWORD,
    role,
  });
  const users: Record<Role, InvitedUser> = {
    worker: makeUser('worker'),
    navigator: makeUser('navigator'),
    hubCoordinator: makeUser('hubCoordinator'),
  };

  for (const role of Object.keys(users) as Role[]) {
    const user = users[role];
    // Wipe leftovers from a previous run (emulator restarts clear
    // state anyway; this keeps re-runs against a warm emulator safe).
    try {
      const existing = await auth.getUserByEmail(user.email);
      await auth.deleteUser(existing.uid);
    } catch {
      /* no such Auth user — expected: signup happens in the spec */
    }
    const stale = await db
      .collection('roleGrants')
      .where('granteeEmail', '==', user.email)
      .get();
    for (const doc of stale.docs) await doc.ref.delete();

    // Pending invitation (production inviteMember shape). The worker
    // gets a self-scoped grant; navigator + coordinator get hub scope.
    await db.collection('roleGrants').add({
      granteeEmail: user.email,
      granteeId: '',
      role,
      scopeType: role === 'worker' ? 'self' : 'hub',
      scopeId: role === 'worker' ? user.email : HUB,
      tenantId: HUB,
      status: 'pending',
      validFrom: new Date(Date.now() - 1000),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      grantedBy: 'e2e-seed',
      basis: 'playwright-e2e',
      needsReview: false,
    });
  }

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '.e2e-users.json');
  writeFileSync(
    outPath,
    JSON.stringify({ run: RUN, hub: HUB, users }, null, 2),
  );
  console.log(`[e2e seed] run=${RUN} — seeded 3 pending invitations`);
}

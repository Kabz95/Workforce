/**
 * Shared helpers for the Phase 2 walkthrough spec.
 *
 * Two kinds of help:
 * - UI helpers (signIn / signOut / screenshots) drive the real app
 *   through Playwright locators. No fixed sleeps: Playwright's
 *   auto-waiting + expect polling do the synchronising.
 * - Server-state helpers read Firestore through firebase-admin
 *   pointed at the EMULATORS (project demo-workforce). They assert
 *   what the UI cannot show directly: sharedWith contents, audit
 *   events, and post-deletion state. Emulator only, test data only.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo } from '@playwright/test';
import admin from 'firebase-admin';

const PROJECT = process.env.FIREBASE_PROJECT || 'demo-workforce';

export interface SeededUser {
  /** Assigned at signup (the invitation claim), NOT at seeding:
   *  globalSetup seeds pending invitations only. Resolve it after
   *  signUp with getUidByEmail. */
  uid?: string;
  email: string;
  password: string;
  role: string;
}

export interface SeedFile {
  run: string;
  hub: string;
  users: {
    worker: SeededUser;
    navigator: SeededUser;
    hubCoordinator: SeededUser;
    // Phase 3 wave 1 (dashboards-wave1.spec.ts).
    supervisor: SeededUser;
    mentor: SeededUser;
    privacyLead: SeededUser;
  };
}

/** Read the seed file written by globalSetup. Fails fast if the file is
 *  missing or a seeded user is absent/malformed, so a writer/reader drift
 *  surfaces here instead of as an undefined-property TypeError mid-test. */
export function loadSeed(): SeedFile {
  const path = join(dirname(fileURLToPath(import.meta.url)), '.e2e-users.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    throw new Error(
      'Missing web/e2e/.e2e-users.json — globalSetup did not run. ' +
        'Run the spec via `npm run test:e2e` (Playwright runs globalSetup first).',
    );
  }
  const users = (parsed as { users?: Record<string, unknown> }).users;
  for (const key of ['worker', 'navigator', 'hubCoordinator', 'supervisor', 'mentor', 'privacyLead'] as const) {
    const user = users?.[key] as { email?: unknown; password?: unknown; role?: unknown } | undefined;
    if (!user || typeof user.email !== 'string' || typeof user.password !== 'string' || user.role !== key) {
      throw new Error(
        `Malformed web/e2e/.e2e-users.json — expected users.${key} with matching role. ` +
          'Re-run globalSetup via `npm run test:e2e`.',
      );
    }
  }
  return parsed as SeedFile;
}

// --- Admin SDK against the emulators (singleton) ---

let db: admin.firestore.Firestore | null = null;

export function adminDb(): admin.firestore.Firestore {
  if (!db) {
    // Point the Admin SDK at the emulators BEFORE initializing: if
    // these vars are unset it would reach the real Firestore.
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST =
      process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: PROJECT });
    }
    db = admin.firestore();
  }
  return db;
}

async function poll<T>(fn: () => Promise<T>, until: (v: T) => boolean, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    last = await fn();
    if (until(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for: ${what} (last: ${JSON.stringify(last)})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Seed a pending invitation (production inviteMember shape) for an email. */
export async function seedPendingInvitation(
  email: string,
  role: string,
  tenantId = 'hub-1',
): Promise<string> {
  const ref = await adminDb().collection('roleGrants').add({
    granteeEmail: email,
    granteeId: '',
    role,
    scopeType: role === 'worker' ? 'self' : 'hub',
    scopeId: role === 'worker' ? email : tenantId,
    tenantId,
    status: 'pending',
    validFrom: new Date(Date.now() - 1000),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    grantedBy: 'e2e-seed',
    basis: 'playwright-e2e',
    needsReview: false,
  });
  return ref.id;
}

/** Seed an active assignment (Admin SDK — assignments are server-written). */
export async function seedAssignment(
  workerUid: string,
  holderUid: string,
  role: 'mentor' | 'navigator' | 'supervisor' | 'facilitator',
  tenantId = 'hub-1',
): Promise<string> {
  const ref = await adminDb().collection('assignments').add({
    workerId: workerUid,
    holderId: holderUid,
    role,
    tenantId,
    status: 'active',
    startedAt: new Date(),
    endedAt: null,
  });
  return ref.id;
}

/** Resolve a signed-up user's uid: the persons doc id for their email (polls: the claim lands async). */
export async function getUidByEmail(email: string, timeoutMs = 15_000): Promise<string> {
  const store = adminDb();
  const snap = await poll(
    () => store.collection('persons').where('email', '==', email).get(),
    (s) => !s.empty,
    timeoutMs,
    `persons doc for ${email}`,
  );
  return snap.docs[0].id;
}

/** Poll until the invitation for this email is claimed (status active, granteeId set). */
export async function waitForClaim(email: string, timeoutMs = 15_000): Promise<void> {
  const store = adminDb();
  await poll(
    () => store.collection('roleGrants').where('granteeEmail', '==', email).where('status', '==', 'active').get(),
    (s) => !s.empty,
    timeoutMs,
    `active claimed grant for ${email}`,
  );
}
export async function getFormIdByContactName(ownerUid: string, contactName: string): Promise<string> {
  const store = adminDb();
  const snap = await poll(
    () => store.collection('firstContactForms').where('ownerId', '==', ownerUid).get(),
    (s) => s.docs.some((d) => d.data().contactName === contactName),
    15_000,
    `first-contact form named "${contactName}"`,
  );
  const doc = snap.docs.find((d) => d.data().contactName === contactName);
  if (!doc) throw new Error(`Form "${contactName}" not found`);
  return doc.id;
}

export async function getFormSharedWith(formId: string): Promise<string[]> {
  const snap = await adminDb().collection('firstContactForms').doc(formId).get();
  return (snap.data()?.sharedWith as string[] | undefined) ?? [];
}

/** Poll until the grantee is stripped from the form's sharedWith (the onConsentRevoke trigger is async). */
export async function waitForSharedWithStrip(formId: string, uid: string, timeoutMs = 20_000): Promise<void> {
  await poll(
    () => getFormSharedWith(formId),
    (shared) => !shared.includes(uid),
    timeoutMs,
    `sharedWith strip for ${uid} on form ${formId}`,
  );
}

/** Poll until an audit event with the given action exists for the subject. */
export async function waitForAuditAction(subjectUid: string, action: string, timeoutMs = 20_000): Promise<void> {
  await poll(
    async () => {
      const snap = await adminDb()
        .collection('accessEvents')
        .where('subjectId', '==', subjectUid)
        .where('action', '==', action)
        .get();
      return snap.size;
    },
    (n) => n >= 1,
    timeoutMs,
    `audit event "${action}" for ${subjectUid}`,
  );
}

/** Post-deletion server state: owned docs gone, persons/users gone, grants revoked. */
export async function assertDeletionComplete(workerUid: string): Promise<void> {
  const store = adminDb();
  const owned = await store.collection('firstContactForms').where('ownerId', '==', workerUid).get();
  expect(owned.empty, 'first-contact forms should be deleted').toBe(true);
  const workers = await store.collection('workers').where('ownerId', '==', workerUid).get();
  expect(workers.empty, 'worker profile should be deleted').toBe(true);
  expect((await store.collection('persons').doc(workerUid).get()).exists, 'persons doc should be deleted').toBe(false);
  expect((await store.collection('users').doc(workerUid).get()).exists, 'users doc should be deleted').toBe(false);
  const grants = await store.collection('roleGrants').where('granteeId', '==', workerUid).get();
  for (const g of grants.docs) {
    expect(g.data().status, 'role grants should be revoked by deletion').toBe('revoked');
  }
}

// --- UI helpers ---

/** Attach a labelled screenshot to the Playwright report. */
export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

/** Sign up through the invitation-gated UI: "Have an invitation?" → create account → lands on the dashboard.
 *  Pass a dashboardTestId for roles with a dashboard component; omit it
 *  for roles that render the manifest fallback (e.g. hubCoordinator). */
export async function signUp(page: Page, user: SeededUser, dashboardTestId?: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-toggle-signup').click();
  await page.getByTestId('login-display-name').fill(`E2E ${user.role}`);
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/');
  if (dashboardTestId) {
    await expect(page.getByTestId(dashboardTestId)).toBeVisible();
  } else {
    await expect(page.locator('h1')).toContainText('Dashboard');
  }
  await expect(page.getByTestId('error-notice')).toHaveCount(0);
  // Server state: the pending invitation was claimed on first sign-in.
  await waitForClaim(user.email);
}

/** Sign in through the Login page; waits for the role dashboard to render (grants loaded).
 *  Pass a dashboardTestId for roles with a dashboard component; omit it
 *  for roles that render the manifest fallback (e.g. hubCoordinator),
 *  where any rendered dashboard heading is the signal. */
export async function signIn(page: Page, user: SeededUser, dashboardTestId?: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/');
  if (dashboardTestId) {
    await expect(page.getByTestId(dashboardTestId)).toBeVisible();
  } else {
    await expect(page.locator('h1')).toContainText('Dashboard');
  }
  await expect(page.getByTestId('error-notice')).toHaveCount(0);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * Accept window.confirm / window.prompt dialogs while `fn` runs.
 * Revoke uses confirm; deletion uses confirm then a prompt that
 * expects the literal text DELETE. Returns a cleanup function.
 */
export function autoAcceptDialogs(page: Page, promptText = 'DELETE'): () => void {
  const handler = (dialog: import('@playwright/test').Dialog): void => {
    if (dialog.type() === 'prompt') {
      void dialog.accept(promptText);
    } else {
      void dialog.accept();
    }
  };
  page.on('dialog', handler);
  return () => {
    page.off('dialog', handler);
  };
}

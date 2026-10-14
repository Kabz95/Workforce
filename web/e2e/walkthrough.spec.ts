/**
 * Phase 2 eight-step acceptance walkthrough, automated.
 *
 * Drives the REAL web app against the FIREBASE EMULATORS
 * (project demo-workforce) with the three seeded test accounts from
 * globalSetup. One test, eight sequential steps — a later step
 * depends on the earlier ones, so a failure stops the run at the
 * first broken step (Playwright's per-step reporting shows exactly
 * where).
 *
 * Coverage notes (honest about what the UI can and cannot do):
 * - Step 5 "acts": the navigator accepts the handoff and uses the
 *   shared record (views it on the dashboard). Grantees are
 *   READ-ONLY by design — there is no navigator-side edit UI for a
 *   worker's record, and the rules deny grantee writes. The server
 *   handoff machine is covered by functions/test/callable.test.mjs.
 * - Step 8 deletion: the worker's own disposable test data only.
 *   The UI loops processDeletion until the job reports done.
 */
import { expect, test } from '@playwright/test';
import {
  assertDeletionComplete,
  autoAcceptDialogs,
  getFormIdByContactName,
  getFormSharedWith,
  loadSeed,
  shot,
  signIn,
  signOut,
  waitForAuditAction,
  waitForSharedWithStrip,
} from './helpers';

test('Phase 2 eight-step walkthrough', async ({ page }, testInfo) => {
  const seed = loadSeed();
  const { worker, navigator, coordinator } = seed.users;
  const sharedName = `E2E Shared ${seed.run}`;
  const unsharedName = `E2E Unshared ${seed.run}`;

  // --- Step 1: worker signs in; dashboard shows own record; two first-contact forms. ---
  await test.step('1. Worker dashboard + first-contact forms', async () => {
    await signIn(page, worker, 'worker-dashboard');
    await shot(page, testInfo, 'step-1-worker-dashboard');

    await page.goto('/record');
    await page.waitForLoadState('networkidle');
    // Create the worker profile if it does not exist yet (fresh emulator: it does not).
    if (await page.getByTestId('profile-submit').isVisible()) {
      await page.getByTestId('profile-display-name').fill('E2E Worker');
      await page.getByTestId('profile-submit').click();
      await expect(page.getByTestId('profile-card')).toContainText('E2E Worker');
    }
    for (const name of [sharedName, unsharedName]) {
      await page.getByTestId('form-contact-name').fill(name);
      await page.getByTestId('form-contact-method').fill('email');
      await page.getByTestId('form-needs').fill('wayfinding');
      await page.getByTestId('form-submit').click();
      await expect(page.getByTestId('forms-list')).toContainText(name);
    }
    await shot(page, testInfo, 'step-1-forms');
  });

  // --- Step 2: worker grants the navigator access to the shared form. ---
  let sharedFormId = '';
  await test.step('2. Worker grants navigator access to the shared form', async () => {
    sharedFormId = await getFormIdByContactName(worker.uid, sharedName);
    await page.goto('/consents');
    await page.getByTestId('consent-grantee-id').fill(navigator.uid);
    await page.getByTestId('consent-resource-type').selectOption('firstContactForms');
    await page.getByTestId('consent-resource-id').fill(sharedFormId);
    await page.getByTestId('consent-purpose').selectOption('wayfinding support');
    await page.getByTestId('consent-submit').click();
    await expect(page.getByTestId('notice')).toContainText('Grant created');
    await expect(page.getByTestId('live-grants')).toContainText(navigator.uid);
    await expect(page.getByTestId('live-grants')).toContainText(sharedFormId);
    await shot(page, testInfo, 'step-2-consent-live');
    // Server state: sharing active + audit event written.
    expect(await getFormSharedWith(sharedFormId)).toContain(navigator.uid);
    await waitForAuditAction(worker.uid, 'grantAccess');
  });

  // --- Step 3: navigator sees ONLY the shared form. ---
  await test.step('3. Navigator sees the shared form — and nothing else', async () => {
    await signOut(page);
    await signIn(page, navigator, 'navigator-dashboard');
    await expect(page.getByTestId('navigator-dashboard')).toContainText(sharedName);
    await expect(page.getByTestId('navigator-dashboard')).not.toContainText(unsharedName);
    await shot(page, testInfo, 'step-3-navigator-sees-shared-only');
  });

  // --- Step 4: coordinator offers; navigator accepts, uses the record, closes. ---
  await test.step('4. Handoff: offer → accept → act → close', async () => {
    await signOut(page);
    await signIn(page, coordinator); // hubCoordinator renders the manifest fallback, not a role dashboard
    await page.goto('/handoffs');
    await page.getByTestId('handoff-worker-id').fill(worker.uid);
    await page.getByTestId('handoff-recipient-id').fill(navigator.uid);
    await page.getByTestId('handoff-recipient-role').selectOption('navigator');
    await page.getByTestId('handoff-purpose').selectOption('handoff coordination');
    await page.getByTestId('handoff-summary').fill('e2e handoff');
    await page.getByTestId('handoff-offer-submit').click();
    await expect(page.getByTestId('notice')).toContainText('Handoff offered');
    await expect(page.getByTestId('handoffs-sent')).toContainText('offered');
    await shot(page, testInfo, 'step-4-handoff-offered');

    await signOut(page);
    await signIn(page, navigator, 'navigator-dashboard');
    await page.goto('/handoffs');
    const toMe = page.getByTestId('handoffs-to-me');
    await expect(toMe).toContainText('handoff coordination');
    await expect(toMe).toContainText('offered');
    await toMe.locator('tr', { hasText: 'handoff coordination' }).getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByTestId('notice')).toContainText('Handoff accepted');
    await expect(toMe).toContainText('accepted');
    await shot(page, testInfo, 'step-4-handoff-accepted');

    // Act: the navigator uses the shared record (read-only by design).
    await page.goto('/');
    await expect(page.getByTestId('navigator-dashboard')).toContainText(sharedName);

    await page.goto('/handoffs');
    const stopDialogs = autoAcceptDialogs(page);
    try {
      await toMe.locator('tr', { hasText: 'handoff coordination' }).getByRole('button', { name: 'Close' }).click();
    } finally {
      stopDialogs();
    }
    await expect(page.getByTestId('notice')).toContainText('Handoff closed');
    await expect(toMe).toContainText('closed');
    await shot(page, testInfo, 'step-4-handoff-closed');
  });

  // --- Step 5: worker's audit log shows the navigator's access. ---
  await test.step('5. Worker audit log shows the access', async () => {
    await signOut(page);
    await signIn(page, worker, 'worker-dashboard');
    await page.goto('/audit');
    const table = page.getByTestId('audit-table');
    await expect(table).toContainText('Access granted to a record');
    await expect(table).toContainText('Handoff accepted');
    await expect(table).toContainText('navigator');
    await shot(page, testInfo, 'step-5-audit-log');
    await waitForAuditAction(worker.uid, 'acceptHandoff');
  });

  // --- Step 6: worker revokes; navigator loses access. ---
  await test.step('6. Revocation ends access immediately', async () => {
    await page.goto('/consents');
    const live = page.getByTestId('live-grants');
    const stopDialogs = autoAcceptDialogs(page);
    try {
      await live.locator('tr', { hasText: sharedFormId }).getByRole('button', { name: 'Revoke' }).click();
    } finally {
      stopDialogs();
    }
    await expect(page.getByTestId('notice')).toContainText('Grant revoked');
    await expect(page.getByTestId('ended-grants')).toContainText(sharedFormId);
    await shot(page, testInfo, 'step-6-consent-revoked');
    // Server state: the trigger strips sharedWith (async).
    await waitForSharedWithStrip(sharedFormId, navigator.uid);

    await signOut(page);
    await signIn(page, navigator, 'navigator-dashboard');
    await expect(page.getByTestId('navigator-dashboard')).not.toContainText(sharedName);
    await expect(page.getByTestId('navigator-dashboard')).toContainText('No forms shared with you yet');
    await shot(page, testInfo, 'step-6-navigator-locked-out');
  });

  // --- Step 7: worker deletes their own data; the job completes. ---
  await test.step('7. Worker deletion job completes', async () => {
    await signOut(page);
    await signIn(page, worker, 'worker-dashboard');
    await page.goto('/record');
    const stopDialogs = autoAcceptDialogs(page, 'DELETE');
    try {
      await page.getByTestId('delete-all-data').click();
    } finally {
      stopDialogs();
    }
    await expect(page.getByTestId('notice')).toContainText('Your data has been deleted', { timeout: 90_000 });
    await shot(page, testInfo, 'step-7-deleted');
    await assertDeletionComplete(worker.uid);
  });
});

/**
 * Support UI spec (Phase 3, P3.1) — the record-blind app support agent.
 *
 * Self-contained: seeds its OWN pending invitation (worker role, unique
 * email per run) so it never interferes with the walkthrough's users.
 * Runs against the FIREBASE EMULATORS (project demo-workforce).
 *
 * Covers: identity label + warning, quick actions, grounded answer with
 * sources + human route, guardrail refusal, crisis resources, feedback.
 */
import { expect, test } from '@playwright/test';
import { adminDb, signIn, signOut, signUp, shot } from './helpers';

test('Support: identity, grounded answer, guardrail, crisis, feedback', async ({ page }, testInfo) => {
  const run = `support${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${run}-worker@example.test`;
  const user = { email, password: 'Test1234!', role: 'worker' };

  // Seed a pending invitation for this spec's own user.
  await adminDb().collection('roleGrants').add({
    granteeEmail: email,
    granteeId: '',
    role: 'worker',
    scopeType: 'self',
    scopeId: email,
    tenantId: 'hub-1',
    status: 'pending',
    validFrom: new Date(Date.now() - 1000),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    grantedBy: 'e2e-seed',
    basis: 'playwright-e2e-support',
    needsReview: false,
  });

  await test.step('Sign up via invitation', async () => {
    await signUp(page, user, 'worker-dashboard');
  });

  await test.step('Identity + warning are always visible', async () => {
    await page.goto('/support');
    await expect(page.getByTestId('support-identity')).toContainText('Not a peer supporter');
    await expect(page.getByTestId('support-warning')).toContainText('Do not enter names');
    await shot(page, testInfo, 'support-identity');
  });

  await test.step('Quick action fills the question; grounded answer with sources + route', async () => {
    await page.getByTestId('support-quick-how').click();
    await expect(page.getByTestId('support-question')).toHaveValue('How do I ');
    await page.getByTestId('support-question').fill('How do I export my data?');
    await page.getByTestId('support-submit').click();
    await expect(page.getByTestId('support-answer')).toContainText('Export my data');
    await expect(page.getByTestId('support-sources')).toContainText('Export my data');
    await expect(page.getByTestId('support-route')).toBeVisible();
    await expect(page.getByTestId('error-notice')).toHaveCount(0);
  });

  await test.step('Guardrail refuses personal data without storing it', async () => {
    await page.getByTestId('support-question').fill('my email is jane@example.com, what does my record say?');
    await page.getByTestId('support-submit').click();
    await expect(page.getByTestId('support-answer')).toContainText('cannot process');
    await expect(page.getByTestId('support-answer')).not.toContainText('jane@example.com');
  });

  await test.step('Crisis input shows crisis resources, never counseling', async () => {
    await page.getByTestId('support-question').fill('I want to kill myself');
    await page.getByTestId('support-submit').click();
    await expect(page.getByTestId('support-answer')).toContainText('988');
    await expect(page.getByTestId('support-resources')).toContainText('988 Suicide Prevention Service');
  });

  await test.step('Feedback records helpful / not-helpful', async () => {
    await page.getByTestId('support-question').fill('How do I revoke a consent?');
    await page.getByTestId('support-submit').click();
    await expect(page.getByTestId('support-answer')).toBeVisible();
    await page.getByTestId('support-feedback-not-helpful').click();
    await expect(page.getByTestId('support-page')).toContainText('marked not helpful');
    await expect(page.getByTestId('error-notice')).toHaveCount(0);
  });

  await test.step('Sign out', async () => {
    await signOut(page);
    // Sign-in still works (support asked nothing that mutates the account).
    await signIn(page, user, 'worker-dashboard');
    await signOut(page);
  });
});

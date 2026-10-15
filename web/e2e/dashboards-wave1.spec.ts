/**
 * Phase 3 wave 1 dashboards — Supervisor, Mentor, PrivacyLead.
 *
 * Drives the REAL web app against the FIREBASE EMULATORS
 * (project demo-workforce). Each role signs up via its pending
 * invitation (globalSetup), then server state is seeded through
 * firebase-admin: a shared supervision session + assignment +
 * consent for the supervisor (plus an UNSHARED session that must
 * stay invisible), an assignment + mentorship for the mentor, and
 * a complaint + access events + one aggregate for the privacy
 * lead. The "worker" here is a synthetic uid — no account, never
 * signs in — so this spec never interferes with the walkthrough's
 * users. Counts the privacy lead shows are asserted suppression-
 * aware (small cells read "fewer than 5"), not exact, so the spec
 * holds whatever order the specs run in.
 */
import { expect, test } from '@playwright/test';
import {
  adminDb,
  getUidByEmail,
  loadSeed,
  shot,
  signIn,
  signOut,
  signUp,
} from './helpers';

const WORKER_UID = 'e2e-wave1-worker';
const HUB = 'hub-1';

test('Dashboards wave 1: supervisor / mentor / privacyLead', async ({ page }, testInfo) => {
  const seed = loadSeed();
  const { supervisor, mentor, privacyLead } = seed.users;

  // --- Supervisor: sign up, seed, verify. ---
  await test.step('Supervisor sees shared sessions only', async () => {
    await signUp(page, supervisor, 'supervisor-dashboard');
    supervisor.uid = await getUidByEmail(supervisor.email);
    const supUid = supervisor.uid as string;
    const store = adminDb();

    const sessionRef = await store.collection('supervisionSessions').add({
      ownerId: WORKER_UID,
      supervisorId: supUid,
      tenantId: HUB,
      sharedWith: [supUid],
      notes: 'E2E shared session',
      date: new Date(),
    });
    await store.collection('supervisionSessions').add({
      ownerId: WORKER_UID,
      supervisorId: supUid,
      tenantId: HUB,
      sharedWith: [],
      notes: 'E2E unshared session',
      date: new Date(),
    });
    await store.collection('assignments').add({
      workerId: WORKER_UID,
      holderId: supUid,
      role: 'supervisor',
      tenantId: HUB,
      status: 'active',
      startedAt: new Date(),
      endedAt: null,
    });
    await store.collection('consents').add({
      granterId: WORKER_UID,
      granteeId: supUid,
      tenantId: HUB,
      scope: 'read:supervisionSessions',
      resourceType: 'supervisionSessions',
      resourceId: sessionRef.id,
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      purpose: 'supervision sharing',
    });

    await signOut(page);
    await signIn(page, supervisor, 'supervisor-dashboard');
    const dash = page.getByTestId('supervisor-dashboard');
    await expect(dash).toContainText('E2E shared session');
    await expect(dash).toContainText(`Supervision for worker ${WORKER_UID}`);
    await expect(dash).toContainText('Live supervision consent');
    await expect(dash).not.toContainText('E2E unshared session');
    await shot(page, testInfo, 'wave1-supervisor-dashboard');
    await signOut(page);
  });

  // --- Mentor: sign up, seed, verify. ---
  await test.step('Mentor sees own mentorships only', async () => {
    await signUp(page, mentor, 'mentor-dashboard');
    mentor.uid = await getUidByEmail(mentor.email);
    const mentorUid = mentor.uid as string;
    const store = adminDb();

    await store.collection('assignments').add({
      workerId: WORKER_UID,
      holderId: mentorUid,
      role: 'mentor',
      tenantId: HUB,
      status: 'active',
      startedAt: new Date(),
      endedAt: null,
    });
    await store.collection('mentorships').add({
      tenantId: HUB,
      participantIds: [mentorUid, WORKER_UID],
      sharedWith: [],
      notes: 'E2E mentorship notes',
    });
    await store.collection('mentorships').add({
      tenantId: HUB,
      participantIds: ['someone-else', WORKER_UID],
      sharedWith: [],
      notes: 'E2E other mentorship',
    });

    await signOut(page);
    await signIn(page, mentor, 'mentor-dashboard');
    const dash = page.getByTestId('mentor-dashboard');
    await expect(dash).toContainText('E2E mentorship notes');
    await expect(dash).toContainText(`Mentorship for worker ${WORKER_UID}`);
    await expect(dash).not.toContainText('E2E other mentorship');
    await shot(page, testInfo, 'wave1-mentor-dashboard');
    await signOut(page);
  });

  // --- Privacy lead: sign up, seed, verify. ---
  await test.step('Privacy lead sees aggregates + exceptions, never records', async () => {
    await signUp(page, privacyLead, 'privacy-lead-dashboard');
    privacyLead.uid = await getUidByEmail(privacyLead.email);
    const store = adminDb();

    await store.collection('complaints').add({
      tenantId: HUB,
      complainantId: WORKER_UID,
      summary: 'E2E complaint',
      status: 'open',
    });
    // 6 allowed + 1 denied grantAccess events: grantAccess shows a
    // real count (>= 5); the single denial is suppressed.
    for (let i = 0; i < 6; i++) {
      await store.collection('accessEvents').add({
        subjectId: WORKER_UID,
        actorId: 'e2e-actor',
        action: 'grantAccess',
        resourceType: 'pathwaySteps',
        resourceId: `step-${i}`,
        actingRole: 'worker',
        actingGrantId: null,
        purpose: 'E2E access probe',
        correlationId: `c-${i}`,
        result: 'allowed',
        createdAt: new Date(),
        tenantId: HUB,
      });
    }
    await store.collection('accessEvents').add({
      subjectId: WORKER_UID,
      actorId: 'e2e-actor',
      action: 'grantAccess',
      resourceType: 'pathwaySteps',
      resourceId: 'step-denied',
      actingRole: 'worker',
      actingGrantId: null,
      purpose: 'E2E denied probe',
      correlationId: 'c-denied',
      result: 'denied',
      createdAt: new Date(),
      tenantId: HUB,
    });
    await store.collection('aggregates').add({
      tenantId: HUB,
      metric: 'e2e-metric',
      period: '2026-W42',
      value: 10,
      breakdown: {},
    });

    await signOut(page);
    await signIn(page, privacyLead, 'privacy-lead-dashboard');
    const dash = page.getByTestId('privacy-lead-dashboard');
    // The complaint queue shows the complaint.
    await expect(dash).toContainText('E2E complaint');
    // Suppression: small cells read "fewer than 5", never a number.
    await expect(dash).toContainText('fewer than 5');
    // The denied exception is listed for review.
    await expect(dash).toContainText('E2E denied probe');
    // No consent record contents, no worker records, no activity feed.
    await expect(dash).not.toContainText('E2E shared session');
    await expect(dash).not.toContainText('E2E mentorship notes');
    await shot(page, testInfo, 'wave1-privacy-lead-dashboard');
    await signOut(page);
  });
});

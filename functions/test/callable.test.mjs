/**
 * Callable-level integration tests for the Phase 2 slice.
 *
 * Tests the deployed-callable surface end to end (grantAccess, handoff
 * flows, closeHandoff, ensureMyPerson, authorizeCommand taxonomy,
 * requestDeletion job + processDeletion, the onConsentRevoke trigger)
 * against the EMULATOR stack — never against the live project.
 *
 * REQUIRES the emulators running with an EMULATOR project (the Functions
 * emulator serves one project; the test seeds that project):
 *
 *   cd workforce-platform/functions && npm run build
 *   firebase emulators:start --project demo-workforce --only auth,firestore,functions
 *   npm run test:callable
 *
 * The Functions emulator must run the CURRENT build (npm run build
 * first). The test uses plain fetch + firebase-admin — no new deps.
 *
 * Environment (all optional):
 *   FIREBASE_PROJECT (default 'demo-workforce')
 *   FIRESTORE_EMULATOR_HOST (default '127.0.0.1:8080')
 *   FIREBASE_AUTH_EMULATOR_HOST (default '127.0.0.1:9099')
 *   FUNCTIONS_EMULATOR_HOST (default '127.0.0.1:5001')
 *
 * Notes on what this suite does NOT prove:
 * - requestExport's happy path needs real Storage (the emulator stack
 *   has no Storage emulator configured); the test proves the auth
 *   gate and documents the gap instead of asserting a URL.
 * - The deletion job's auto-export step is best-effort: in the
 *   emulator it records exportError and deletion still completes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const PROJECT = process.env.FIREBASE_PROJECT || 'demo-workforce';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const HUB = 'hub-1';
const RUN = `t${Date.now().toString(36)}`;

let admin;
let db;
let auth;
let createdUids = [];

function fnUrl(name) {
  return `http://${FUNCTIONS_HOST}/${PROJECT}/northamerica-northeast1/${name}`;
}

async function probeEmulators() {
  // Firestore emulator: any HTTP response means it is up.
  const fs = await fetch(`http://${FIRESTORE_HOST}/`, { signal: AbortSignal.timeout(5000) });
  if (!fs.ok && fs.status !== 404) throw new Error(`Firestore emulator unreachable (${fs.status})`);
  // Functions emulator: a POST to a nonexistent function returns 404, not a connection error.
  try {
    await fetch(fnUrl('__probe__'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`Functions emulator unreachable at ${FUNCTIONS_HOST}: ${err.message}`);
  }
}

async function makeUser(role, tenantId = HUB) {
  const email = `${role}-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const user = await auth.createUser({ email, password: 'Test1234!' });
  createdUids.push(user.uid);
  await auth.setCustomUserClaims(user.uid, { roles: [role], tenantId });
  // Seed a live grant doc for the role (the gateway resolves grants, not claims).
  await db.collection('roleGrants').add({
    granteeId: user.uid,
    role,
    scopeType: role === 'worker' ? 'self' : 'hub',
    scopeId: role === 'worker' ? user.uid : tenantId,
    tenantId,
    status: 'active',
    validFrom: new Date(Date.now() - 1000),
    validUntil: null,
    grantedBy: 'test',
    basis: 'callable-test',
    needsReview: false,
  });
  // Mint an ID token via the Auth emulator REST API.
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!body.idToken) throw new Error(`Token mint failed for ${email}: ${JSON.stringify(body)}`);
  return { uid: user.uid, email, token: body.idToken, role };
}

/** Call a v2 onCall function via the emulator's HTTP callable protocol. */
async function callFn(name, token, data) {
  const res = await fetch(fnUrl(name), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  if (body.error) {
    const err = new Error(body.error.message || 'callable error');
    // The callable wire format carries the canonical status
    // (PERMISSION_DENIED); the client SDKs expose the kebab-case
    // Functions code (permission-denied). Normalise here so the
    // assertions match the client-visible contract.
    const raw = body.error.status || body.error.code || 'unknown';
    err.code = String(raw).toLowerCase().replace(/_/g, '-');
    throw err;
  }
  return body.result;
}

async function seedConsent({ granterId, granteeId, resourceType, resourceId, purpose = 'wayfinding support' }) {
  const ref = await db.collection('consents').add({
    granterId,
    granteeId,
    tenantId: HUB,
    scope: `read:${resourceType}`,
    resourceType,
    resourceId,
    grantedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    purpose,
  });
  return ref.id;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

before(async () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  try {
    await probeEmulators();
  } catch (err) {
    throw new Error(
      `${err.message}\n` +
        'Start the emulators first: firebase emulators:start --project demo-workforce --only auth,firestore,functions',
    );
  }
  admin = (await import('firebase-admin')).default;
  admin.initializeApp({ projectId: PROJECT });
  db = admin.firestore();
  auth = admin.auth();
});

after(async () => {
  for (const uid of createdUids) {
    try {
      await auth.deleteUser(uid);
    } catch {
      // Already gone — fine.
    }
  }
});

describe('grantAccess (Phase 2)', () => {
  it('worker activates a consent: sharedWith gains the grantee + audit event', async () => {
    const worker = await makeUser('worker');
    const nav = await makeUser('navigator');
    const stepRef = await db.collection('pathwaySteps').add({
      ownerId: worker.uid, tenantId: HUB, sharedWith: [],
      type: 'navigation', title: 't', status: 'not-started',
    });
    const consentId = await seedConsent({
      granterId: worker.uid, granteeId: nav.uid,
      resourceType: 'pathwaySteps', resourceId: stepRef.id,
    });
    const result = await callFn('grantAccess', worker.token, {
      consentId, purpose: 'wayfinding support', actingRole: 'worker',
    });
    assert.equal(result.ok, true);
    const step = await stepRef.get();
    assert.ok(step.data().sharedWith.includes(nav.uid));
    const events = await db.collection('accessEvents')
      .where('subjectId', '==', worker.uid)
      .where('action', '==', 'grantAccess')
      .get();
    assert.ok(events.size >= 1);
  });

  it('non-owner cannot activate a consent; unknown consent 404s', async () => {
    const worker = await makeUser('worker');
    const nav = await makeUser('navigator');
    const consentId = await seedConsent({
      granterId: worker.uid, granteeId: nav.uid,
      resourceType: 'pathwaySteps', resourceId: 'no-such-doc',
    });
    await assert.rejects(
      callFn('grantAccess', nav.token, { consentId, purpose: 'wayfinding support' }),
      (e) => e.code === 'permission-denied',
    );
    await assert.rejects(
      callFn('grantAccess', worker.token, { consentId: 'no-such-consent', purpose: 'wayfinding support' }),
      (e) => e.code === 'not-found',
    );
  });

  it('a non-taxonomy purpose is denied at the gateway', async () => {
    const worker = await makeUser('worker');
    const nav = await makeUser('navigator');
    const stepRef = await db.collection('pathwaySteps').add({
      ownerId: worker.uid, tenantId: HUB, sharedWith: [],
      type: 'navigation', title: 't', status: 'not-started',
    });
    const consentId = await seedConsent({
      granterId: worker.uid, granteeId: nav.uid,
      resourceType: 'pathwaySteps', resourceId: stepRef.id,
    });
    await assert.rejects(
      callFn('grantAccess', worker.token, { consentId, purpose: 'for reasons' }),
      (e) => e.code === 'permission-denied' && /purpose-not-in-taxonomy/.test(e.message),
    );
  });
});

describe('handoff flows (Phase 2)', () => {
  it('coordinator offers → navigator accepts → navigator closes; worker/sender cannot respond', async () => {
    const worker = await makeUser('worker');
    const coord = await makeUser('hubCoordinator');
    const nav = await makeUser('navigator');
    const created = await callFn('createHandoff', coord.token, {
      workerId: worker.uid,
      recipientId: nav.uid,
      recipientRole: 'navigator',
      purpose: 'handoff coordination',
      payloadSummary: 'first-contact navigation',
      tenantId: HUB,
      actingRole: 'hubCoordinator',
    });
    assert.equal(created.status, 'offered');
    const handoffId = created.handoffId;
    // Worker (subject) cannot respond.
    await assert.rejects(
      callFn('respondHandoff', worker.token, { handoffId, decision: 'accept', actingRole: 'worker' }),
      (e) => e.code === 'permission-denied',
    );
    // Sender cannot respond.
    await assert.rejects(
      callFn('respondHandoff', coord.token, { handoffId, decision: 'accept', actingRole: 'hubCoordinator' }),
      (e) => e.code === 'permission-denied',
    );
    // Recipient accepts.
    const accepted = await callFn('respondHandoff', nav.token, {
      handoffId, decision: 'accept', actingRole: 'navigator',
    });
    assert.equal(accepted.status, 'accepted');
    // Recipient closes.
    const closed = await callFn('closeHandoff', nav.token, {
      handoffId, actingRole: 'navigator',
    });
    assert.equal(closed.status, 'closed');
    // Closing a closed handoff fails.
    await assert.rejects(
      callFn('closeHandoff', nav.token, { handoffId, actingRole: 'navigator' }),
      (e) => e.code === 'failed-precondition',
    );
    // The worker sees the handoff's audit trail (subject events).
    const events = await db.collection('accessEvents')
      .where('subjectId', '==', worker.uid)
      .where('resourceType', '==', 'handoff')
      .get();
    assert.ok(events.size >= 3); // create + accept + close
  });

  it('navigator without an assignment cannot send; with one, they can', async () => {
    const worker = await makeUser('worker');
    const nav = await makeUser('navigator');
    const coord = await makeUser('hubCoordinator');
    await assert.rejects(
      callFn('createHandoff', nav.token, {
        workerId: worker.uid, recipientId: coord.uid, recipientRole: 'hubCoordinator',
        purpose: 'handoff coordination', payloadSummary: '', tenantId: HUB,
        actingRole: 'navigator',
      }),
      (e) => e.code === 'permission-denied' && /assignment/.test(e.message),
    );
    await db.collection('assignments').add({
      workerId: worker.uid, holderId: nav.uid, role: 'navigator',
      tenantId: HUB, status: 'active', startedAt: new Date(), endedAt: null,
    });
    const created = await callFn('createHandoff', nav.token, {
      workerId: worker.uid, recipientId: coord.uid, recipientRole: 'hubCoordinator',
      purpose: 'handoff coordination', payloadSummary: '', tenantId: HUB,
      actingRole: 'navigator',
    });
    assert.equal(created.status, 'offered');
  });

  it('a worker cannot send a handoff (not a handoff sender)', async () => {
    const worker = await makeUser('worker');
    const nav = await makeUser('navigator');
    await assert.rejects(
      callFn('createHandoff', worker.token, {
        workerId: worker.uid, recipientId: nav.uid, recipientRole: 'navigator',
        purpose: 'handoff coordination', payloadSummary: '', tenantId: HUB,
        actingRole: 'worker',
      }),
      (e) => e.code === 'permission-denied',
    );
  });
});

describe('ensureMyPerson (Phase 2)', () => {
  it('creates the persons doc exactly once; second call is a no-op', async () => {
    const worker = await makeUser('worker');
    // Remove the persons doc if a previous run left one (fresh uid, so none).
    const first = await callFn('ensureMyPerson', worker.token, {});
    assert.equal(first.created, true);
    const snap = await db.collection('persons').doc(worker.uid).get();
    assert.equal(snap.exists, true);
    assert.equal(snap.data().tenantId, HUB);
    assert.equal(snap.data().email, worker.email);
    const second = await callFn('ensureMyPerson', worker.token, {});
    assert.equal(second.created, false);
    const again = await db.collection('persons').doc(worker.uid).get();
    assert.equal(again.exists, true);
  });

  it('rejects a non-taxonomy purpose', async () => {
    const worker = await makeUser('worker');
    await assert.rejects(
      callFn('ensureMyPerson', worker.token, { purpose: 'bogus purpose' }),
      (e) => e.code === 'invalid-argument',
    );
  });
});

describe('authorizeCommand taxonomy via the gateway (Phase 2)', () => {
  it('denies a non-taxonomy purpose, allows a taxonomy purpose', async () => {
    const worker = await makeUser('worker');
    const base = {
      command: 'grantAccess',
      highRisk: true,
      scope: { tenantId: HUB, scopeType: 'self', scopeId: worker.uid },
      relationship: 'owner',
      consentRequired: true,
      consentLive: true,
      actingRole: 'worker',
    };
    const denied = await callFn('authorizeCommand', worker.token, { ...base, purpose: 'not-a-purpose' });
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /purpose-not-in-taxonomy/);
    const allowed = await callFn('authorizeCommand', worker.token, { ...base, purpose: 'wayfinding support' });
    assert.equal(allowed.allowed, true);
  });
});

describe('requestDeletion job + processDeletion (Phase 2)', () => {
  it('deletes owned docs, anonymises shared docs, revokes grants, completes the job', async () => {
    const worker = await makeUser('worker');
    const nav = await makeUser('navigator');
    const uid = worker.uid;
    // Seed a small account across the deletion plan.
    const workerDoc = await db.collection('workers').add({ ownerId: uid, tenantId: HUB, displayName: 'W', status: 'active' });
    const step = await db.collection('pathwaySteps').add({
      ownerId: uid, tenantId: HUB, sharedWith: [], type: 'navigation', title: 't', status: 'not-started',
    });
    const form = await db.collection('firstContactForms').add({
      ownerId: uid, tenantId: HUB, sharedWith: [], contactName: 'x', contactMethod: 'x', needs: 'x', notes: 'x',
    });
    const session = await db.collection('supervisionSessions').add({
      ownerId: uid, supervisorId: nav.uid, tenantId: HUB, sharedWith: [], notes: 'n', date: new Date(),
    });
    const mentorship = await db.collection('mentorships').add({
      tenantId: HUB, participantIds: [uid, nav.uid], sharedWith: [nav.uid], notes: 'm',
    });
    const consentId = await seedConsent({
      granterId: uid, granteeId: nav.uid, resourceType: 'pathwaySteps', resourceId: step.id,
    });
    await db.collection('persons').doc(uid).set({ displayName: 'W', email: worker.email, tenantId: HUB });
    await db.collection('users').doc(uid).set({ displayName: 'W', email: worker.email, tenantId: HUB, roles: ['worker'] });

    const job = await callFn('requestDeletion', worker.token, { purpose: 'delete my data', actingRole: 'worker' });
    assert.ok(job.requestId);
    assert.equal(job.status, 'queued');
    // A second request while unfinished resumes the same job.
    const resumed = await callFn('requestDeletion', worker.token, { purpose: 'delete my data', actingRole: 'worker' });
    assert.equal(resumed.requestId, job.requestId);
    assert.equal(resumed.resumed, true);
    // Advance until done.
    let pass;
    for (let i = 0; i < 10; i++) {
      pass = await callFn('processDeletion', worker.token, {
        requestId: job.requestId, purpose: 'delete my data', actingRole: 'worker',
      });
      if (pass.status === 'done') break;
      await sleep(500);
    }
    assert.equal(pass.status, 'done');
    // Owned docs gone.
    assert.equal((await workerDoc.get()).exists, false);
    assert.equal((await step.get()).exists, false);
    assert.equal((await form.get()).exists, false);
    // Shared docs anonymised.
    assert.equal((await session.get()).data().ownerId, 'anonymised');
    assert.ok(!(await mentorship.get()).data().participantIds.includes(uid));
    // Consent revoked.
    const consent = await db.collection('consents').doc(consentId).get();
    assert.notEqual(consent.data().revokedAt, null);
    // Grants revoked, persons/users docs gone.
    const grants = await db.collection('roleGrants').where('granteeId', '==', uid).get();
    for (const g of grants.docs) assert.equal(g.data().status, 'revoked');
    assert.equal((await db.collection('persons').doc(uid).get()).exists, false);
    assert.equal((await db.collection('users').doc(uid).get()).exists, false);
    // Accountability event kept.
    const events = await db.collection('accessEvents')
      .where('subjectId', '==', uid)
      .where('action', '==', 'requestDeletion')
      .get();
    assert.ok(events.size >= 1);
    // Terminal: the deletion revoked the worker's grants, so a further
    // requestDeletion is denied (high-risk commands need a live grant).
    // Re-deletion requires re-registration with a new grant.
    await assert.rejects(
      callFn('requestDeletion', worker.token, { purpose: 'delete my data', actingRole: 'worker' }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('another user cannot advance someone else’s deletion job', async () => {
    const worker = await makeUser('worker');
    const other = await makeUser('worker');
    const job = await callFn('requestDeletion', worker.token, { purpose: 'delete my data', actingRole: 'worker' });
    await assert.rejects(
      callFn('processDeletion', other.token, { requestId: job.requestId, purpose: 'delete my data', actingRole: 'worker' }),
      (e) => e.code === 'permission-denied',
    );
    // Clean up: finish the job so it does not linger for the sweeper.
    for (let i = 0; i < 10; i++) {
      const pass = await callFn('processDeletion', worker.token, {
        requestId: job.requestId, purpose: 'delete my data', actingRole: 'worker',
      });
      if (pass.status === 'done') break;
      await sleep(500);
    }
  });
});

describe('onConsentRevoke trigger strips sharedWith (Phase 2)', () => {
  it('revoking a consent removes the grantee from the target + writes the event', async () => {
    const worker = await makeUser('worker');
    const nav = await makeUser('navigator');
    const stepRef = await db.collection('pathwaySteps').add({
      ownerId: worker.uid, tenantId: HUB, sharedWith: [nav.uid],
      type: 'navigation', title: 't', status: 'not-started',
    });
    const consentRef = await db.collection('consents').add({
      granterId: worker.uid, granteeId: nav.uid, tenantId: HUB,
      scope: 'read:pathwaySteps', resourceType: 'pathwaySteps', resourceId: stepRef.id,
      grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null, purpose: 'wayfinding support',
    });
    // Simulate the client revoke (the rules allow the granter to set revokedAt).
    await consentRef.update({ revokedAt: new Date() });
    // The trigger runs async in the Functions emulator — poll for the strip.
    let stripped = false;
    for (let i = 0; i < 40; i++) {
      const step = await stepRef.get();
      if (!step.data().sharedWith.includes(nav.uid)) {
        stripped = true;
        break;
      }
      await sleep(500);
    }
    assert.equal(stripped, true, 'onConsentRevoke did not strip sharedWith within 20s');
    const events = await db.collection('accessEvents')
      .where('subjectId', '==', worker.uid)
      .where('action', '==', 'revokeConsent')
      .get();
    assert.ok(events.size >= 1);
  });
});

describe('requestExport auth gate (Phase 2)', () => {
  it('a caller without a live grant is denied before any Storage work', async () => {
    // Fresh Auth user: no claims, no grant docs → no fallback.
    const email = `nogrant-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const user = await auth.createUser({ email, password: 'Test1234!' });
    createdUids.push(user.uid);
    const res = await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true }),
      },
    );
    const { idToken } = await res.json();
    await assert.rejects(
      callFn('requestExport', idToken, { purpose: 'export my data' }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('a worker passes the auth gate (happy path needs real Storage)', async () => {
    const worker = await makeUser('worker');
    try {
      const result = await callFn('requestExport', worker.token, { purpose: 'export my data', actingRole: 'worker' });
      // Only reachable when a Storage emulator / real bucket is present.
      assert.ok(typeof result.url === 'string' && result.url.startsWith('http'));
    } catch (err) {
      // In the emulator stack (no Storage emulator configured), the
      // upload fails AFTER authorization — that is environmental, not
      // an authorization failure. The auth gate passing is the assertion.
      assert.notEqual(err.code, 'permission-denied', 'worker should pass the export auth gate');
      assert.match(String(err.code), /internal|unknown|storage|not-found/i);
    }
  });
});

describe('invitations (production onboarding)', () => {
  /** Mint an ID token for an email/password account (Auth emulator REST). */
  async function mintToken(email, password = 'Test1234!') {
    const res = await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const body = await res.json();
    if (!body.idToken) throw new Error(`Token mint failed for ${email}: ${JSON.stringify(body)}`);
    return body.idToken;
  }

  /** An Auth user with NO claims and NO grants (bare account). */
  async function makeBareUser(email) {
    const user = await auth.createUser({ email, password: 'Test1234!' });
    createdUids.push(user.uid);
    return { uid: user.uid, email, token: await mintToken(email) };
  }

  function inviteArgs(email, overrides = {}) {
    return {
      granteeEmail: email,
      role: 'worker',
      scopeType: 'self',
      scopeId: email,
      tenantId: HUB,
      basis: 'invitation-test',
      purpose: 'invite a member',
      ...overrides,
    };
  }

  it('coordinator invites an email → pending invitation (granteeId empty, nothing conferred)', async () => {
    const coord = await makeUser('hubCoordinator');
    const email = `invited-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const result = await callFn('inviteMember', coord.token, inviteArgs(email));
    assert.equal(result.status, 'pending');
    const snap = await db.collection('roleGrants').doc(result.grantId).get();
    assert.equal(snap.data().granteeEmail, email);
    assert.equal(snap.data().granteeId, '');
    assert.equal(snap.data().status, 'pending');
    assert.equal(snap.data().needsReview, false);
  });

  it('invitee signs up with the invited email → ensureMyPerson claims it → active grant + persons doc', async () => {
    const coord = await makeUser('hubCoordinator');
    const email = `claim-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const invited = await callFn('inviteMember', coord.token, inviteArgs(email));
    const invitee = await makeBareUser(email);
    const claimed = await callFn('ensureMyPerson', invitee.token, {});
    assert.equal(claimed.claimed.length, 1);
    assert.equal(claimed.claimed[0].grantId, invited.grantId);
    const snap = await db.collection('roleGrants').doc(invited.grantId).get();
    assert.equal(snap.data().granteeId, invitee.uid);
    assert.equal(snap.data().status, 'active');
    const person = await db.collection('persons').doc(invitee.uid).get();
    assert.equal(person.exists, true);
    assert.equal(person.data().tenantId, HUB);
    assert.equal(person.data().email, email);
    const grants = await callFn('getMyGrants', invitee.token, {});
    assert.ok(grants.grants.some((g) => g.id === invited.grantId && g.live === true));
  });

  it('signup without an invitation → bare persons doc, no grants, no access', async () => {
    const email = `bare-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const bare = await makeBareUser(email);
    const result = await callFn('ensureMyPerson', bare.token, {});
    assert.equal(result.created, true);
    assert.deepEqual(result.claimed, []);
    const person = await db.collection('persons').doc(bare.uid).get();
    assert.equal(person.exists, true);
    assert.equal(person.data().tenantId, null);
    const grants = await callFn('getMyGrants', bare.token, {});
    assert.deepEqual(grants.grants, []);
  });

  it('self-invite is denied; non-authority cannot invite; systemAdmin invitations are denied', async () => {
    const coord = await makeUser('hubCoordinator');
    await assert.rejects(
      callFn('inviteMember', coord.token, inviteArgs(coord.email)),
      (e) => e.code === 'permission-denied',
    );
    const worker = await makeUser('worker');
    await assert.rejects(
      callFn('inviteMember', worker.token, inviteArgs(`x-${RUN}@example.test`)),
      (e) => e.code === 'permission-denied',
    );
    await assert.rejects(
      callFn('inviteMember', coord.token, inviteArgs(`y-${RUN}@example.test`, { role: 'systemAdmin' })),
      (e) => e.code === 'permission-denied',
    );
  });

  it('inviting the same email+role+scope twice is idempotent (no duplicate)', async () => {
    const coord = await makeUser('hubCoordinator');
    const email = `dup-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const first = await callFn('inviteMember', coord.token, inviteArgs(email));
    const second = await callFn('inviteMember', coord.token, inviteArgs(email));
    assert.equal(second.grantId, first.grantId);
    assert.equal(second.duplicate, true);
    const snap = await db.collection('roleGrants')
      .where('granteeEmail', '==', email)
      .where('status', '==', 'pending')
      .get();
    assert.equal(snap.size, 1);
  });

  it('an expired invitation is marked expired, never claimed', async () => {
    const email = `expired-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const ref = await db.collection('roleGrants').add({
      granteeEmail: email,
      granteeId: '',
      role: 'worker',
      scopeType: 'self',
      scopeId: email,
      tenantId: HUB,
      status: 'pending',
      validFrom: new Date(Date.now() - 86400000),
      validUntil: new Date(Date.now() - 1000),
      grantedBy: 'test',
      basis: 'expired-invitation-test',
      needsReview: false,
    });
    const bare = await makeBareUser(email);
    const result = await callFn('ensureMyPerson', bare.token, {});
    assert.deepEqual(result.claimed, []);
    const snap = await ref.get();
    assert.equal(snap.data().status, 'expired');
    const person = await db.collection('persons').doc(bare.uid).get();
    assert.equal(person.data().tenantId, null);
  });

  it('a needs-review invitation claims to proposed (not active) until resolved', async () => {
    // Inviting an existing worker to the employer role is the
    // high-risk employer + inside-role combination → needsReview.
    const worker = await makeUser('worker');
    const coord = await makeUser('hubCoordinator');
    const invited = await callFn('inviteMember', coord.token, inviteArgs(worker.email, {
      role: 'employer', scopeType: 'employer', scopeId: 'employer-1',
    }));
    assert.equal(invited.needsReview, true);
    const claimed = await callFn('ensureMyPerson', worker.token, {});
    assert.ok(claimed.claimed.some((c) => c.grantId === invited.grantId));
    const snap = await db.collection('roleGrants').doc(invited.grantId).get();
    assert.equal(snap.data().status, 'proposed');
    assert.equal(snap.data().granteeId, worker.uid);
  });

  it('a pending invitation can be cancelled (revoked) before claim', async () => {
    const coord = await makeUser('hubCoordinator');
    const email = `cancel-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const invited = await callFn('inviteMember', coord.token, inviteArgs(email));
    const revoked = await callFn('revokeRoleGrant', coord.token, { grantId: invited.grantId });
    assert.equal(revoked.status, 'revoked');
    const bare = await makeBareUser(email);
    const result = await callFn('ensureMyPerson', bare.token, {});
    assert.deepEqual(result.claimed, []);
  });
});

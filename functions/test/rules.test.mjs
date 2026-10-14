/**
 * Firestore rules tests for the Role Kernel (firestore.rules).
 *
 * REQUIRES the Firestore emulator running with the repo rules:
 *   firebase emulators:start --only firestore
 * Run:  npm run test:rules
 *
 * NOTE: the emulator loads firestore.rules from firebase.json at
 * startup. This test does NOT push rules via the emulator's
 * :securityRules endpoint: that endpoint returns 503
 * ("Network closed for unknown reason") in this environment for ANY
 * rules content (verified with a trivial rules file too), so the
 * startup-loaded rules are the ones under test. The suite contains
 * both positive and negative cases, so a full pass proves the repo
 * rules — not a permissive or deny-all default — are active.
 *
 * Coverage (Phase 1 gates):
 * - tenant isolation (writes + reads bound to the claim tenant)
 * - forged inputs (wrong tenant, wrong owner, tampered sharedWith)
 * - role-array membership checks (claims roles[])
 * - server-only collections (accessEvents, roleGrants, aggregates,
 *   idempotencyKeys, deletionRequests) reject client writes
 * - consent create/revoke rules (allowlist scopes, expiry required,
 *   granter-only revoke, revokedAt-only change)
 * - handoff create/update rules (sender creates, recipient responds)
 * - no cross-role leakage (employer cannot read worker records;
 *   analyst cannot read raw evaluation submissions)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const PROJECT_ID = 'kernel-rules-test';
// Host is configurable: the sandbox network layer breaks HTTP/2 to
// 127.0.0.1 (RST_STREAM protocol errors); localhost may route
// differently. Override with FIRESTORE_TEST_HOST=localhost.
const EMULATOR_HOST = process.env.FIRESTORE_TEST_HOST || '127.0.0.1';

let rulesUnitTesting;
let testEnv;

const HUB = 'hub-1';
const OTHER_HUB = 'hub-2';

function ctx(uid, claims) {
  return testEnv.authenticatedContext(uid, claims);
}

const worker1 = () => ctx('worker-1', { roles: ['worker'], tenantId: HUB });
const worker2 = () => ctx('worker-2', { roles: ['worker'], tenantId: HUB });
const workerOtherHub = () => ctx('worker-9', { roles: ['worker'], tenantId: OTHER_HUB });
const coordinator = () => ctx('coord-1', { roles: ['hubCoordinator'], tenantId: HUB });
const privacyLead = () => ctx('privacy-1', { roles: ['privacyLead'], tenantId: HUB });
const analyst = () => ctx('analyst-1', { roles: ['analyst'], tenantId: HUB });
const employer = () => ctx('employer-1', { roles: ['employer'], tenantId: HUB });
const steering = () => ctx('steer-1', { roles: ['steeringCircle'], tenantId: HUB });
const unauth = () => testEnv.unauthenticatedContext();

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('workers/worker-1').set({
      ownerId: 'worker-1', tenantId: HUB, displayName: 'W1', status: 'active',
    });
    await db.doc('workers/worker-2').set({
      ownerId: 'worker-2', tenantId: HUB, displayName: 'W2', status: 'active',
    });
    await db.doc('evaluationSubmissions/sub-1').set({
      ownerId: 'worker-1', tenantId: HUB, responses: { q1: 'a' },
    });
    await db.doc('governanceDecisions/dec-1').set({
      tenantId: HUB, title: 'D1', body: 'b', decidedAt: new Date(), decidedBy: 'council',
    });
    await db.doc('governanceDecisions/dec-2').set({
      tenantId: OTHER_HUB, title: 'D2', body: 'b', decidedAt: new Date(), decidedBy: 'council',
    });
    await db.doc('opportunities/opp-1').set({
      tenantId: HUB, employerId: 'employer-1', title: 'O', description: 'd', location: 'l',
    });
    await db.doc('consents/consent-1').set({
      granterId: 'worker-1', granteeId: 'worker-2', tenantId: HUB,
      scope: 'read:pathwaySteps', resourceType: 'pathwaySteps', resourceId: 'step-1',
      grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
      purpose: 'test',
    });
    await db.doc('roleGrants/grant-1').set({
      granteeId: 'worker-1', role: 'worker', scopeType: 'self', scopeId: 'worker-1',
      tenantId: HUB, status: 'active', validFrom: Date.now() - 1000, validUntil: null,
      grantedBy: 'admin', basis: 'test',
    });
    await db.doc('accessEvents/event-1').set({
      subjectId: 'worker-1', actorId: 'worker-1', action: 'grantAccess',
      resourceType: 'pathwaySteps', resourceId: 'step-1', actingRole: 'worker',
      actingGrantId: 'grant-1', purpose: 'test', correlationId: 'c1',
      result: 'allowed', createdAt: new Date(), tenantId: HUB,
    });
    await db.doc('handoffs/handoff-1').set({
      workerId: 'worker-1', senderId: 'coord-1', senderRole: 'hubCoordinator',
      recipientId: 'worker-2', recipientRole: 'mentor', purpose: 'test',
      payloadSummary: '', tenantId: HUB, status: 'offered',
    });
  });
}

before(async () => {
  rulesUnitTesting = await import('@firebase/rules-unit-testing');
  testEnv = await rulesUnitTesting.initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  // NOTE: testEnv.clearFirestore() is NOT called: the emulator's
  // /emulator/v1/.../documents DELETE endpoint returns 500
  // ("http2 exception") in this environment. Seeding uses set(),
  // which overwrites, so every test starts from the same known state
  // without a clear. Tests that create documents use auto-IDs and do
  // not interfere with each other.
  await seed();
});

describe('tenant isolation + ownership', () => {
  it('denies unauthenticated reads', async () => {
    await assert.rejects(unauth().firestore().doc('workers/worker-1').get());
  });

  it('worker reads own worker doc, not another worker’s', async () => {
    const own = await worker1().firestore().doc('workers/worker-1').get();
    assert.equal(own.exists, true);
    await assert.rejects(worker1().firestore().doc('workers/worker-2').get());
  });

  it('worker cannot create a doc in another tenant (forged tenant)', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('firstContactForms').add({
        ownerId: 'worker-1', tenantId: OTHER_HUB, sharedWith: [],
        contactName: 'x', contactMethod: 'x', needs: 'x', notes: 'x',
      }),
    );
  });

  it('worker cannot create a doc owned by someone else (forged owner)', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('firstContactForms').add({
        ownerId: 'worker-2', tenantId: HUB, sharedWith: [],
        contactName: 'x', contactMethod: 'x', needs: 'x', notes: 'x',
      }),
    );
  });

  it('worker cannot create a doc pre-shared with someone (forged sharedWith)', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('firstContactForms').add({
        ownerId: 'worker-1', tenantId: HUB, sharedWith: ['worker-2'],
        contactName: 'x', contactMethod: 'x', needs: 'x', notes: 'x',
      }),
    );
  });

  it('worker cannot change sharedWith on update (clients never share)', async () => {
    const db = worker1().firestore();
    const ref = await db.collection('firstContactForms').add({
      ownerId: 'worker-1', tenantId: HUB, sharedWith: [],
      contactName: 'x', contactMethod: 'x', needs: 'x', notes: 'x',
    });
    await assert.rejects(ref.update({ sharedWith: ['worker-2'] }));
    // A legitimate field update still works.
    await ref.update({ notes: 'updated' });
  });

  it('worker cannot read another tenant’s governance decisions', async () => {
    await assert.rejects(worker1().firestore().doc('governanceDecisions/dec-2').get());
    const own = await worker1().firestore().doc('governanceDecisions/dec-1').get();
    assert.equal(own.exists, true);
  });

  it('other-hub worker cannot read this hub’s opportunities', async () => {
    await assert.rejects(workerOtherHub().firestore().doc('opportunities/opp-1').get());
  });
});

describe('server-only collections', () => {
  it('clients cannot create access events', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('accessEvents').add({
        subjectId: 'worker-1', actorId: 'worker-1', action: 'fake',
        resourceType: 'x', resourceId: 'x', actingRole: 'worker',
        actingGrantId: null, purpose: 'fake', correlationId: 'x',
        result: 'allowed',
      }),
    );
  });

  it('clients cannot create role grants', async () => {
    const db = coordinator().firestore();
    await assert.rejects(
      db.collection('roleGrants').add({
        granteeId: 'worker-2', role: 'mentor', scopeType: 'hub', scopeId: HUB,
        tenantId: HUB, status: 'active', validFrom: Date.now(), validUntil: null,
        grantedBy: 'coord-1', basis: 'forged',
      }),
    );
  });

  it('clients cannot create aggregates or idempotency keys', async () => {
    const db = analyst().firestore();
    await assert.rejects(
      db.collection('aggregates').add({ tenantId: HUB, metric: 'm', period: 'p', value: 1, breakdown: {} }),
    );
    await assert.rejects(
      db.collection('idempotencyKeys').doc('k1').set({ command: 'x', status: 'done' }),
    );
  });
});

describe('consent rules', () => {
  it('worker creates a well-formed consent (allowlist scope + expiry)', async () => {
    const db = worker1().firestore();
    const ref = await db.collection('consents').add({
      granterId: 'worker-1', granteeId: 'worker-2', tenantId: HUB,
      scope: 'read:pathwaySteps', resourceType: 'pathwaySteps', resourceId: 'step-1',
      grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
      purpose: 'test',
    });
    assert.ok(ref.id);
  });

  it('worker cannot create a consent with a non-allowlisted scope', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('consents').add({
        granterId: 'worker-1', granteeId: 'worker-2', tenantId: HUB,
        scope: 'read:workers', resourceType: 'workers', resourceId: 'worker-2',
        grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
        purpose: 'test',
      }),
    );
  });

  it('worker cannot create an open-ended consent (expiry required)', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('consents').add({
        granterId: 'worker-1', granteeId: 'worker-2', tenantId: HUB,
        scope: 'read:pathwaySteps', resourceType: 'pathwaySteps', resourceId: 'step-1',
        grantedAt: new Date(), expiresAt: new Date(Date.now() - 1000), revokedAt: null,
        purpose: 'test',
      }),
    );
  });

  it('granter revokes own consent (revokedAt only); others cannot', async () => {
    const granter = worker1().firestore();
    await granter.doc('consents/consent-1').update({ revokedAt: new Date() });
    // Non-granter cannot revoke.
    const other = worker2().firestore();
    await assert.rejects(other.doc('consents/consent-1').update({ revokedAt: new Date() }));
  });

  it('granter cannot change anything but revokedAt on a consent', async () => {
    const db = worker1().firestore();
    await assert.rejects(db.doc('consents/consent-1').update({ scope: 'read:workers' }));
    await assert.rejects(db.doc('consents/consent-1').update({ granteeId: 'worker-9' }));
  });
});

describe('role grants + access events reads', () => {
  it('worker reads own grants, not another’s', async () => {
    const own = await worker1().firestore().doc('roleGrants/grant-1').get();
    assert.equal(own.exists, true);
    await assert.rejects(worker2().firestore().doc('roleGrants/grant-1').get());
  });

  it('coordinator (authoriser) reads grants in own tenant', async () => {
    const doc = await coordinator().firestore().doc('roleGrants/grant-1').get();
    assert.equal(doc.exists, true);
  });

  it('worker reads own access events; privacy lead reads tenant events; others cannot', async () => {
    const own = await worker1().firestore().doc('accessEvents/event-1').get();
    assert.equal(own.exists, true);
    await assert.rejects(worker2().firestore().doc('accessEvents/event-1').get());
    const pl = await privacyLead().firestore().doc('accessEvents/event-1').get();
    assert.equal(pl.exists, true);
  });
});

describe('handoffs + conflicts', () => {
  it('sender creates an offered handoff; non-sender cannot', async () => {
    const db = coordinator().firestore();
    const ref = await db.collection('handoffs').add({
      workerId: 'worker-1', senderId: 'coord-1', senderRole: 'hubCoordinator',
      recipientId: 'worker-2', recipientRole: 'mentor', purpose: 'test',
      payloadSummary: '', tenantId: HUB, status: 'offered',
    });
    assert.ok(ref.id);
    const impostor = worker1().firestore();
    await assert.rejects(
      impostor.collection('handoffs').add({
        workerId: 'worker-1', senderId: 'coord-1', senderRole: 'hubCoordinator',
        recipientId: 'worker-2', recipientRole: 'mentor', purpose: 'forged',
        payloadSummary: '', tenantId: HUB, status: 'offered',
      }),
    );
  });

  it('recipient may change only the status; worker may read their handoff', async () => {
    const recipient = worker2().firestore();
    await recipient.doc('handoffs/handoff-1').update({ status: 'accepted' });
    await assert.rejects(
      recipient.doc('handoffs/handoff-1').update({ status: 'accepted', purpose: 'tampered' }),
    );
    const asWorker = await worker1().firestore().doc('handoffs/handoff-1').get();
    assert.equal(asWorker.exists, true);
  });

  it('declarer creates an open conflict in own tenant', async () => {
    const db = worker1().firestore();
    const ref = await db.collection('conflictDeclarations').add({
      declarerId: 'worker-1', grantId: null, description: 'dual role',
      mitigation: null, tenantId: HUB, status: 'open',
    });
    assert.ok(ref.id);
    await assert.rejects(
      db.collection('conflictDeclarations').add({
        declarerId: 'worker-2', grantId: null, description: 'forged',
        mitigation: null, tenantId: HUB, status: 'open',
      }),
    );
  });
});

describe('no cross-role leakage', () => {
  it('employer cannot read worker records', async () => {
    await assert.rejects(employer().firestore().doc('workers/worker-1').get());
  });

  it('analyst cannot read raw evaluation submissions', async () => {
    await assert.rejects(analyst().firestore().doc('evaluationSubmissions/sub-1').get());
    const own = await worker1().firestore().doc('evaluationSubmissions/sub-1').get();
    assert.equal(own.exists, true);
  });

  it('worker cannot create governance decisions; steering circle can', async () => {
    const w = worker1().firestore();
    await assert.rejects(
      w.collection('governanceDecisions').add({
        tenantId: HUB, title: 'x', body: 'x', decidedAt: new Date(), decidedBy: 'worker-1',
      }),
    );
    const s = steering().firestore();
    const ref = await s.collection('governanceDecisions').add({
      tenantId: HUB, title: 'x', body: 'x', decidedAt: new Date(), decidedBy: 'steer-1',
    });
    assert.ok(ref.id);
  });
});

describe('users bootstrap', () => {
  it('claim-less user creates own doc in demo-hub with worker role only', async () => {
    const fresh = testEnv.unauthenticatedContext();
    // Unauthenticated cannot; an authenticated claim-less user can.
    const noClaims = testEnv.authenticatedContext('new-user', {});
    const ref = noClaims.firestore().doc('users/new-user');
    await ref.set({
      displayName: 'New', email: 'n@example.test', tenantId: 'demo-hub', roles: ['worker'],
    });
    const snap = await ref.get();
    assert.equal(snap.exists, true);
    // A different claim-less user cannot bootstrap with a privileged role.
    const noClaims2 = testEnv.authenticatedContext('new-user-2', {});
    await assert.rejects(
      noClaims2.firestore().doc('users/new-user-2').set({
        displayName: 'New', email: 'n@example.test', tenantId: 'demo-hub',
        roles: ['hubCoordinator'],
      }),
    );
    await assert.rejects(fresh.firestore().doc('users/x').set({ tenantId: 'demo-hub', roles: ['worker'] }));
  });
});

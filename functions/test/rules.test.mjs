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
 * - handoff transitions (offered -> accepted/declined/closed only;
 *   senderRole must be a role the sender holds)
 * - cross-tenant list leak (authoriser disjuncts are tenant-pinned)
 * - tenant creation restricted to council / backboneLead
 * - national aggregate reads (analyst/council/backboneLead cross-hub;
 *   hub roles tenant-scoped); consent revocation is one-way
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
const council = () => ctx('council-1', { roles: ['council'], tenantId: HUB });
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

  it('worker creates a supervisionSessions consent (allowlist includes it)', async () => {
    const db = worker1().firestore();
    const ref = await db.collection('consents').add({
      granterId: 'worker-1', granteeId: 'worker-2', tenantId: HUB,
      scope: 'read:supervisionSessions', resourceType: 'supervisionSessions', resourceId: 'sess-1',
      grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
      purpose: 'supervision sharing',
    });
    assert.ok(ref.id);
  });

  it('consent scope must correspond to its resourceType (no cross-type scope)', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('consents').add({
        granterId: 'worker-1', granteeId: 'worker-2', tenantId: HUB,
        scope: 'read:supervisionSessions', resourceType: 'pathwaySteps', resourceId: 'step-1',
        grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
        purpose: 'mismatched scope',
      }),
    );
  });

  it('revocation is one-way: cannot un-revoke or re-revoke', async () => {
    const db = worker1().firestore();
    await db.doc('consents/consent-1').update({ revokedAt: new Date() });
    // Un-revoke (back to null) denied.
    await assert.rejects(db.doc('consents/consent-1').update({ revokedAt: null }));
    // Re-revoke (a new timestamp over an existing one) denied.
    await assert.rejects(db.doc('consents/consent-1').update({ revokedAt: new Date() }));
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

describe('production onboarding — no client bootstrap', () => {
  it('claim-less users CANNOT create users or persons docs (server-only)', async () => {
    const noClaims = testEnv.authenticatedContext('new-user', {});
    await assert.rejects(
      noClaims.firestore().doc('users/new-user').set({
        displayName: 'New', email: 'n@example.test', tenantId: HUB, roles: ['worker'],
      }),
    );
    await assert.rejects(
      noClaims.firestore().doc('persons/new-user').set({
        displayName: 'New', email: 'n@example.test', tenantId: HUB,
      }),
    );
    // Unauthenticated cannot either.
    const fresh = testEnv.unauthenticatedContext();
    await assert.rejects(fresh.firestore().doc('users/x').set({ tenantId: HUB, roles: ['worker'] }));
    await assert.rejects(fresh.firestore().doc('persons/x').set({ tenantId: HUB }));
  });

  it('authenticated users with claims CANNOT create their own users/persons docs', async () => {
    // Persons/users docs come only from the server (ensureMyPerson).
    // Even the owner, even with a claim tenant, cannot client-create.
    await assert.rejects(
      worker1().firestore().doc('persons/worker-1').set({
        displayName: 'W1', email: 'w1@example.test', tenantId: HUB,
      }),
    );
    await assert.rejects(
      worker1().firestore().doc('users/worker-1').set({
        displayName: 'W1', email: 'w1@example.test', tenantId: HUB, roles: ['worker'],
      }),
    );
  });
});

describe('handoff responder + transitions (B1)', () => {
  it('non-recipient cannot respond (worker subject and sender denied)', async () => {
    await assert.rejects(worker1().firestore().doc('handoffs/handoff-1').update({ status: 'accepted' }));
    await assert.rejects(coordinator().firestore().doc('handoffs/handoff-1').update({ status: 'accepted' }));
  });

  it('recipient can close an offered handoff (offered -> closed)', async () => {
    const sender = coordinator().firestore();
    const ref = await sender.collection('handoffs').add({
      workerId: 'worker-1', senderId: 'coord-1', senderRole: 'hubCoordinator',
      recipientId: 'worker-2', recipientRole: 'mentor', purpose: 'test',
      payloadSummary: '', tenantId: HUB, status: 'offered',
    });
    await worker2().firestore().doc(`handoffs/${ref.id}`).update({ status: 'closed' });
  });

  it('recipient cannot resurrect a declined handoff (declined -> accepted denied)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('handoffs/handoff-declined').set({
        workerId: 'worker-1', senderId: 'coord-1', senderRole: 'hubCoordinator',
        recipientId: 'worker-2', recipientRole: 'mentor', purpose: 'test',
        payloadSummary: '', tenantId: HUB, status: 'declined',
      });
    });
    await assert.rejects(
      worker2().firestore().doc('handoffs/handoff-declined').update({ status: 'accepted' }),
    );
  });

  it('create with impersonated senderRole denied (claimed role not held)', async () => {
    await assert.rejects(
      coordinator().firestore().collection('handoffs').add({
        workerId: 'worker-1', senderId: 'coord-1', senderRole: 'mentor',
        recipientId: 'worker-2', recipientRole: 'mentor', purpose: 'forged',
        payloadSummary: '', tenantId: HUB, status: 'offered',
      }),
    );
  });
});

describe('cross-tenant list leak (B2)', () => {
  async function seedOtherHub() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('roleGrants/grant-other').set({
        granteeId: 'worker-9', role: 'worker', scopeType: 'self', scopeId: 'worker-9',
        tenantId: OTHER_HUB, status: 'active', validFrom: Date.now() - 1000, validUntil: null,
        grantedBy: 'admin', basis: 'test',
      });
      await db.doc('complaints/complaint-other').set({
        complainantId: 'worker-9', tenantId: OTHER_HUB, status: 'open', body: 'x',
      });
      await db.doc('accessEvents/event-other').set({
        subjectId: 'worker-9', actorId: 'worker-9', action: 'grantAccess',
        resourceType: 'pathwaySteps', resourceId: 'step-1', actingRole: 'worker',
        actingGrantId: 'grant-other', purpose: 'test', correlationId: 'c2',
        result: 'allowed', createdAt: new Date(), tenantId: OTHER_HUB,
      });
    });
  }

  it('authoriser cannot list cross-tenant role grants / complaints / access events', async () => {
    await seedOtherHub();
    await assert.rejects(
      coordinator().firestore().collection('roleGrants').where('tenantId', '==', OTHER_HUB).get(),
    );
    await assert.rejects(
      coordinator().firestore().collection('complaints').where('tenantId', '==', OTHER_HUB).get(),
    );
    await assert.rejects(
      privacyLead().firestore().collection('accessEvents').where('tenantId', '==', OTHER_HUB).get(),
    );
  });

  it('authoriser CAN list own-tenant role grants (positive control)', async () => {
    const snap = await coordinator().firestore().collection('roleGrants').where('tenantId', '==', HUB).get();
    assert.ok(snap.docs.length >= 1);
  });
});

describe('tenant creation (B3)', () => {
  it('claim-less and non-council users cannot create tenants; council can', async () => {
    const noClaims = testEnv.authenticatedContext('noclaims-1', {});
    await assert.rejects(noClaims.firestore().doc('tenants/tenant-x').set({ name: 'X' }));
    await assert.rejects(coordinator().firestore().doc('tenants/tenant-x').set({ name: 'X' }));
    await council().firestore().doc('tenants/tenant-council').set({ name: 'Council hub' });
    const snap = await council().firestore().doc('tenants/tenant-council').get();
    assert.equal(snap.exists, true);
  });
});

describe('national aggregate reads (B4)', () => {
  async function seedAggregates() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('aggregates/agg-other').set({
        tenantId: OTHER_HUB, metric: 'evaluation:q1', period: '2026-10-14',
        value: 10, breakdown: { answer: 'a' }, createdAt: new Date(),
      });
      await db.doc('aggregates/agg-hub').set({
        tenantId: HUB, metric: 'evaluation:q1', period: '2026-10-14',
        value: 12, breakdown: { answer: 'a' }, createdAt: new Date(),
      });
      await db.doc('aggregateReleases/release-other').set({
        tenantId: OTHER_HUB, metric: 'evaluation:q1', period: '2026-10-14',
        releasedAt: new Date(),
      });
    });
  }

  it('analyst CAN read cross-hub aggregates and releases', async () => {
    await seedAggregates();
    const agg = await analyst().firestore().doc('aggregates/agg-other').get();
    assert.equal(agg.exists, true);
    const rel = await analyst().firestore().doc('aggregateReleases/release-other').get();
    assert.equal(rel.exists, true);
  });

  it('hub role CANNOT read another hub aggregates; CAN read own-hub aggregates', async () => {
    await seedAggregates();
    await assert.rejects(coordinator().firestore().doc('aggregates/agg-other').get());
    const own = await coordinator().firestore().doc('aggregates/agg-hub').get();
    assert.equal(own.exists, true);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 slice scenarios
// ---------------------------------------------------------------------------

describe('supervision sessions (Phase 2)', () => {
  async function seedSession() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('supervisionSessions/sess-1').set({
        ownerId: 'worker-1', supervisorId: 'worker-2', tenantId: HUB,
        sharedWith: [], notes: 'n', date: new Date(),
      });
      await db.doc('supervisionSessions/sess-shared').set({
        ownerId: 'worker-1', supervisorId: 'worker-2', tenantId: HUB,
        sharedWith: ['worker-2'], notes: 'n', date: new Date(),
      });
    });
  }

  it('owner creates / reads / updates / deletes their own session', async () => {
    const db = worker1().firestore();
    const ref = await db.collection('supervisionSessions').add({
      ownerId: 'worker-1', supervisorId: 'worker-2', tenantId: HUB,
      sharedWith: [], notes: 'n', date: new Date(),
    });
    assert.ok(ref.id);
    const snap = await ref.get();
    assert.equal(snap.exists, true);
    await ref.update({ notes: 'updated' });
    await ref.delete();
  });

  it('supervisorId alone confers NO read — only sharedWith does', async () => {
    await seedSession();
    // worker-2 IS the supervisorId on sess-1 but is NOT in sharedWith.
    await assert.rejects(worker2().firestore().doc('supervisionSessions/sess-1').get());
    // On sess-shared, worker-2 is in sharedWith (via a live consent) — reads.
    const shared = await worker2().firestore().doc('supervisionSessions/sess-shared').get();
    assert.equal(shared.exists, true);
  });

  it('non-shared, non-owner cannot read a supervision session', async () => {
    await seedSession();
    const outsider = ctx('worker-3', { roles: ['worker'], tenantId: HUB });
    await assert.rejects(outsider.firestore().doc('supervisionSessions/sess-1').get());
  });

  it('client cannot create a session pre-shared, and owner cannot change sharedWith', async () => {
    const db = worker1().firestore();
    await assert.rejects(
      db.collection('supervisionSessions').add({
        ownerId: 'worker-1', supervisorId: 'worker-2', tenantId: HUB,
        sharedWith: ['worker-2'], notes: 'n', date: new Date(),
      }),
    );
    await seedSession();
    await assert.rejects(
      db.doc('supervisionSessions/sess-1').update({ sharedWith: ['worker-2'] }),
    );
    // A legitimate field update still works.
    await db.doc('supervisionSessions/sess-1').update({ notes: 'ok' });
  });
});

describe('mentorships rules (Phase 2 completion)', () => {
  const mentor = () => ctx('mentor-1', { roles: ['mentor'], tenantId: HUB });
  const mentorOtherHub = () => ctx('mentor-9', { roles: ['mentor'], tenantId: OTHER_HUB });

  async function seedPair() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc('mentorships/ment-pair-1').set({
        tenantId: HUB, participantIds: ['mentor-1', 'worker-1'], sharedWith: [], notes: 'n',
      });
      await db.doc('mentorships/ment-pair-shared').set({
        tenantId: HUB, participantIds: ['mentor-2', 'worker-1'], sharedWith: ['mentor-1'], notes: 'n',
      });
    });
  }

  it('participant creates / reads / updates notes on their mentorship', async () => {
    const ref = await mentor().firestore().collection('mentorships').add({
      tenantId: HUB, participantIds: ['mentor-1', 'worker-1'], sharedWith: [], notes: 'n',
    });
    assert.ok(ref.id);
    assert.equal((await ref.get()).exists, true);
    await ref.update({ notes: 'updated' });
  });

  it('a non-participant cannot create a mentorship, and a mentorship is exactly a pair', async () => {
    const db = mentor().firestore();
    // Caller not in participantIds.
    await assert.rejects(
      db.collection('mentorships').add({
        tenantId: HUB, participantIds: ['mentor-2', 'worker-1'], sharedWith: [], notes: 'n',
      }),
    );
    // One participant.
    await assert.rejects(
      db.collection('mentorships').add({
        tenantId: HUB, participantIds: ['mentor-1'], sharedWith: [], notes: 'n',
      }),
    );
    // Three participants.
    await assert.rejects(
      db.collection('mentorships').add({
        tenantId: HUB, participantIds: ['mentor-1', 'worker-1', 'worker-2'], sharedWith: [], notes: 'n',
      }),
    );
    // Duplicate participant.
    await assert.rejects(
      db.collection('mentorships').add({
        tenantId: HUB, participantIds: ['mentor-1', 'mentor-1'], sharedWith: [], notes: 'n',
      }),
    );
  });

  it('client cannot create a mentorship pre-shared, and participant cannot change the core', async () => {
    const db = mentor().firestore();
    await assert.rejects(
      db.collection('mentorships').add({
        tenantId: HUB, participantIds: ['mentor-1', 'worker-1'],
        sharedWith: ['worker-2'], notes: 'n',
      }),
    );
    await seedPair();
    const ref = db.doc('mentorships/ment-pair-1');
    await assert.rejects(ref.update({ participantIds: ['mentor-1'] }));
    await assert.rejects(ref.update({ sharedWith: ['worker-2'] }));
    await assert.rejects(ref.update({ tenantId: OTHER_HUB }));
    // A legitimate notes update still works.
    await ref.update({ notes: 'ok' });
  });

  it('non-participant cannot read; sharedWith reader can; cross-tenant cannot read', async () => {
    await seedPair();
    const outsider = ctx('mentor-3', { roles: ['mentor'], tenantId: HUB });
    await assert.rejects(outsider.firestore().doc('mentorships/ment-pair-1').get());
    // mentor-1 is in sharedWith on ment-pair-shared, not in participantIds.
    const shared = await mentor().firestore().doc('mentorships/ment-pair-shared').get();
    assert.equal(shared.exists, true);
    await assert.rejects(mentorOtherHub().firestore().doc('mentorships/ment-pair-1').get());
  });

  it('participant can list their mentorships; non-participant list is empty', async () => {
    await seedPair();
    const mine = await mentor().firestore().collection('mentorships')
      .where('participantIds', 'array-contains', 'mentor-1')
      .where('tenantId', '==', HUB)
      .get();
    assert.ok(mine.docs.some((d) => d.id === 'ment-pair-1'));
    const outsider = ctx('mentor-3', { roles: ['mentor'], tenantId: HUB });
    const none = await outsider.firestore().collection('mentorships')
      .where('participantIds', 'array-contains', 'mentor-3')
      .where('tenantId', '==', HUB)
      .get();
    assert.equal(none.docs.length, 0);
  });

  it('either participant may end (delete) the mentorship; a non-participant may not', async () => {
    await seedPair();
    const outsider = ctx('mentor-3', { roles: ['mentor'], tenantId: HUB });
    await assert.rejects(outsider.firestore().doc('mentorships/ment-pair-1').delete());
    await mentor().firestore().doc('mentorships/ment-pair-1').delete();
    const gone = await testEnv.withSecurityRulesDisabled(async (context) =>
      context.firestore().doc('mentorships/ment-pair-1').get(),
    );
    assert.equal(gone.exists, false);
  });

  it('worker creates a mentorships consent (allowlist includes it)', async () => {
    const ref = await worker1().firestore().collection('consents').add({
      granterId: 'worker-1', granteeId: 'mentor-1', tenantId: HUB,
      scope: 'read:mentorships', resourceType: 'mentorships', resourceId: 'ment-pair-1',
      grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
      purpose: 'peer mentorship',
    });
    assert.ok(ref.id);
  });
});

describe('persons creation (production onboarding)', () => {
  it('owner with claims CANNOT create their own persons doc (server-only)', async () => {
    await assert.rejects(
      worker1().firestore().doc('persons/worker-1').set({
        displayName: 'W1', email: 'w1@example.test', tenantId: HUB,
      }),
    );
  });

  it('claim-less users CANNOT create a persons doc directly (the server callable is the only path)', async () => {
    const noClaims = testEnv.authenticatedContext('noclaims-person', {});
    await assert.rejects(
      noClaims.firestore().doc('persons/noclaims-person').set({
        displayName: 'N', email: 'n@example.test', tenantId: HUB,
      }),
    );
  });

  it('one user cannot create another person’s doc', async () => {
    await assert.rejects(
      worker1().firestore().doc('persons/worker-2').set({
        displayName: 'Forged', email: 'f@example.test', tenantId: HUB,
      }),
    );
  });

  it('owner cannot change their persons tenantId', async () => {
    // Seed the doc via the rules-disabled context (server path), then
    // verify the owner cannot move it to another tenant.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('persons/worker-1').set({
        displayName: 'W1', email: 'w1@example.test', tenantId: HUB,
      });
    });
    const ref = worker1().firestore().doc('persons/worker-1');
    await assert.rejects(ref.update({ tenantId: OTHER_HUB }));
  });
});

describe('consented sharing via sharedWith (Phase 2)', () => {
  it('a grantee in sharedWith reads the shared doc; a non-grantee cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('pathwaySteps/step-shared').set({
        ownerId: 'worker-1', tenantId: HUB, sharedWith: ['worker-2'],
        type: 'navigation', title: 't', status: 'in-progress',
      });
    });
    const shared = await worker2().firestore().doc('pathwaySteps/step-shared').get();
    assert.equal(shared.exists, true);
    const outsider = ctx('worker-3', { roles: ['worker'], tenantId: HUB });
    await assert.rejects(outsider.firestore().doc('pathwaySteps/step-shared').get());
  });
});

describe('handoff slice: coordinator offers, navigator accepts (Phase 2)', () => {
  const navigator = () => ctx('nav-1', { roles: ['navigator'], tenantId: HUB });

  it('coordinator offers a handoff to a navigator; navigator accepts; worker reads it', async () => {
    const ref = await coordinator().firestore().collection('handoffs').add({
      workerId: 'worker-1', senderId: 'coord-1', senderRole: 'hubCoordinator',
      recipientId: 'nav-1', recipientRole: 'navigator', purpose: 'wayfinding support',
      payloadSummary: 'first-contact navigation', tenantId: HUB, status: 'offered',
    });
    assert.ok(ref.id);
    await navigator().firestore().doc(`handoffs/${ref.id}`).update({ status: 'accepted' });
    const asWorker = await worker1().firestore().doc(`handoffs/${ref.id}`).get();
    assert.equal(asWorker.exists, true);
    assert.equal(asWorker.data().status, 'accepted');
  });

  it('navigator lists only own-tenant handoffs (cross-tenant list denied)', async () => {
    await assert.rejects(
      navigator().firestore().collection('handoffs').where('tenantId', '==', OTHER_HUB).get(),
    );
  });
});

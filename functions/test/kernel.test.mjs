/**
 * Pure-logic tests for the Role Kernel (kernel.ts).
 * No emulator, no network: these test the authorization core that
 * every callable and every rule depends on.
 *
 * Run:  npm run test:kernel   (builds first, then node --test)
 *
 * These tests pin the REAL kernel API (ScopeType self|hub|network|
 * |employer; RoleGrant validFrom/validUntil; transitionHandoff takes
 * an ACTION; migrateLegacyRole THROWS on ambiguity).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// lib/ is compiled CommonJS (tsconfig module: NodeNext, no "type": "module").
const require = createRequire(import.meta.url);
const {
  authorizeCommand,
  buildAccessEvent,
  deriveConsentScope,
  evaluateGrantRequest,
  grantCoversScope,
  isGrantLive,
  isValidIdempotencyKey,
  mayAuthorizeGrant,
  migrateLegacyRole,
  selectDefaultGrant,
  transitionHandoff,
  validateGrantTransition,
  validateHandoffParties,
} = require('../lib/kernel.js');

const TENANT = 'hub-1';
const NOW = Date.now();

function liveGrant(overrides = {}) {
  return {
    id: 'grant-1',
    granteeId: 'user-1',
    role: 'worker',
    scopeType: 'self',
    scopeId: 'user-1',
    tenantId: TENANT,
    status: 'active',
    validFrom: NOW - 60_000,
    validUntil: null,
    grantedBy: 'admin',
    basis: 'test',
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    authenticated: true,
    uid: 'user-1',
    actingGrant: liveGrant(),
    claimsRoles: ['worker'],
    useClaimsFallback: false,
    command: 'grantAccess',
    highRisk: true,
    scope: { tenantId: TENANT, scopeType: 'self', scopeId: 'user-1' },
    relationship: 'owner',
    relationshipRequired: true,
    purpose: 'share a record',
    consentRequired: true,
    consentLive: true,
    ...overrides,
  };
}

describe('six-part authorization (authorizeCommand)', () => {
  it('allows when all six parts are present', () => {
    const d = authorizeCommand(baseInput());
    assert.equal(d.allowed, true);
    assert.equal(d.reason, 'ok');
    assert.deepEqual(Object.values(d.checks), [true, true, true, true, true, true]);
  });

  it('denies unauthenticated callers', () => {
    const d = authorizeCommand(baseInput({ authenticated: false, uid: null }));
    assert.equal(d.allowed, false);
    assert.match(d.reason, /unauthenticated/);
  });

  it('denies high-risk commands without a live grant', () => {
    const d = authorizeCommand(baseInput({ actingGrant: null, useClaimsFallback: false }));
    assert.equal(d.allowed, false);
    assert.match(d.reason, /grant-required/);
  });

  it('denies when the acting grant is suspended', () => {
    const d = authorizeCommand(
      baseInput({ actingGrant: liveGrant({ status: 'suspended' }) }),
    );
    assert.equal(d.allowed, false);
    assert.match(d.reason, /grant/);
  });

  it('denies when the acting grant is outside its validity window', () => {
    const d = authorizeCommand(
      baseInput({ actingGrant: liveGrant({ validUntil: NOW - 1000 }) }),
    );
    assert.equal(d.allowed, false);
    const future = authorizeCommand(
      baseInput({ actingGrant: liveGrant({ validFrom: NOW + 60_000 }) }),
    );
    assert.equal(future.allowed, false);
  });

  it('denies when the grant does not cover the requested scope', () => {
    const d = authorizeCommand(
      baseInput({ scope: { tenantId: 'hub-2', scopeType: 'hub', scopeId: 'hub-2' } }),
    );
    assert.equal(d.allowed, false);
    assert.match(d.reason, /scope-mismatch/);
  });

  it('denies when a required relationship is missing', () => {
    const d = authorizeCommand(baseInput({ relationship: 'none' }));
    assert.equal(d.allowed, false);
    assert.match(d.reason, /no-relationship/);
  });

  it('denies when purpose is missing or blank', () => {
    assert.equal(authorizeCommand(baseInput({ purpose: '' })).allowed, false);
    assert.equal(authorizeCommand(baseInput({ purpose: '   ' })).allowed, false);
    assert.equal(authorizeCommand(baseInput({ purpose: null })).allowed, false);
  });

  it('denies when consent is required but not live', () => {
    const d = authorizeCommand(baseInput({ consentLive: false }));
    assert.equal(d.allowed, false);
    assert.match(d.reason, /consent-required/);
  });

  it('denies systemAdmin acting grants for every business command', () => {
    const d = authorizeCommand(
      baseInput({
        actingGrant: liveGrant({
          role: 'systemAdmin',
          scopeType: 'network',
          scopeId: 'network',
        }),
        scope: { tenantId: TENANT, scopeType: 'network', scopeId: 'network' },
        command: 'grantAccess',
      }),
    );
    assert.equal(d.allowed, false);
    assert.match(d.reason, /operational-only/);
  });

  it('denies systemAdmin-only claims fallback', () => {
    const d = authorizeCommand(
      baseInput({
        actingGrant: null,
        useClaimsFallback: true,
        claimsRoles: ['systemAdmin'],
        highRisk: false,
        command: 'getMyGrants',
      }),
    );
    assert.equal(d.allowed, false);
    assert.match(d.reason, /operational-only/);
  });

  it('allows claims fallback for low-risk commands, denies it for high-risk', () => {
    const low = authorizeCommand(
      baseInput({
        actingGrant: null, useClaimsFallback: true, highRisk: false,
        command: 'getMyGrants', consentRequired: false, consentLive: null,
      }),
    );
    assert.equal(low.allowed, true);
    assert.equal(low.migrationFallback, true);
    const high = authorizeCommand(
      baseInput({ actingGrant: null, useClaimsFallback: true, highRisk: true }),
    );
    assert.equal(high.allowed, false);
  });
});

describe('grant liveness + default selection', () => {
  it('isGrantLive: active + inside validity window only', () => {
    assert.equal(isGrantLive(liveGrant()), true);
    assert.equal(isGrantLive(liveGrant({ status: 'proposed' })), false);
    assert.equal(isGrantLive(liveGrant({ status: 'suspended' })), false);
    assert.equal(isGrantLive(liveGrant({ validUntil: NOW - 1 })), false);
    assert.equal(isGrantLive(liveGrant({ validFrom: NOW + 60_000 })), false);
    assert.equal(isGrantLive(liveGrant({ validUntil: NOW + 60_000 })), true);
  });

  it('selectDefaultGrant: worker first, else least-privilege rank', () => {
    const grants = [
      liveGrant({ id: 'g-coord', role: 'hubCoordinator', scopeType: 'hub', scopeId: TENANT }),
      liveGrant({ id: 'g-mentor', role: 'mentor', scopeType: 'hub', scopeId: TENANT }),
    ];
    assert.equal(selectDefaultGrant(grants)?.id, 'g-mentor');
    const withWorker = [
      ...grants,
      liveGrant({ id: 'g-worker', role: 'worker' }),
    ];
    assert.equal(selectDefaultGrant(withWorker)?.id, 'g-worker');
    assert.equal(selectDefaultGrant([]), null);
    assert.equal(
      selectDefaultGrant([liveGrant({ status: 'suspended' })]),
      null,
    );
  });
});

describe('grant lifecycle (validateGrantTransition)', () => {
  const grant = liveGrant();
  it('allows proposed→active, active→suspended/expired/revoked', () => {
    assert.equal(validateGrantTransition('proposed', 'active', 'approver-1', grant).ok, true);
    assert.equal(validateGrantTransition('active', 'suspended', 'approver-1', grant).ok, true);
    assert.equal(validateGrantTransition('active', 'expired', 'approver-1', grant).ok, true);
    assert.equal(validateGrantTransition('active', 'revoked', 'approver-1', grant).ok, true);
    assert.equal(validateGrantTransition('suspended', 'active', 'approver-1', grant).ok, true);
  });

  it('forbids terminal transitions and non-transitions', () => {
    assert.equal(validateGrantTransition('revoked', 'active', 'approver-1', grant).ok, false);
    assert.equal(validateGrantTransition('expired', 'active', 'approver-1', grant).ok, false);
    assert.equal(validateGrantTransition('proposed', 'expired', 'approver-1', grant).ok, false);
    assert.equal(validateGrantTransition('active', 'proposed', 'approver-1', grant).ok, false);
  });

  it('forbids self-approval (activation by the grant subject)', () => {
    const self = validateGrantTransition('proposed', 'active', 'user-1', grant);
    assert.equal(self.ok, false);
    assert.match(self.reason, /self-approval/);
  });
});

describe('separation of duties (evaluateGrantRequest)', () => {
  it('denies self-approval', () => {
    const e = evaluateGrantRequest({
      subjectId: 'user-1', approverId: 'user-1',
      requestedRole: 'mentor', subjectHeldRoles: ['worker'],
    });
    assert.equal(e.decision, 'deny');
  });

  it('denies researcher → systemAdmin', () => {
    const e = evaluateGrantRequest({
      subjectId: 'user-1', approverId: 'approver-1',
      requestedRole: 'systemAdmin', subjectHeldRoles: ['researcher'],
    });
    assert.equal(e.decision, 'deny');
  });

  it('flags employer + inside-role combinations for review', () => {
    const e1 = evaluateGrantRequest({
      subjectId: 'user-1', approverId: 'approver-1',
      requestedRole: 'employer', subjectHeldRoles: ['worker'],
    });
    assert.equal(e1.decision, 'needsReview');
    const e2 = evaluateGrantRequest({
      subjectId: 'user-1', approverId: 'approver-1',
      requestedRole: 'mentor', subjectHeldRoles: ['employer'],
    });
    assert.equal(e2.decision, 'needsReview');
  });

  it('flags operational + business combinations for review', () => {
    const e = evaluateGrantRequest({
      subjectId: 'user-1', approverId: 'approver-1',
      requestedRole: 'systemAdmin', subjectHeldRoles: ['privacyLead'],
    });
    assert.equal(e.decision, 'needsReview');
  });

  it('allows plain combinations', () => {
    const e = evaluateGrantRequest({
      subjectId: 'user-1', approverId: 'approver-1',
      requestedRole: 'mentor', subjectHeldRoles: ['worker'],
    });
    assert.equal(e.decision, 'allow');
  });
});

describe('grant authorization matrix (mayAuthorizeGrant)', () => {
  it('council and backboneLead act network-wide', () => {
    assert.equal(mayAuthorizeGrant('council', TENANT, 'hub-2'), true);
    assert.equal(mayAuthorizeGrant('backboneLead', TENANT, 'hub-2'), true);
  });

  it('hubCoordinator and steeringCircle act only within their own hub', () => {
    assert.equal(mayAuthorizeGrant('hubCoordinator', TENANT, TENANT), true);
    assert.equal(mayAuthorizeGrant('hubCoordinator', TENANT, 'hub-2'), false);
    assert.equal(mayAuthorizeGrant('steeringCircle', TENANT, TENANT), true);
    assert.equal(mayAuthorizeGrant('steeringCircle', TENANT, 'hub-2'), false);
  });

  it('analyst, privacyLead, worker, employer cannot authorize grants', () => {
    for (const role of ['analyst', 'privacyLead', 'worker', 'employer', 'mentor']) {
      assert.equal(mayAuthorizeGrant(role, TENANT, TENANT), false);
    }
  });
});

describe('scope coverage (grantCoversScope)', () => {
  it('network scope covers everything', () => {
    const network = liveGrant({ role: 'council', scopeType: 'network', scopeId: 'network' });
    assert.equal(grantCoversScope(network, { tenantId: 'hub-9', scopeType: 'hub', scopeId: 'hub-9' }), true);
  });

  it('hub scope covers its tenant only', () => {
    const hub = liveGrant({ role: 'hubCoordinator', scopeType: 'hub', scopeId: TENANT });
    assert.equal(grantCoversScope(hub, { tenantId: TENANT, scopeType: 'hub', scopeId: TENANT }), true);
    assert.equal(grantCoversScope(hub, { tenantId: 'hub-2', scopeType: 'hub', scopeId: 'hub-2' }), false);
  });

  it('self scope covers only the grantee', () => {
    const self = liveGrant();
    assert.equal(grantCoversScope(self, { tenantId: TENANT, scopeType: 'self', scopeId: 'user-1' }), true);
    assert.equal(grantCoversScope(self, { tenantId: TENANT, scopeType: 'self', scopeId: 'user-2' }), false);
    assert.equal(grantCoversScope(self, { tenantId: TENANT, scopeType: 'hub', scopeId: TENANT }), false);
  });

  it('employer scope covers only its employer', () => {
    const emp = liveGrant({ role: 'employer', scopeType: 'employer', scopeId: 'employer-1' });
    assert.equal(grantCoversScope(emp, { tenantId: TENANT, scopeType: 'employer', scopeId: 'employer-1' }), true);
    assert.equal(grantCoversScope(emp, { tenantId: TENANT, scopeType: 'employer', scopeId: 'employer-2' }), false);
  });
});

describe('sharing allowlist', () => {
  it('maps the four shareable types to their scopes', () => {
    assert.equal(deriveConsentScope('firstContactForms'), 'read:firstContactForms');
    assert.equal(deriveConsentScope('pathwaySteps'), 'read:pathwaySteps');
    assert.equal(deriveConsentScope('certificationNavigation'), 'read:certificationNavigation');
    assert.equal(deriveConsentScope('supervisionSessions'), 'read:supervisionSessions');
  });

  it('returns null for anything else (deny by default)', () => {
    assert.equal(deriveConsentScope('workers'), null);
    assert.equal(deriveConsentScope('evaluationSubmissions'), null);
    assert.equal(deriveConsentScope('accessEvents'), null);
    assert.equal(deriveConsentScope(''), null);
  });
});

describe('handoff state machine + parties', () => {
  it('allows draft→offer, offered→accept/decline/close, accepted→close', () => {
    assert.equal(transitionHandoff('draft', 'offer').ok, true);
    assert.equal(transitionHandoff('draft', 'offer').to, 'offered');
    assert.equal(transitionHandoff('offered', 'accept').to, 'accepted');
    assert.equal(transitionHandoff('offered', 'decline').to, 'declined');
    assert.equal(transitionHandoff('offered', 'close').to, 'closed');
    assert.equal(transitionHandoff('accepted', 'close').to, 'closed');
    assert.equal(transitionHandoff('draft', 'close').to, 'closed');
  });

  it('forbids resurrecting declined/closed handoffs and wrong actions', () => {
    assert.equal(transitionHandoff('declined', 'accept').ok, false);
    assert.equal(transitionHandoff('declined', 'close').ok, false);
    assert.equal(transitionHandoff('closed', 'offer').ok, false);
    assert.equal(transitionHandoff('accepted', 'decline').ok, false);
    assert.equal(transitionHandoff('offered', 'offer').ok, false);
  });

  it('validates handoff parties', () => {
    assert.equal(
      validateHandoffParties({ workerId: 'w', senderId: 's', recipientId: 'r' }).ok,
      true,
    );
    assert.equal(
      validateHandoffParties({ workerId: 'w', senderId: 'w', recipientId: 'r' }).ok,
      false,
    );
    assert.equal(
      validateHandoffParties({ workerId: 'w', senderId: 's', recipientId: 'w' }).ok,
      false,
    );
    assert.equal(
      validateHandoffParties({ workerId: 'w', senderId: 's', recipientId: 's' }).ok,
      false,
    );
  });
});

describe('idempotency keys', () => {
  it('accepts non-empty keys up to 128 chars', () => {
    assert.equal(isValidIdempotencyKey('123e4567-e89b-12d3-a456-426614174000'), true);
    assert.equal(isValidIdempotencyKey('short'), true);
    assert.equal(isValidIdempotencyKey('x'.repeat(128)), true);
  });

  it('rejects empty, overlong, and non-string keys', () => {
    assert.equal(isValidIdempotencyKey(''), false);
    assert.equal(isValidIdempotencyKey('x'.repeat(129)), false);
    assert.equal(isValidIdempotencyKey(null), false);
    assert.equal(isValidIdempotencyKey(undefined), false);
    assert.equal(isValidIdempotencyKey(42), false);
  });
});

describe('legacy migration map', () => {
  it('maps unambiguous legacy roles', () => {
    assert.equal(migrateLegacyRole('hubAdmin'), 'hubCoordinator');
    assert.equal(migrateLegacyRole('backboneAnalyst'), 'analyst');
    assert.equal(migrateLegacyRole('systemAdmin'), 'systemAdmin');
    assert.equal(migrateLegacyRole('worker'), 'worker');
  });

  it('resolves governance by scope hint', () => {
    assert.equal(migrateLegacyRole('governance', 'hub'), 'steeringCircle');
    assert.equal(migrateLegacyRole('governance', 'network'), 'council');
  });

  it('throws on ambiguous governance and unknown roles (never guesses)', () => {
    assert.throws(() => migrateLegacyRole('governance'), /Ambiguous/);
    assert.throws(() => migrateLegacyRole('governance', null), /Ambiguous/);
    assert.throws(() => migrateLegacyRole('superuser'), /Unknown legacy role/);
  });
});

describe('access events', () => {
  it('buildAccessEvent stamps acting role, grant, correlation, result', () => {
    const event = buildAccessEvent(
      {
        subjectId: 'user-1',
        actorId: 'user-1',
        action: 'grantAccess',
        resourceType: 'pathwaySteps',
        resourceId: 'step-1',
        actingRole: 'worker',
        actingGrantId: 'grant-1',
        purpose: 'share a record',
        correlationId: 'corr-1',
        result: 'allowed',
      },
      '2026-10-13T00:00:00.000Z',
    );
    assert.equal(event.actingRole, 'worker');
    assert.equal(event.actingGrantId, 'grant-1');
    assert.equal(event.correlationId, 'corr-1');
    assert.equal(event.result, 'allowed');
    assert.equal(event.createdAt, '2026-10-13T00:00:00.000Z');
  });
});

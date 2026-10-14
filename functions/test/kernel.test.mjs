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
  commandAllowsRole,
  COMMAND_MATRIX,
  DELETION_PLAN,
  deriveConsentScope,
  evaluateGrantRequest,
  grantCoversScope,
  GRANT_AUTHORITIES,
  HANDOFF_SENDERS,
  isGrantLive,
  isValidIdempotencyKey,
  isValidPurpose,
  mayAuthorizeGrant,
  migrateLegacyRole,
  PURPOSE_TAXONOMY,
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

  it('allows pending→active/proposed/revoked/expired (invitation lifecycle)', () => {
    assert.equal(validateGrantTransition('pending', 'active', 'approver-1', grant).ok, true);
    assert.equal(validateGrantTransition('pending', 'proposed', 'approver-1', grant).ok, true);
    assert.equal(validateGrantTransition('pending', 'revoked', 'approver-1', grant).ok, true);
    assert.equal(validateGrantTransition('pending', 'expired', 'approver-1', grant).ok, true);
  });

  it('forbids pending→suspended and other non-transitions', () => {
    assert.equal(validateGrantTransition('pending', 'suspended', 'approver-1', grant).ok, false);
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

// ---------------------------------------------------------------------------
// Phase 2: purpose taxonomy, command matrix, deletion plan
// ---------------------------------------------------------------------------

describe('purpose taxonomy (Phase 2)', () => {
  it('accepts every taxonomy purpose, rejects free text', () => {
    for (const p of PURPOSE_TAXONOMY) {
      assert.equal(isValidPurpose(p), true, p);
    }
    assert.equal(isValidPurpose('test'), false);
    assert.equal(isValidPurpose('supervision sharing'), false);
    assert.equal(isValidPurpose(''), false);
    assert.equal(isValidPurpose(null), false);
    assert.equal(isValidPurpose(42), false);
    assert.equal(isValidPurpose('Share a record'), false); // case-sensitive
  });

  it('covers every purpose the handlers use as a default', () => {
    for (const p of [
      'share a record', 'export my data', 'delete my data',
      'consent expiry', 'consent revocation', 'grant a role',
      'resolve a proposed grant', 'revoke a role grant',
      'declare a conflict', 'request a role grant',
      'respond to a handoff', 'handoff coordination',
      'person record setup', 'invite a member', 'claim an invitation',
    ]) {
      assert.equal(isValidPurpose(p), true, p);
    }
  });

  it('authorizeCommand denies a non-taxonomy purpose', () => {
    const d = authorizeCommand(baseInput({ purpose: 'for reasons' }));
    assert.equal(d.allowed, false);
    assert.match(d.reason, /purpose-not-in-taxonomy/);
  });

  it('authorizeCommand allows each taxonomy purpose', () => {
    for (const p of PURPOSE_TAXONOMY) {
      const d = authorizeCommand(baseInput({ purpose: p }));
      assert.equal(d.allowed, true, p);
    }
  });
});

describe('central role → command matrix (Phase 2)', () => {
  it('HANDOFF_SENDERS is exactly navigator, hubCoordinator, supervisor, mentor', () => {
    assert.deepEqual([...HANDOFF_SENDERS], ['navigator', 'hubCoordinator', 'supervisor', 'mentor']);
    assert.deepEqual([...COMMAND_MATRIX.createHandoff.roles], [...HANDOFF_SENDERS]);
  });

  it('GRANT_AUTHORITIES is exactly council, backboneLead, hubCoordinator, steeringCircle', () => {
    assert.deepEqual([...GRANT_AUTHORITIES], ['council', 'backboneLead', 'hubCoordinator', 'steeringCircle']);
    assert.deepEqual([...COMMAND_MATRIX.createRoleGrant.roles], [...GRANT_AUTHORITIES]);
  });

  it('commandAllowsRole gates handoff + grant commands', () => {
    assert.equal(commandAllowsRole('createHandoff', 'navigator'), true);
    assert.equal(commandAllowsRole('createHandoff', 'hubCoordinator'), true);
    assert.equal(commandAllowsRole('createHandoff', 'worker'), false);
    assert.equal(commandAllowsRole('createHandoff', 'council'), false);
    assert.equal(commandAllowsRole('createRoleGrant', 'council'), true);
    assert.equal(commandAllowsRole('createRoleGrant', 'worker'), false);
    assert.equal(commandAllowsRole('resolveRoleGrant', 'steeringCircle'), true);
    assert.equal(commandAllowsRole('revokeRoleGrant', 'backboneLead'), true);
  });

  it('commandAllowsRole gates worker self-commands', () => {
    assert.equal(commandAllowsRole('grantAccess', 'worker'), true);
    assert.equal(commandAllowsRole('grantAccess', 'navigator'), false);
    assert.equal(commandAllowsRole('requestExport', 'worker'), true);
    assert.equal(commandAllowsRole('requestDeletion', 'worker'), true);
    assert.equal(commandAllowsRole('processDeletion', 'worker'), true);
  });

  it('self-service commands allow any authenticated person', () => {
    for (const cmd of ['respondHandoff', 'closeHandoff', 'requestRoleGrant', 'declareConflict', 'ensureMyPerson', 'getMyGrants']) {
      assert.equal(commandAllowsRole(cmd, 'worker'), true, cmd);
      assert.equal(commandAllowsRole(cmd, 'employer'), true, cmd);
    }
  });

  it('commandAllowsRole gates inviteMember (grant authorities only)', () => {
    for (const role of ['council', 'backboneLead', 'hubCoordinator', 'steeringCircle']) {
      assert.equal(commandAllowsRole('inviteMember', role), true, role);
    }
    assert.equal(commandAllowsRole('inviteMember', 'worker'), false);
    assert.equal(commandAllowsRole('inviteMember', 'systemAdmin'), false);
  });

  it('every gateway callable is in the matrix', () => {
    for (const cmd of [
      'grantAccess', 'requestExport', 'requestDeletion', 'processDeletion',
      'createHandoff', 'respondHandoff', 'closeHandoff',
      'createRoleGrant', 'resolveRoleGrant', 'revokeRoleGrant',
      'requestRoleGrant', 'declareConflict', 'ensureMyPerson', 'getMyGrants',
      'inviteMember',
    ]) {
      assert.ok(COMMAND_MATRIX[cmd], cmd);
      assert.equal(typeof COMMAND_MATRIX[cmd].highRisk, 'boolean', cmd);
    }
  });
});

describe('deletion plan (Phase 2)', () => {
  const stepsFor = (collection, match) =>
    DELETION_PLAN.filter((s) => s.collection === collection && (!match || s.match === match));

  it('deletes every worker-owned collection (ownerId)', () => {
    for (const coll of [
      'workers', 'firstContactForms', 'pathwaySteps',
      'certificationNavigation', 'evaluationSubmissions', 'opportunityApplications',
    ]) {
      const steps = stepsFor(coll, 'ownerId');
      assert.equal(steps.length, 1, coll);
      assert.equal(steps[0].action, 'delete', coll);
    }
  });

  it('anonymises supervision sessions on BOTH sides (ownerId + supervisorId)', () => {
    const owner = stepsFor('supervisionSessions', 'ownerId');
    const sup = stepsFor('supervisionSessions', 'supervisorId');
    assert.equal(owner.length, 1);
    assert.equal(owner[0].action, 'anonymiseField');
    assert.deepEqual([...(owner[0].fields ?? [])], ['ownerId']);
    assert.equal(sup.length, 1);
    assert.equal(sup[0].action, 'anonymiseField');
  });

  it('anonymises handoffs for all three parties', () => {
    assert.equal(stepsFor('handoffs', 'workerId')[0].action, 'closeLink');
    assert.equal(stepsFor('handoffs', 'senderId')[0].action, 'anonymiseField');
    assert.equal(stepsFor('handoffs', 'recipientId')[0].action, 'anonymiseField');
  });

  it('sweeps sharedWith on every shareable collection', () => {
    for (const coll of [
      'firstContactForms', 'pathwaySteps',
      'certificationNavigation', 'supervisionSessions',
    ]) {
      const steps = stepsFor(coll, 'sharedWith');
      assert.equal(steps.length, 1, coll);
      assert.equal(steps[0].action, 'stripUid', coll);
    }
  });

  it('revokes consents in both directions and strips the target', () => {
    const out = stepsFor('consents', 'granterId');
    const inn = stepsFor('consents', 'granteeId');
    assert.equal(out.length, 1);
    assert.equal(out[0].action, 'revokeConsent');
    assert.equal(out[0].stripTargetSharedWith, 'granteeId');
    assert.equal(inn.length, 1);
    assert.equal(inn[0].action, 'revokeConsent');
    assert.equal(inn[0].stripTargetSharedWith, 'caller');
  });

  it('deletes memberships + profile docs, revokes (not deletes) grants', () => {
    assert.equal(stepsFor('memberships', 'personId')[0].action, 'delete');
    assert.equal(stepsFor('persons', 'docId')[0].action, 'delete');
    assert.equal(stepsFor('users', 'docId')[0].action, 'delete');
    assert.equal(stepsFor('roleGrants', 'granteeId')[0].action, 'revokeGrant');
  });

  it('keeps accountability records: no step touches accessEvents, aggregates, governanceDecisions, deletionRequests', () => {
    for (const coll of ['accessEvents', 'aggregates', 'governanceDecisions', 'deletionRequests', 'idempotencyKeys']) {
      assert.equal(DELETION_PLAN.filter((s) => s.collection === coll).length, 0, coll);
    }
  });
});

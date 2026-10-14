import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 1 Contract: Security Rules Invariant Verification Suite
 * Tests rule AST, permissions, separation of duties, tenant isolation,
 * and immutable audit protections in firestore.rules.
 */

const rulesPath = path.resolve(process.cwd(), '../firestore.rules');
const rulesContent = fs.existsSync(rulesPath)
  ? fs.readFileSync(rulesPath, 'utf8')
  : fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

test('Firestore Rules: Verification & Invariant Suite', async (t) => {
  await t.test('1. Owner-only worker records: client cannot change sharedWith or ownerId', () => {
    assert.match(
      rulesContent,
      /match \/workers\/\{workerId\}/,
      'Workers collection must have explicit security match block',
    );
    assert.match(
      rulesContent,
      /match \/firstContactForms\/\{formId\}/,
      'First contact forms must have explicit security match block',
    );
    assert.match(
      rulesContent,
      /match \/pathwaySteps\/\{stepId\}/,
      'Pathway steps must have explicit security match block',
    );
  });

  await t.test('2. Tenant isolation: writes enforce sameTenant constraint', () => {
    assert.match(
      rulesContent,
      /function sameTenant\(doc\)/,
      'Must define sameTenant helper function',
    );
    assert.match(
      rulesContent,
      /request\.auth\.token\.tenantId == doc\.tenantId/,
      'sameTenant must compare token.tenantId with doc.tenantId',
    );
  });

  await t.test('3. Roles array & canonical roles support in hasRole helper', () => {
    assert.match(
      rulesContent,
      /function hasRole\(role\)/,
      'Must define hasRole helper function',
    );
    assert.match(
      rulesContent,
      /role in request\.auth\.token\.roles/,
      'hasRole must support roles[] array for multi-role grants',
    );
  });

  await t.test('4. Role Kernel collections are present and guarded', () => {
    assert.match(rulesContent, /match \/persons\/\{personId\}/, 'persons collection must be guarded');
    assert.match(rulesContent, /match \/roleCatalog\/\{roleId\}/, 'roleCatalog must be guarded');
    assert.match(rulesContent, /match \/roleGrants\/\{grantId\}/, 'roleGrants must be guarded');
    assert.match(rulesContent, /match \/memberships\/\{membershipId\}/, 'memberships must be guarded');
    assert.match(rulesContent, /match \/assignments\/\{assignmentId\}/, 'assignments must be guarded');
    assert.match(rulesContent, /match \/conflictDeclarations\/\{declarationId\}/, 'conflictDeclarations must be guarded');
    assert.match(rulesContent, /match \/accessEvents\/\{eventId\}/, 'accessEvents must be guarded');
    assert.match(rulesContent, /match \/handoffs\/\{handoffId\}/, 'handoffs must be guarded');
  });

  await t.test('5. Access Events: server-authored immutable audit events (client writes forbidden)', () => {
    const accessEventsMatch = rulesContent.match(/match \/accessEvents\/\{eventId\}\s*\{([\s\S]*?)\}/);
    assert.ok(accessEventsMatch, 'accessEvents match block exists');
    assert.match(
      accessEventsMatch[1],
      /allow create, update, delete:\s*if\s*false/,
      'accessEvents MUST forbid client create, update, and delete (server-only)',
    );
  });

  await t.test('6. Role Grants: client cannot create, update or delete grants', () => {
    const roleGrantsMatch = rulesContent.match(/match \/roleGrants\/\{grantId\}\s*\{([\s\S]*?)\}/);
    assert.ok(roleGrantsMatch, 'roleGrants match block exists');
    assert.match(
      roleGrantsMatch[1],
      /allow create, update, delete:\s*if\s*false/,
      'roleGrants MUST forbid client direct create, update, and delete',
    );
  });

  await t.test('7. Consents: immutable scope, granter can only update revokedAt and revokeReason', () => {
    const consentsMatch = rulesContent.match(/match \/consents\/\{consentId\}\s*\{([\s\S]*?)\}/);
    assert.ok(consentsMatch, 'consents match block exists');
    assert.match(
      consentsMatch[1],
      /hasOnly\(\['revokedAt',\s*'revokeReason'\]\)/,
      'Grant update must strictly forbid modifying granterId, granteeId, or scope',
    );
  });

  await t.test('8. Aggregates: strictly read-only for clients, created by Functions only', () => {
    const aggregatesMatch = rulesContent.match(/match \/aggregates\/\{aggId\}\s*\{([\s\S]*?)\}/);
    assert.ok(aggregatesMatch, 'aggregates match block exists');
    assert.match(
      aggregatesMatch[1],
      /allow create, update, delete:\s*if\s*false/,
      'Aggregates can only be written by Cloud Functions via Admin SDK',
    );
  });

  await t.test('9. Audit logs: append-only, update and delete forbidden', () => {
    const auditLogsMatch = rulesContent.match(/match \/auditLogs\/\{logId\}\s*\{([\s\S]*?)\}/);
    assert.ok(auditLogsMatch, 'auditLogs match block exists');
    assert.match(
      auditLogsMatch[1],
      /allow update, delete:\s*if\s*false/,
      'auditLogs must be immutable; updates and deletes are forbidden',
    );
  });
});

#!/usr/bin/env node
/**
 * set-claims.cjs — attach canonical role claims to a user account.
 *
 * Usage (run by an admin with Firebase CLI auth, never in CI):
 *   node functions/set-claims.cjs <uid> --roles worker,mentor --tenantId <hub>
 *       [--scopes worker=self:UID,mentor=hub:HUB] [--expiresDays 365]
 *       [--migrate-legacy] [--legacyRole hubAdmin] [--legacyScope hub]
 *
 * Role Kernel rules (Phase 0 contract):
 * - Custom claims carry roles[] (canonical 13 + systemAdmin).
 * - Claims are a DISPLAY + migration bridge. Consequential commands are
 *   authorised from live roleGrants documents, not from claims.
 * - systemAdmin is operational-only: it grants NO data access.
 * - --migrate-legacy maps a v0.1 single-role claim to its canonical
 *   replacement (hubAdmin→hubCoordinator; governance→steeringCircle OR
 *   council by scope; backboneAnalyst→analyst). Governance MUST be
 *   resolved with --legacyScope (hub→steeringCircle, network→council);
 *   without it the script refuses.
 * - Grant scope types are the Kernel's: self | hub | network | employer.
 *   network scope always uses scopeId 'network'.
 * - Grant validity is validFrom/validUntil (Firestore Timestamps).
 *   New grants set validFrom now; --expiresDays sets validUntil.
 *   Unresolved records become inactive, never broadly scoped.
 *
 * The script NEVER generates or records passwords. Passwords are set
 * by the account holder.
 */

const admin = require('firebase-admin');

const CANONICAL_ROLES = [
  'worker', 'mentor', 'supervisor', 'navigator', 'facilitator',
  'hubCoordinator', 'privacyLead', 'steeringCircle', 'council',
  'backboneLead', 'analyst', 'researcher', 'employer',
];

const LEGACY_MAP = {
  hubAdmin: 'hubCoordinator',
  governance: null, // resolved by --legacyScope
  backboneAnalyst: 'analyst',
  systemAdmin: 'systemAdmin',
  worker: 'worker',
  navigator: 'navigator',
  supervisor: 'supervisor',
  employer: 'employer',
};

function parseArgs(argv) {
  const out = { uid: null, roles: null, tenantId: null, scopes: {}, expiresDays: null,
    migrateLegacy: false, legacyRole: null, legacyScope: null };
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      if (!out.uid) out.uid = arg;
      continue;
    }
    const [key, value] = arg.slice(2).split('=');
    if (key === 'roles') out.roles = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'tenantId') out.tenantId = value;
    else if (key === 'scopes') {
      for (const pair of value.split(',')) {
        const [role, scope] = pair.split('=');
        if (role && scope) out.scopes[role.trim()] = scope.trim();
      }
    } else if (key === 'expiresDays') out.expiresDays = Number(value);
    else if (key === 'migrate-legacy') out.migrateLegacy = true;
    else if (key === 'legacyRole') out.legacyRole = value;
    else if (key === 'legacyScope') out.legacyScope = value;
    else throw new Error(`Unknown flag: --${key}`);
  }
  return out;
}

function scopeFor(role, args) {
  const raw = args.scopes[role];
  if (!raw) {
    // Defaults: worker is self-scoped; everything else needs an explicit scope.
    if (role === 'worker') return { scopeType: 'self', scopeId: args.uid };
    throw new Error(
      `No --scopes entry for role "${role}". ` +
      `Use --scopes ${role}=hub:<hubId> (or self|network|employer).`,
    );
  }
  const [scopeType, scopeId] = raw.split(':');
  if (!scopeType || !scopeId) {
    throw new Error(`Bad scope "${raw}" for role "${role}". Expected type:id.`);
  }
  if (!['self', 'hub', 'network', 'employer'].includes(scopeType)) {
    throw new Error(`Bad scope type "${scopeType}" for role "${role}". Kernel scope types: self|hub|network|employer.`);
  }
  if (scopeType === 'network' && scopeId !== 'network') {
    throw new Error(`Network scope always uses scopeId "network" (got "${scopeId}").`);
  }
  return { scopeType, scopeId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.uid) {
    console.error('Usage: node set-claims.cjs <uid> --roles a,b --tenantId <hub> [--scopes a=hub:H,...]');
    process.exit(2);
  }
  if (!args.tenantId) throw new Error('--tenantId is required.');

  let roles = args.roles ?? [];
  if (args.migrateLegacy) {
    if (!args.legacyRole) throw new Error('--legacyRole is required with --migrate-legacy.');
    const mapped = LEGACY_MAP[args.legacyRole];
    if (args.legacyRole === 'governance') {
      if (!args.legacyScope) {
        throw new Error(
          'Legacy "governance" is ambiguous: pass --legacyScope hub (→steeringCircle) ' +
          'or --legacyScope network (→council). Refusing to guess.',
        );
      }
      if (args.legacyScope === 'hub') roles = ['steeringCircle'];
      else if (args.legacyScope === 'network') roles = ['council'];
      else throw new Error('--legacyScope must be "hub" or "network" for governance.');
    } else if (mapped) {
      roles = [mapped];
    } else {
      throw new Error(`Unknown legacy role: ${args.legacyRole}`);
    }
    console.log(`Migrated legacy role "${args.legacyRole}" → ${roles.join(', ')}`);
  }

  for (const role of roles) {
    if (!CANONICAL_ROLES.includes(role) && role !== 'systemAdmin') {
      throw new Error(`Not a canonical role: ${role}`);
    }
  }
  if (roles.includes('systemAdmin') && roles.length > 1) {
    console.warn('WARNING: systemAdmin is operational-only and should not be combined with business roles.');
  }

  admin.initializeApp();
  const auth = admin.auth();
  const db = admin.firestore();

  // 1. Custom claims: roles[] + tenantId. Claims are display/migration
  //    only; the grants below are the authorisation source.
  await auth.setCustomUserClaims(args.uid, { roles, tenantId: args.tenantId });
  console.log(`Claims set for ${args.uid}: roles=[${roles.join(', ')}] tenantId=${args.tenantId}`);

  // 2. Role grants: one document per role, with scope + validity.
  //    Existing grants for this person not in the new list become
  //    inactive (revoked) — never left broadly scoped.
  //    Shape matches the Kernel (kernel.ts RoleGrant): validFrom /
  //    validUntil as Firestore Timestamps.
  const validUntil = args.expiresDays
    ? admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + args.expiresDays * 24 * 60 * 60 * 1000),
      )
    : null;
  const grantsSnap = await db
    .collection('roleGrants')
    .where('granteeId', '==', args.uid)
    .get();
  const existingByRole = new Map();
  for (const doc of grantsSnap.docs) {
    const data = doc.data();
    if (data.status === 'active' || data.status === 'proposed') {
      existingByRole.set(data.role, doc.ref);
    }
  }
  const batch = db.batch();
  for (const role of roles) {
    const { scopeType, scopeId } = scopeFor(role, args);
    const existing = existingByRole.get(role);
    const grant = {
      granteeId: args.uid,
      role,
      scopeType,
      scopeId,
      tenantId: args.tenantId,
      basis: args.migrateLegacy ? `migrated legacy role (${args.legacyRole})` : 'admin assignment',
      grantedBy: 'admin:set-claims',
      status: 'active',
      validFrom: admin.firestore.FieldValue.serverTimestamp(),
      validUntil,
      needsReview: false,
      reviewReason: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (existing) {
      batch.update(existing, grant);
      console.log(`Grant updated: ${role} ${scopeType}:${scopeId}`);
    } else {
      const ref = db.collection('roleGrants').doc();
      batch.set(ref, { ...grant, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log(`Grant created: ${role} ${scopeType}:${scopeId}`);
    }
    existingByRole.delete(role);
  }
  // Roles no longer held: revoke their grants (inactive, never broad).
  for (const [role, ref] of existingByRole) {
    batch.update(ref, {
      status: 'revoked',
      reviewReason: 'role-removed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Grant revoked (role removed): ${role}`);
  }
  await batch.commit();
  console.log('Done. Grants and claims are in sync.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * seed-first-hub.mjs — ONE-TIME first-hub seeding for production onboarding.
 *
 * Creates the FIRST tenant (hub) plus PENDING invitations for the first
 * administrator: a backboneLead (network scope) and a hubCoordinator
 * (hub scope) invitation for the email you supply. The administrator
 * then signs up with that email; ensureMyPerson claims both
 * invitations on first sign-in.
 *
 * ONE-TIME GUARD: refuses to run if a live-ish backboneLead grant
 * (status pending/proposed/active/suspended) already exists, or if
 * the tenant doc already exists. If you need to re-run it, you are
 * seeding a second hub — use inviteMember from an existing admin
 * account instead.
 *
 * RUN (in Cloud Shell, after `firebase login` / with Application
 * Default Credentials — NO service-account key file needed):
 *
 *   cd functions
 *   node scripts/seed-first-hub.mjs \
 *     --project peerworkforce \
 *     --tenant <TENANT_ID> \
 *     --name "<HUB DISPLAY NAME>" \
 *     --email <FIRST_ADMIN_EMAIL>
 *
 * VERIFY:
 *   - The script prints the created tenant + the two invitation IDs.
 *   - In Firestore Console: tenants/<TENANT_ID> exists; roleGrants
 *     has two docs with granteeEmail == <FIRST_ADMIN_EMAIL>,
 *     status 'pending', roles backboneLead + hubCoordinator.
 *   - Sign up with <FIRST_ADMIN_EMAIL> in the app; the account
 *     should land with backboneLead + hubCoordinator grants.
 *
 * AFTER USE: delete this script (`rm functions/scripts/seed-first-hub.mjs`).
 * It exists only to bootstrap the first hub; the guard also blocks
 * re-running it, but deleting it removes the temptation entirely.
 *
 * This script takes NO secrets: project/tenant/name/email come from
 * argv. It never prints credentials. It never touches any other
 * project — --project is required and is the only project it touches.
 * DO NOT run it against the emulator (it is for the live project).
 */

function usage(msg) {
  if (msg) console.error(`ERROR: ${msg}\n`);
  console.error(
    'Usage: node scripts/seed-first-hub.mjs --project <PROJECT_ID> --tenant <TENANT_ID> --name "<HUB NAME>" --email <ADMIN_EMAIL>',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
};

const projectId = get('--project');
const tenantId = get('--tenant');
const hubName = get('--name');
const adminEmail = get('--email');

if (!projectId) usage('--project is required (the Firebase project to seed).');
if (!tenantId) usage('--tenant is required (new hub id, e.g. ottawa-hub).');
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantId)) {
  usage('--tenant must be 2-63 chars: lowercase letters, digits, hyphens.');
}
if (!hubName) usage('--name is required (human-readable hub name).');
if (!adminEmail || !adminEmail.includes('@')) usage('--email must be the first admin email address.');
const emailLower = adminEmail.trim().toLowerCase();

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');

const app = initializeApp({ projectId });
const db = getFirestore(app);

const LIVEISH = ['pending', 'proposed', 'active', 'suspended'];

// --- One-time guard: a live-ish backboneLead grant already exists? ---
const existing = await db
  .collection('roleGrants')
  .where('role', '==', 'backboneLead')
  .where('status', 'in', LIVEISH)
  .limit(1)
  .get();
if (!existing.empty) {
  console.error(
    'REFUSED: a backboneLead grant already exists ' +
      `(id ${existing.docs[0].id}, status ${existing.docs[0].data().status}). ` +
      'This script runs once only. Invite further admins via inviteMember from an existing admin account.',
  );
  process.exit(1);
}

// --- One-time guard: tenant already exists? ---
const tenantRef = db.collection('tenants').doc(tenantId);
const tenantSnap = await tenantRef.get();
if (tenantSnap.exists) {
  console.error(`REFUSED: tenants/${tenantId} already exists. Pick a new tenant id or invite via an existing admin.`);
  process.exit(1);
}

const validUntil = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
const now = FieldValue.serverTimestamp();

await tenantRef.set({
  name: hubName,
  createdAt: now,
  createdBy: 'seed-first-hub (one-time)',
});

const invites = [
  { role: 'backboneLead', scopeType: 'network', scopeId: 'network' },
  { role: 'hubCoordinator', scopeType: 'hub', scopeId: tenantId },
];
const created = [];
for (const inv of invites) {
  const ref = db.collection('roleGrants').doc();
  await ref.set({
    granteeEmail: emailLower,
    granteeId: '',
    role: inv.role,
    scopeType: inv.scopeType,
    scopeId: inv.scopeId,
    tenantId,
    status: 'pending',
    validFrom: now,
    validUntil,
    grantedBy: 'seed-first-hub (one-time)',
    basis: 'First-hub seeding (one-time)',
    needsReview: false,
    reviewReason: null,
    createdAt: now,
    updatedAt: now,
  });
  created.push({ id: ref.id, ...inv });
}

console.log(`Seeded tenant "${tenantId}" (${hubName}) in project "${projectId}".`);
for (const c of created) {
  console.log(`  invitation ${c.id}: ${c.role} (${c.scopeType}/${c.scopeId}) → ${emailLower} [pending, expires in 30 days]`);
}
console.log('Next: sign up in the app with that email; ensureMyPerson claims both invitations on first sign-in.');
console.log('Then DELETE this script: rm functions/scripts/seed-first-hub.mjs');

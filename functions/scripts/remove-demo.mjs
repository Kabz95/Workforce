#!/usr/bin/env node
/**
 * remove-demo.mjs — delete the DEMO tenant, all demo data, and the test
 * accounts from a Firebase project. DRY-RUN BY DEFAULT (lists what
 * would be deleted, deletes nothing). Pass --confirm to actually delete.
 *
 * SAFETY:
 * - The tenant is HARD-LOCKED to 'demo-hub'. Any other --tenant value
 *   is refused. This script can only ever remove demo data.
 * - --project is required: the script touches only that project.
 * - Without --confirm, NOTHING is deleted (dry-run lists counts + ids).
 * - Deletion is by tenantId == 'demo-hub' across the tenant-scoped
 *   collections, plus Auth users whose persons doc was in the demo
 *   tenant or whose email ends in @example.test, plus the
 *   tenants/demo-hub doc itself. idempotencyKeys carry no tenant
 *   marker and are left alone (harmless; they expire with their
 *   operations).
 *
 * RUN (in Cloud Shell, with Application Default Credentials):
 *
 *   # 1. Dry-run first — verify the list is ONLY demo data:
 *   cd functions
 *   node scripts/remove-demo.mjs --project peerworkforce
 *
 *   # 2. Delete (only after reviewing the dry-run output):
 *   node scripts/remove-demo.mjs --project peerworkforce --confirm
 *
 *   # 3. Verify: re-run the dry-run — every count must be zero:
 *   node scripts/remove-demo.mjs --project peerworkforce
 *
 * AFTER USE: delete this script (`rm functions/scripts/remove-demo.mjs`).
 * It takes NO secrets: project/tenant come from argv. It never prints
 * credentials, passwords, or token material — only doc ids, counts,
 * and Auth uids/emails of the test accounts being removed.
 *
 * DO NOT run this against the emulator (it is for the live project,
 * removing the demo dataset before production onboarding goes live).
 */

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 || i + 1 >= args.length ? null : args[i + 1];
};

function usage(msg) {
  if (msg) console.error(`ERROR: ${msg}\n`);
  console.error('Usage: node scripts/remove-demo.mjs --project <PROJECT_ID> [--tenant demo-hub] [--confirm]');
  process.exit(1);
}

const projectId = get('--project');
const tenant = get('--tenant') ?? 'demo-hub';
const confirm = has('--confirm');

if (!projectId) usage('--project is required.');
if (tenant !== 'demo-hub') {
  usage(`--tenant must be 'demo-hub' — this script only ever removes demo data (got '${tenant}').`);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');

const app = initializeApp({ projectId });
const db = getFirestore(app);
const auth = getAuth();

// Tenant-scoped collections whose docs carry tenantId.
const TENANT_COLLECTIONS = [
  'workers',
  'firstContactForms',
  'pathwaySteps',
  'certificationNavigation',
  'evaluationSubmissions',
  'opportunityApplications',
  'consents',
  'roleGrants',
  'memberships',
  'assignments',
  'handoffs',
  'accessEvents',
  'conflictDeclarations',
  'complaints',
  'adaptationLogs',
  'governanceDecisions',
  'opportunities',
  'employers',
  'readinessAssessments',
  'aggregates',
  'aggregateReleases',
  'deletionRequests',
  'persons',
];

// Delete a query snapshot in ≤400-op batches (Firestore batch limit is 500).
async function deleteSnapshot(snap, label) {
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
    deleted += Math.min(400, docs.length - i);
  }
  console.log(`  ${label}: deleted ${deleted}`);
  return deleted;
}

console.log(`Project: ${projectId} | Tenant: ${tenant} | Mode: ${confirm ? 'DELETE' : 'DRY-RUN (nothing deleted)'}`);

// --- Collect demo docs per collection ---
const perCollection = {};
for (const coll of TENANT_COLLECTIONS) {
  const snap = await db.collection(coll).where('tenantId', '==', tenant).get();
  perCollection[coll] = snap;
  console.log(`  ${coll}: ${snap.size} doc(s) with tenantId == '${tenant}'`);
}

// --- Collect demo Auth users: persons in the demo tenant + @example.test emails ---
const demoUids = new Set();
for (const d of perCollection.persons.docs) demoUids.add(d.id);
let nextPageToken;
do {
  const page = await auth.listUsers(1000, nextPageToken);
  for (const u of page.users) {
    if (demoUids.has(u.uid)) continue; // already counted via persons
    if (typeof u.email === 'string' && u.email.endsWith('@example.test')) demoUids.add(u.uid);
  }
  nextPageToken = page.pageToken;
} while (nextPageToken);
console.log(`  auth users to remove: ${demoUids.size}`);
for (const uid of demoUids) {
  const u = await auth.getUser(uid).catch(() => null);
  console.log(`    - ${uid} (${u?.email ?? 'no email'})`);
}

const tenantSnap = await db.collection('tenants').doc(tenant).get();
console.log(`  tenants/${tenant}: ${tenantSnap.exists ? 'exists' : 'absent'}`);

if (!confirm) {
  console.log('\nDRY-RUN complete. Re-run with --confirm to delete the above.');
  process.exit(0);
}

console.log('\n--confirm given: deleting…');
for (const coll of TENANT_COLLECTIONS) {
  await deleteSnapshot(perCollection[coll], coll);
}
for (const uid of demoUids) {
  await auth.deleteUser(uid).catch((e) => console.log(`  auth ${uid}: ${e.message}`));
  console.log(`  auth: deleted ${uid}`);
}
if (tenantSnap.exists) {
  await db.collection('tenants').doc(tenant).delete();
  console.log(`  tenants/${tenant}: deleted`);
}
console.log('\nDone. Verify with a dry-run: every count must be zero.');

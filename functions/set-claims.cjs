/**
 * set-claims.cjs — one-time admin bootstrap.
 *
 * Sets a user's Auth custom claims (role + tenantId) so the app's
 * role-based routing and security rules recognise them.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json \
 *     node set-claims.cjs <USER_UID> <ROLE> <TENANT_ID>
 *
 * Example:
 *   node set-claims.cjs abc123XYZ governance demo-hub
 *
 * Roles: worker | navigator | supervisor | employer | hubAdmin |
 *        governance | backboneAnalyst | systemAdmin
 *
 * The user must sign out and back in for claims to take effect.
 * The service-account key is sensitive: use it once, then delete it.
 * Never commit it.
 */

const admin = require("firebase-admin");

const ROLES = [
  "worker",
  "navigator",
  "supervisor",
  "employer",
  "hubAdmin",
  "governance",
  "backboneAnalyst",
  "systemAdmin",
];

async function main() {
  const [uid, role, tenantId] = process.argv.slice(2);
  if (!uid || !role || !tenantId) {
    console.error(
      "Usage: node set-claims.cjs <USER_UID> <ROLE> <TENANT_ID>",
    );
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Unknown role "${role}". Valid: ${ROLES.join(" | ")}`);
    process.exit(1);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key JSON path.",
    );
    process.exit(1);
  }
  admin.initializeApp();
  await admin.auth().setCustomUserClaims(uid, { role, tenantId });
  // Mirror the membership in the users doc for the app's convenience.
  await admin
    .firestore()
    .collection("users")
    .doc(uid)
    .set({ tenantId, roles: [role] }, { merge: true });
  console.log(`Set ${uid} → role=${role}, tenantId=${tenantId}`);
  console.log("User must sign out and back in for claims to take effect.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * set-claims.cjs — Phase 1 Role Kernel bootstrap & claims manager.
 *
 * Sets a user's Auth custom claims (roles[] array + tenantId) and
 * provisions corresponding verified RoleGrants in Firestore.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json \
 *     node set-claims.cjs <USER_UID> <ROLES_COMMA_SEPARATED> <TENANT_ID> [EXPIRY_DAYS]
 *
 * Examples:
 *   node set-claims.cjs abc123XYZ worker,navigator demo-hub
 *   node set-claims.cjs def456UVW steeringCircle demo-hub 180
 *   node set-claims.cjs ghi789RST council national 365
 *
 * Canonical Roles (13):
 *   worker | mentor | supervisor | navigator | facilitator | hubCoordinator |
 *   privacyLead | steeringCircle | council | backboneLead | analyst |
 *   researcher | employer | systemAdmin (operational only)
 *
 * Legacy Role Migration Mapping:
 *   hubAdmin -> hubCoordinator
 *   governance -> steeringCircle (if hub-scoped) or council (if national)
 *   backboneAnalyst -> analyst
 */

const admin = require("firebase-admin");

const CANONICAL_ROLES = [
  "worker",
  "mentor",
  "supervisor",
  "navigator",
  "facilitator",
  "hubCoordinator",
  "privacyLead",
  "steeringCircle",
  "council",
  "backboneLead",
  "analyst",
  "researcher",
  "employer",
  "systemAdmin",
];

function mapRole(rawRole, tenantId) {
  const r = rawRole.trim();
  if (r === "hubAdmin") return "hubCoordinator";
  if (r === "governance") return tenantId === "national" ? "council" : "steeringCircle";
  if (r === "backboneAnalyst") return "analyst";
  return r;
}

async function main() {
  const [uid, rawRoles, tenantId, expiryDaysArg] = process.argv.slice(2);
  if (!uid || !rawRoles || !tenantId) {
    console.error(
      "Usage: node set-claims.cjs <USER_UID> <ROLES_COMMA_SEPARATED> <TENANT_ID> [EXPIRY_DAYS]",
    );
    process.exit(1);
  }

  const expiryDays = parseInt(expiryDaysArg || "365", 10);
  const inputList = rawRoles.split(",").map((r) => r.trim()).filter(Boolean);
  const canonicalRoles = inputList.map((r) => mapRole(r, tenantId));

  for (const r of canonicalRoles) {
    if (!CANONICAL_ROLES.includes(r)) {
      console.error(`Unknown canonical role "${r}". Valid: ${CANONICAL_ROLES.join(" | ")}`);
      process.exit(1);
    }
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn(
      "Notice: GOOGLE_APPLICATION_CREDENTIALS not set. Using Application Default Credentials if available.",
    );
  }

  if (admin.apps.length === 0) {
    admin.initializeApp();
  }

  // Support named database peerworkforce or default
  const db = admin.firestore("peerworkforce");

  // Dual-write custom claims: roles[] array + primary role string (for backward compatibility)
  const primaryRole = canonicalRoles[0];
  await admin.auth().setCustomUserClaims(uid, {
    roles: canonicalRoles,
    role: primaryRole,
    tenantId,
  });

  const now = admin.firestore.Timestamp.now();
  const validUntil = new admin.firestore.Timestamp(
    now.seconds + expiryDays * 86400,
    0,
  );

  // Mirror person and verified roleGrants in Firestore
  await db.collection("persons").doc(uid).set(
    {
      authUid: uid,
      tenantId,
      updatedAt: now,
    },
    { merge: true },
  );

  for (const role of canonicalRoles) {
    const circle =
      role === "council" || role === "backboneLead"
        ? "national"
        : role === "employer"
        ? "boundary"
        : role === "systemAdmin"
        ? "operational"
        : "hub";

    const grantRef = db.collection("roleGrants").doc(`${uid}_${role}`);
    await grantRef.set({
      personId: uid,
      authUid: uid,
      role,
      circle,
      jurisdictionScope: tenantId,
      term: {
        validFrom: now,
        validUntil,
      },
      authorizedBy: "admin-bootstrap",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  // Also maintain users doc for legacy app queries
  await db.collection("users").doc(uid).set(
    {
      tenantId,
      roles: canonicalRoles,
      role: primaryRole,
      updatedAt: now,
    },
    { merge: true },
  );

  console.log(`\n✔ Claims & Grants successfully updated for ${uid}:`);
  console.log(`  Tenant: ${tenantId}`);
  console.log(`  Canonical Roles: ${canonicalRoles.join(", ")}`);
  console.log(`  Term: Valid until ${new Date(validUntil.seconds * 1000).toISOString()}`);
  console.log(`\nNote: User must refresh auth token (sign out & back in) for new claims to activate.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

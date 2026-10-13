/**
 * Cloud Functions — Peer Support Workforce Network platform.
 *
 * Consent machinery, export, deletion, aggregation.
 * Design rules (from the architecture spec):
 *  - The worker controls their own record. No function reads worker data
 *    except to serve that worker, or to write de-identified aggregates.
 *  - grantAccess is the ONLY path that adds a UID to a document's
 *    sharedWith array. It verifies a live consent grant first.
 *  - Audit logs are append-only and are kept as the system's
 *    accountability record even after a worker deletes their data.
 *    (Flagged for legal review: see README.)
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

initializeApp();
const db = getFirestore();
const storage = getStorage();

// Collections whose documents are owned by a worker (ownerId) and
// therefore included in an export / deleted on a deletion request.
const WORKER_OWNED = [
  "workers",
  "firstContactForms",
  "pathwaySteps",
  "certificationNavigation",
  "evaluationSubmissions",
  "opportunityApplications",
];

// Minimum cell size for published aggregates (k-anonymity).
const MIN_CELL = 5;

interface ConsentGrant {
  granterId: string;
  granteeId: string;
  tenantId: string;
  scope: string;
  resourceType: string;
  resourceId: string;
  grantedAt: Timestamp;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
  purpose: string;
}

async function auditLog(entry: {
  subjectId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
}): Promise<void> {
  await db.collection("auditLogs").add({
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function stripSharedWith(
  collection: string,
  docId: string,
  uid: string,
): Promise<void> {
  const ref = db.collection(collection).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({
    sharedWith: FieldValue.arrayRemove(uid),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * grantAccess — the ONLY path that adds a UID to sharedWith.
 * Caller must be the data owner; a live grant with matching scope
 * must exist. Callable by the worker.
 */
export const grantAccess = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }
  const { consentId } = request.data as { consentId: string };
  if (typeof consentId !== "string" || !consentId) {
    throw new HttpsError("invalid-argument", "consentId is required.");
  }
  const consentSnap = await db.collection("consents").doc(consentId).get();
  if (!consentSnap.exists) {
    throw new HttpsError("not-found", "Consent grant not found.");
  }
  const grant = consentSnap.data() as ConsentGrant;
  if (grant.granterId !== request.auth.uid) {
    throw new HttpsError(
      "permission-denied",
      "Only the granter may activate a grant.",
    );
  }
  if (grant.revokedAt !== null) {
    throw new HttpsError("failed-precondition", "Grant has been revoked.");
  }
  if (grant.expiresAt.toMillis() <= Timestamp.now().toMillis()) {
    throw new HttpsError("failed-precondition", "Grant has expired.");
  }
  if (grant.scope !== `read:${grant.resourceType}`) {
    throw new HttpsError(
      "failed-precondition",
      "Grant scope does not match the shared document type.",
    );
  }
  const target = db.collection(grant.resourceType).doc(grant.resourceId);
  const targetSnap = await target.get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "Shared document not found.");
  }
  const targetData = targetSnap.data() as Record<string, unknown>;
  // The caller must own the target document (or be a participant, for
  // mentorships). Without this, a caller could point a grant at
  // someone else's document and share it.
  const ownsTarget =
    targetData.ownerId === request.auth.uid ||
    (Array.isArray(targetData.participantIds) &&
      targetData.participantIds.includes(request.auth.uid));
  if (!ownsTarget) {
    throw new HttpsError(
      "permission-denied",
      "You do not own the document this grant points to.",
    );
  }
  await target.update({
    sharedWith: FieldValue.arrayUnion(grant.granteeId),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await auditLog({
    subjectId: grant.granterId,
    actorId: request.auth.uid,
    action: "grantAccess",
    resourceType: grant.resourceType,
    resourceId: grant.resourceId,
  });
  return { ok: true };
});

/**
 * requestExport — bundle every document the caller owns, return a
 * signed download URL valid 7 days. Callable by the worker.
 */
export const requestExport = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }
  const uid = request.auth.uid;
  const bundle: Record<string, unknown[]> = {};
  for (const coll of WORKER_OWNED) {
    const snap = await db
      .collection(coll)
      .where("ownerId", "==", uid)
      .get();
    bundle[coll] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  // Consent grants the worker gave or received.
  const granted = await db
    .collection("consents")
    .where("granterId", "==", uid)
    .get();
  const received = await db
    .collection("consents")
    .where("granteeId", "==", uid)
    .get();
  bundle["consents"] = [
    ...granted.docs.map((d) => ({ id: d.id, ...d.data() })),
    ...received.docs.map((d) => ({ id: d.id, ...d.data() })),
  ];
  const payload = JSON.stringify(
    { exportedAt: new Date().toISOString(), ownerId: uid, data: bundle },
    null,
    2,
  );
  const file = storage
    .bucket()
    .file(`exports/${uid}/export-${Date.now()}.json`);
  await file.save(payload, { contentType: "application/json" });
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  await auditLog({
    subjectId: uid,
    actorId: uid,
    action: "requestExport",
    resourceType: "export",
    resourceId: file.name,
  });
  return { url };
});

/**
 * requestDeletion — delete owned documents; anonymise shared ones.
 * Audit logs are kept as the system's accountability record.
 * Callable by the worker.
 */
export const requestDeletion = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }
  const uid = request.auth.uid;
  const TOMBSTONE = "anonymised";
  const batch = db.batch();

  // 1. Delete worker-owned documents.
  for (const coll of WORKER_OWNED) {
    const snap = await db
      .collection(coll)
      .where("ownerId", "==", uid)
      .get();
    for (const doc of snap.docs) batch.delete(doc.ref);
  }

  // 2. Anonymise shared documents the worker participated in.
  const mentorships = await db
    .collection("mentorships")
    .where("participantIds", "array-contains", uid)
    .get();
  for (const doc of mentorships.docs) {
    batch.update(doc.ref, {
      participantIds: FieldValue.arrayRemove(uid),
      sharedWith: FieldValue.arrayRemove(uid),
    });
  }
  const supervised = await db
    .collection("supervisionSessions")
    .where("supervisorId", "==", uid)
    .get();
  for (const doc of supervised.docs) {
    batch.update(doc.ref, { supervisorId: TOMBSTONE });
  }
  const authored = await db
    .collection("adaptationLogs")
    .where("authorId", "==", uid)
    .get();
  for (const doc of authored.docs) {
    batch.update(doc.ref, { authorId: TOMBSTONE });
  }
  const complaints = await db
    .collection("complaints")
    .where("complainantId", "==", uid)
    .get();
  for (const doc of complaints.docs) {
    batch.update(doc.ref, { complainantId: TOMBSTONE });
  }

  // 3. Close the worker's consent grants (revoke) and strip access.
  const grants = await db
    .collection("consents")
    .where("granterId", "==", uid)
    .where("revokedAt", "==", null)
    .get();
  for (const doc of grants.docs) {
    const g = doc.data() as ConsentGrant;
    batch.update(doc.ref, {
      revokedAt: FieldValue.serverTimestamp(),
      revokeReason: "account-deletion",
    });
    await stripSharedWith(g.resourceType, g.resourceId, g.granteeId);
  }
  const received = await db
    .collection("consents")
    .where("granteeId", "==", uid)
    .where("revokedAt", "==", null)
    .get();
  for (const doc of received.docs) {
    const g = doc.data() as ConsentGrant;
    batch.update(doc.ref, {
      revokedAt: FieldValue.serverTimestamp(),
      revokeReason: "account-deletion",
    });
    await stripSharedWith(g.resourceType, g.resourceId, uid);
  }

  // 4. Record the deletion request as processed.
  const reqRef = db.collection("deletionRequests").doc();
  batch.set(reqRef, {
    ownerId: uid,
    tenantId: request.auth.token.tenantId ?? null,
    status: "processed",
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  await auditLog({
    subjectId: uid,
    actorId: uid,
    action: "requestDeletion",
    resourceType: "account",
    resourceId: uid,
  });
  return { ok: true };
});

/**
 * aggregateEvaluation — weekly. Reads raw evaluation submissions and
 * writes de-identified aggregates. Cells smaller than MIN_CELL are
 * suppressed (never written) to prevent re-identification.
 * The backbone never sees raw submissions.
 */
export const aggregateEvaluation = onSchedule(
  { schedule: "every monday 02:00", timeZone: "America/Toronto" },
  async () => {
    const snap = await db.collection("evaluationSubmissions").get();
    // Group counts by tenant + question + answer value.
    const cells = new Map<string, number>();
    for (const doc of snap.docs) {
      const data = doc.data() as {
        tenantId: string;
        responses: Record<string, string>;
      };
      const responses = data.responses ?? {};
      for (const [question, answer] of Object.entries(responses)) {
        const key = `${data.tenantId}||${question}||${answer}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
    }
    const period = new Date().toISOString().slice(0, 10);
    const batch = db.batch();
    for (const [key, count] of cells) {
      if (count < MIN_CELL) continue; // suppress small cells
      const [tenantId, question, answer] = key.split("||");
      const ref = db.collection("aggregates").doc();
      batch.set(ref, {
        tenantId,
        metric: `evaluation:${question}`,
        period,
        value: count,
        breakdown: { answer },
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  },
);

/**
 * expireConsents — daily. Closes expired grants and strips access.
 */
export const expireConsents = onSchedule(
  { schedule: "every day 03:00", timeZone: "America/Toronto" },
  async () => {
    const now = Timestamp.now();
    const snap = await db
      .collection("consents")
      .where("revokedAt", "==", null)
      .where("expiresAt", "<=", now)
      .get();
    for (const doc of snap.docs) {
      const g = doc.data() as ConsentGrant;
      await doc.ref.update({
        revokedAt: FieldValue.serverTimestamp(),
        revokeReason: "expired",
      });
      await stripSharedWith(g.resourceType, g.resourceId, g.granteeId);
    }
  },
);

/**
 * onConsentRevoke — when a grant is revoked, strip the grantee's
 * access from the shared document immediately, and audit it.
 */
export const onConsentRevoke = onDocumentUpdated(
  "consents/{consentId}",
  async (event) => {
    const before = event.data?.before.data() as ConsentGrant | undefined;
    const after = event.data?.after.data() as ConsentGrant | undefined;
    if (!before || !after) return;
    if (before.revokedAt === null && after.revokedAt !== null) {
      await stripSharedWith(
        after.resourceType,
        after.resourceId,
        after.granteeId,
      );
      await auditLog({
        subjectId: after.granterId,
        actorId: after.granterId,
        action: "revokeConsent",
        resourceType: after.resourceType,
        resourceId: after.resourceId,
      });
    }
  },
);

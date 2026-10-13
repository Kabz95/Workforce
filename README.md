# Peer Support Workforce Network — Platform

The software that operates the National Peer Support Workforce, Practice and Learning Network described in *Building a Supported Peer Workforce*. Firebase backend + React web app.

**Status:** v0.1 scaffold — backend (rules + functions) compiles; frontend in progress. **Not production-ready.** Security rules need a qualified review and adversarial testing before the platform holds real personal data.

## Structure

```
workforce-platform/
├── firebase.json            # Firestore, Functions, Hosting, Emulators config
├── .firebaserc              # Placeholder project id — change to your project
├── firestore.rules          # Consent machinery made into code (see § Rules)
├── firestore.indexes.json   # Composite indexes for tenant-scoped queries
├── functions/               # Cloud Functions (TypeScript, 2nd gen)
│   └── src/index.ts         # grantAccess, requestExport, requestDeletion,
│                              # aggregateEvaluation, expireConsents, onConsentRevoke
├── web/                     # Vite + React + TypeScript frontend
└── README.md
```

## Design (from the architecture spec)

- **Region:** all services in `northamerica-northeast1` (Montréal). Canadian data stays in Canada.
- **Tenant model:** one Firebase project for the pilot; every document carries `tenantId` (hub); rules enforce tenant match. Migration path to per-hub projects at scale.
- **Roles** (Auth custom claims): `worker`, `navigator`, `supervisor`, `employer`, `hubAdmin`, `governance`, `backboneAnalyst`, `systemAdmin`. **No super-reader.** No role can list a worker-owned collection.
- **Consent:** grants with expiry (default 90 days), one-tap revocation, `sharedWith` shadow on shared documents. `grantAccess` (Cloud Function) is the *only* path that adds a UID to `sharedWith`.
- **Anti-surveillance:** no admin view of individual worker records, no activity feeds, no Analytics on worker-facing flows, every admin read logged and visible to the data owner.
- **Aggregation:** the backbone sees only de-identified aggregates. Cells smaller than 5 are suppressed.

## Setup

Prerequisites: Node 20+, Firebase CLI, Java (for the emulator suite).

```bash
# 1. Create the project (Console): region northamerica-northeast1,
#    Firestore in Native mode. Then point .firebaserc at it.
# 2. Install
cd functions && npm install && cd ..
cd web && npm install && cd ..
# 3. Configure the web app
cp web/.env.example web/.env   # fill in your Firebase web config
# 4. Run locally with emulators (no real project needed)
firebase emulators:start
# 5. Deploy (after security review)
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```

Full production checklist: see [`DEPLOY.md`](DEPLOY.md) — project creation, Blaze billing note for Functions, first-admin bootstrap via `functions/set-claims.cjs`, verification.

### Setting roles (custom claims)
New users sign up as `worker` in tenant `demo-hub`. Assign other roles with the Admin SDK, e.g.:

```js
await getAuth().setCustomUserClaims(uid, { role: 'navigator', tenantId: 'demo-hub' });
```

## Rules summary (`firestore.rules`)

| Pattern | Where |
|---|---|
| Owner-only, no bulk listing | `workers`, `firstContactForms`, `pathwaySteps`, `certificationNavigation`, `evaluationSubmissions` |
| Owner + shared, read-only for shared | `supervisionSessions`, `mentorships` (participants) |
| Public within tenant | `opportunities`, `governanceDecisions`, `adaptationLogs` |
| Employer-only + governance (gate outcome) | `readinessAssessments` |
| Functions-only writes | `aggregates` |
| Append-only | `auditLogs` |

**Known limit:** Firestore rules cannot join across documents, so a rule cannot verify a consent grant is live at read time. Enforcement is two-layer: rules enforce ownership + `sharedWith` + tenant; Functions verify the live grant before adding anyone to `sharedWith`, and revocation/expiry strips membership. The grant record in `consents` is the auditable truth.

## Cloud Functions (`functions/src/index.ts`)

| Function | Trigger | Behaviour |
|---|---|---|
| `grantAccess` | Callable | Verifies owner + live grant, adds grantee to `sharedWith`, audits. |
| `requestExport` | Callable | Bundles all owned docs → Storage signed URL (7 days), audits. |
| `requestDeletion` | Callable | Deletes owned docs, anonymises shared docs, revokes grants, audits. |
| `aggregateEvaluation` | Weekly (Mon 02:00 ET) | De-identified aggregates, cells < 5 suppressed. |
| `expireConsents` | Daily (03:00 ET) | Closes expired grants, strips access. |
| `onConsentRevoke` | Firestore trigger | On revocation, strips access immediately, audits. |

## Flags for legal / security review before production

1. **Audit-log retention after deletion.** `requestDeletion` keeps `auditLogs` as the system's accountability record (IDs + actions only). Confirm this is the right retention call under PIPEDA/PHIPA.
2. **Security review.** Rules + Functions need adversarial testing (attempted bulk reads, forged claims, grant replay) before real personal data.
3. **PHIPA/PIPEDA.** Firebase supplies certified infrastructure, not compliance. First-contact forms may hold sensitive information — get qualified advice per jurisdiction.

## Licence

AGPL-3.0 — see `LICENSE`. The network-use clause matters here: anyone who runs a modified version of this platform as a service must share their changes. That is the anti-capture principle, in licence form.

## Roadmap

- **Phase 0 (this build):** auth, pathway module, first-contact form, consent machinery, export/deletion, employer readiness, governance decisions, aggregates.
- **Phase 1 (pilot):** hardening, security review, four-hub deployment.
- **Phase 2 (only if the pilot progresses):** Communities of Practice, full evaluation battery, cross-hub knowledge. Parked-for-scale instruments stay parked.

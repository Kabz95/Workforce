# Peer Support Workforce Network — Web Frontend

Working scaffold for the platform specified in
`../software/firebase-architecture-spec.md`. Vite + React + TypeScript +
Firebase JS SDK (modular). No Firebase Analytics anywhere in this app.

## Quick start

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # type-check + production build
npm run preview      # preview the production build
```

## Environment setup

```bash
cp .env.example .env
```

Fill in values from your Firebase project console. Never commit a real `.env`.

| Variable | Meaning |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | e.g. `your-project.appspot.com` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender id |
| `VITE_FIREBASE_APP_ID` | Web app id |
| `VITE_USE_EMULATORS` | `true` = connect to local emulators |

## Local development with the Firebase Emulator Suite

```bash
# in a separate terminal, with the Firebase CLI installed
firebase emulators:start
VITE_USE_EMULATORS=true npm run dev
```

With emulators, new users default to role `worker` and tenant `demo-hub`
(because custom claims do not exist yet). In a real project, roles and
`tenantId` come from Auth custom claims set by a trusted admin / Function.

## What is built

- **Auth**: email/password + Google sign-in. Role + tenant read from
  custom claims via `getIdTokenResult`.
- **Dashboard**: role-aware — workers see pathway + consents; employers see
  readiness + opportunities; governance sees decisions; analysts see aggregates.
- **WorkerRecord**: own profile + first-contact form (owner-only CRUD).
- **Pathway**: own pathway steps (create, update status, delete).
- **Consents**: list live grants, grant form, one-tap revoke.
- **EmployerReadiness**: readiness self-assessment (employer role).
- **Opportunities**: tenant-scoped listings; workers apply; employers see
  applications to their own postings only.
- **Governance**: decisions list + complaint form.
- **Aggregates**: aggregates collection (analyst / governance roles).
- **AuditLog**: the signed-in user sees their own audit entries.

## Hard rules enforced in this code

- Every Firestore query is tenant-scoped (`tenantId == <claim>`).
- Worker-owned data is queried only by `ownerId == current user`. There is
  no admin view of worker records, no activity feed, no "last active"
  indicator anywhere.
- Permission-denied errors surface as friendly notices, never raw errors.
- No Firebase Analytics. No user identifiers in crash reports.

## Not yet implemented (explicitly)

- Communities of Practice and the full evaluation battery (Phase 2, only
  if the pilot progresses) — see the platform README.
- The security rules (`../firestore.rules`, the single canonical copy)
  must be reviewed by a qualified security reviewer before real data.
  Deploy with `firebase deploy --only firestore:rules` after review.
- The security rules do not verify consent liveness on read (Firestore
  rules cannot join across documents). Liveness is enforced at grant
  time by the `grantAccess` Function, and revocation/expiry strips
  access via the `onConsentRevoke` trigger / `expireConsents` Function.

## Deploying

This scaffold is not deployed anywhere. Do not deploy without the security
review above, and never deploy with placeholder credentials.

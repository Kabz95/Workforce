# Contributing

This is the platform for the National Peer Support Workforce, Practice and Learning Network. It handles sensitive personal data. Read this before opening a pull request.

## Setup

```bash
cd functions && npm install && cd ..
cd web && npm install && cd ..
cp web/.env.example web/.env   # fill in your Firebase web config
firebase emulators:start        # in one terminal
VITE_USE_EMULATORS=true npm run dev   # in web/, another terminal
```

## Before you open a PR

```bash
cd functions && npx tsc --noEmit
cd ../web && npm run build
```

CI runs both on every push and PR. Keep both green.

## Hard rules (non-negotiable)

These come from the architecture spec (`../software/firebase-architecture-spec.md`) and the book's principles. A PR that breaks one is not merged, however useful it looks:

1. **The client never writes `sharedWith`.** Sharing goes through the `grantAccess` Cloud Function only; un-sharing through `onConsentRevoke` / `expireConsents`. Security rules enforce this.
2. **Every query is tenant-scoped** (`tenantId == claim`). No cross-hub reads.
3. **No admin view of worker records.** No activity feeds, no "last active" indicators, no per-worker dashboards for anyone but the worker.
4. **No Firebase Analytics** on worker-facing flows. No user identifiers in crash reports.
5. **Aggregates only.** The backbone sees de-identified aggregates; cells smaller than 5 are suppressed. Never add a query that reads raw `evaluationSubmissions` in bulk.
6. **Worker control.** New features that touch worker data must preserve export, deletion, consent expiry, and one-tap revocation.

## PR process

- Small, focused PRs. One concern per PR.
- Describe what the change does, which instruments it serves, and what you tested (emulator flows, not production).
- If you touch `firestore.rules` or `functions/`, say so explicitly — those get extra review.
- Do not include real personal data, credentials, or `.env` files in any commit, ever.

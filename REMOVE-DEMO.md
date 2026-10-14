# Remove the demo dataset (one-time, before production onboarding)

This procedure deletes the demo hub tenant, all demo/test data, and the
test accounts from the LIVE project, so production onboarding starts
from a clean slate. It is a manual, operator-run procedure — it is NOT
part of CI and is never run automatically.

**Order matters:** run this AFTER the production-onboarding code
(invitation model) is deployed, and BEFORE the first real hub is
seeded with `seed-first-hub.mjs`. The demo data is test data; the
production data does not exist yet, so there is nothing real to
preserve.

## Prerequisites

- You are in Cloud Shell, authenticated (`gcloud auth list` shows the
  project owner).
- The production-onboarding branch is deployed (rules + indexes +
  functions), so no new demo signups can occur while you clean.
- You have a copy of this checklist; you will verify each step.

## Steps

### 1. Confirm the target project

```bash
gcloud config get-value project
# Must print: peerworkforce
```

If it prints anything else, stop. The script below touches only the
project you pass via `--project`, but confirm anyway.

### 2. Dry-run (deletes nothing)

```bash
cd ~/Workforce/functions
node scripts/remove-demo.mjs --project peerworkforce
```

Review the output line by line. It must list ONLY demo data:

- Every collection shows docs with `tenantId == 'demo-hub'` (or zero).
- Auth users listed are test accounts (persons doc in the demo tenant,
  or `@example.test` emails).
- `tenants/demo-hub` exists.

If ANY line shows data you do not recognise as demo/test data, STOP.
Do not pass `--confirm`. Investigate first.

### 3. Delete

Only after reviewing the dry-run:

```bash
node scripts/remove-demo.mjs --project peerworkforce --confirm
```

The script deletes, in order: all demo-tenant docs across the
tenant-scoped collections (batched), the demo Auth users, then the
`tenants/demo-hub` doc itself. `idempotencyKeys` are left alone (they
carry no tenant marker and are harmless).

### 4. Verify (dry-run must now read zero)

```bash
node scripts/remove-demo.mjs --project peerworkforce
```

Every collection count must be `0`, auth users `0`,
`tenants/demo-hub` must read `absent`. If anything is non-zero,
re-run the `--confirm` command once, then dry-run again.

Spot-check in the Firebase Console:

- Firestore → `tenants` — no `demo-hub` doc.
- Authentication → Users — no `@example.test` accounts, no accounts
  you recognise as test accounts.
- Firestore → `roleGrants` — no grants with `tenantId == 'demo-hub'`.

### 5. Seed the first real hub

Now (and only now) run the one-time seeding script:

```bash
node scripts/seed-first-hub.mjs \
  --project peerworkforce \
  --tenant <TENANT_ID> \
  --name "<HUB DISPLAY NAME>" \
  --email <FIRST_ADMIN_EMAIL>
```

Then sign up in the app with that email; the two invitations
(backboneLead + hubCoordinator) are claimed on first sign-in.

### 6. Delete both scripts

```bash
rm functions/scripts/remove-demo.mjs functions/scripts/seed-first-hub.mjs
```

Both scripts are one-time tools. Deleting them removes the
temptation (and the risk) of re-running them.

## Safety notes

- `remove-demo.mjs` refuses any `--tenant` other than `'demo-hub'`.
  It cannot delete any other tenant's data.
- The demo dataset is test data. There is no backup step because
  there is nothing real to preserve — if you are unsure whether some
  data is demo or real, stop and ask before deleting.
- Never run these scripts against the emulator: they are for the
  live project only.

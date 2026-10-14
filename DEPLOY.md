# Deploying to Firebase

The app is already built for Firebase Hosting — no new code is needed. What remains is project setup (in the Firebase Console, under your Google account) and one deploy. Checklist:

## 1. Create the Firebase project

- [Firebase Console](https://console.firebase.google.com) → **Add project** → name it (e.g. `peer-workforce-platform`).
- Google Analytics: optional. Leave off for a pilot.
- **Billing:** Cloud Functions (2nd gen) require the **Blaze** pay-as-you-go plan. The free allowances cover a pilot, but a billing account must be attached. Firestore, Auth, and Hosting work on the free Spark plan.

## 2. Enable services (all in the Console)

- **Firestore Database** → Create database → **Native mode** → location **`northamerica-northeast1` (Montréal)**. Canadian data stays in Canada.
- **Authentication** → Sign-in method → enable **Email/Password** and **Google**.
- **Functions** → nothing to enable by hand; deploy creates them.
- **Hosting** → Get started (accept the defaults).

## 3. Point this repo at your project

```bash
# .firebaserc — replace the placeholder with your real project id
{ "projects": { "default": "YOUR-PROJECT-ID" } }
```

## 4. Configure the web app

Console → Project settings → Your apps → **Web app** (`</>`) → register the app, copy the config, and write `web/.env`:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
# leave VITE_USE_EMULATORS unset (or false) for production
```

Never commit `web/.env` — it is gitignored. (These values are public web identifiers, not secrets, but a real `.env` is never committed.)

## 5. Deploy

```bash
firebase login            # your Google account, on your machine
firebase deploy           # rules + indexes + functions + hosting
```

What deploys: `firestore.rules`, `firestore.indexes.json`, the six Cloud Functions, and the web app (`web/dist`).

## 6. Bootstrap the first hub (one-time)

Production onboarding is invitation-based: there is no open
self-registration and no default role. The first hub and the first
administrator are seeded with the one-time script (it refuses to run
twice — it checks for an existing backboneLead grant first):

```bash
cd functions
node scripts/seed-first-hub.mjs \
  --project peerworkforce \
  --tenant <TENANT_ID> \
  --name "<HUB DISPLAY NAME>" \
  --email <FIRST_ADMIN_EMAIL>
```

The script creates `tenants/<TENANT_ID>` plus two PENDING invitations
(backboneLead + hubCoordinator) for that email. The administrator
then signs up in the app with that email; `ensureMyPerson` claims
both invitations on first sign-in. Delete the script after use
(`rm functions/scripts/seed-first-hub.mjs`).

If you are migrating from a demo dataset, remove it first — see
[`REMOVE-DEMO.md`](REMOVE-DEMO.md). The script takes no secrets: the
project, tenant, name, and email come from argv. Run it in Cloud
Shell with Application Default Credentials; no service-account key
file is needed.

## 7. Verify

- Open the Hosting URL. Sign up with an invited email (or sign in).
- As a worker: create a profile + first-contact form, grant a consent, revoke it, export your data.
- As governance (after claiming an invitation): open Governance and Aggregates.
- Check **Firestore → Usage** and **Functions → Logs** for errors.

## Costs (pilot scale)

- Hosting: free tier covers a pilot (10 GB storage, 360 MB/day transfer).
- Firestore: free tier is generous for a pilot; watch read counts — dashboards read `aggregates`, never raw collections.
- Functions: 2M invocations/month free; scheduled jobs are tiny.
- Set a **billing budget alert** in Google Cloud Console on day one.

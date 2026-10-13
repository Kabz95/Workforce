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

## 6. Bootstrap the first admin

New users sign up with no role. The first admin/governance accounts need their role + tenant set via custom claims — there is no Console button for this. Use the script (one-time, needs a service-account key — see below):

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json \
  node set-claims.cjs <USER_UID> <ROLE> <TENANT_ID>
# e.g. node set-claims.cjs abc123 governance demo-hub
# roles: worker | navigator | supervisor | employer | hubAdmin | governance | backboneAnalyst | systemAdmin
```

Service-account key: Console → Project settings → Service accounts → **Generate new private key**. Treat the downloaded JSON like a password: use it once for this script, then delete the file. Never commit it.

The user must sign out and back in for the new claims to take effect (claims ride on the ID token).

## 7. Verify

- Open the Hosting URL. Sign up, then sign in.
- As a worker: create a profile + first-contact form, grant a consent, revoke it, export your data.
- As governance (after claims): open Governance and Aggregates.
- Check **Firestore → Usage** and **Functions → Logs** for errors.

## Costs (pilot scale)

- Hosting: free tier covers a pilot (10 GB storage, 360 MB/day transfer).
- Firestore: free tier is generous for a pilot; watch read counts — dashboards read `aggregates`, never raw collections.
- Functions: 2M invocations/month free; scheduled jobs are tiny.
- Set a **billing budget alert** in Google Cloud Console on day one.

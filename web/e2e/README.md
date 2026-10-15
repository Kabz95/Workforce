# End-to-end walkthrough (Playwright)

Automates the invitation-signup prologue + the seven acceptance
steps against the **Firebase emulators** (project `demo-workforce`)
— never the live project, never real data. One test; a failure
stops the run at the first broken step, with a screenshot attached
per step in the HTML report.

## Run locally

```bash
# Terminal 1 — build functions (the emulator serves the compiled lib/)
# + start emulators (from the repo root)
cd functions && npm run build && cd ..
firebase emulators:start --project demo-workforce --only auth,firestore,functions,storage

# Terminal 2 — from web/
npm run test:e2e
```

Production onboarding: `globalSetup` seeds only PENDING
invitations (no Auth users, no claims, no persons/users docs) and
writes the invited emails to `web/e2e/.e2e-users.json`
(gitignored). The spec then drives the real app in Chromium:

0. Each account (worker / navigator / coordinator) signs up via the
   invitation-gated UI ("Have an invitation?") → `ensureMyPerson`
   claims the pending grant on first sign-in; the uid is resolved
   from the persons doc by email.
1. Worker signs in → dashboard; creates a worker profile + two
   first-contact forms (one to share, one never shared).
2. Worker grants the navigator access to the shared form (Consents
   UI) → grant live; `sharedWith` gains the navigator; audit event.
3. Navigator signs in → sees ONLY the shared form.
4. Coordinator offers a handoff → navigator accepts, uses the shared
   record, closes it. (Grantees are read-only by design, so "acts"
   means accepting + using the shared record; the server handoff
   machine is covered by `functions/test/callable.test.mjs`.)
5. Worker opens the audit log → grant + accept events with actor,
   role, grant, purpose, result, time.
6. Worker revokes the consent → trigger strips `sharedWith`;
   navigator can no longer see the form.
7. Worker deletes their own data → job completes; owned docs gone,
   persons/users docs gone, grants revoked.

## Notes

- The spec builds the app with `VITE_USE_EMULATORS=true` and a forced
  `demo-workforce` config, so a local `web/.env` can never point it
  at a real project.
- Retries are 0: CI retries the whole command against a fresh
  emulator instead, so a retried run never sees state from a failed
  attempt.
- Debug a single run with the UI runner: `npx playwright test --ui`.
- Report: `web/playwright-report/index.html` (after a run).

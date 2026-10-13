# Security Policy

This platform holds sensitive personal data belonging to peer support workers. If you find a vulnerability, handle it with care.

## Reporting

**Use GitHub's private vulnerability reporting** ("Report a vulnerability" on the repository's Security tab). Do not open a public issue, post about it, or share it with anyone else until it is fixed.

Include:
- What you found, and what an attacker could do with it
- Steps to reproduce (emulator / local only — see below)
- Your suggested fix, if you have one

## Ground rules

- **Do not test against any production deployment.** Use the Firebase Emulator Suite locally.
- **Do not access, copy, or modify anyone else's data.**
- **Do not run automated scanners** against a hosted deployment.
- Give the maintainers a reasonable window to fix before any disclosure.

## Scope

In scope: `firestore.rules`, `functions/`, `web/` — especially anything that could let one user read another's record, bypass consent, defeat revocation, or re-identify aggregated data.

Out of scope: the Firebase platform itself (report to Google), denial-of-service, and issues that require physical access to a user's device.

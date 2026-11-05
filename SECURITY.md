# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories on
this repository: **Security → Report a vulnerability**
(https://github.com/ilGentEAcutoO/krai-a-beta/security/advisories/new).
Don't open a public issue for a vulnerability.

Include what you found, how to reproduce it, and the impact you expect. We'll
acknowledge the report and keep you posted on the fix. There is no bug bounty.

## Scope

This repository and the public demo at https://beta.krai-a.com (the Worker,
its `/api/*` routes and the static site).

## Data we hold

- **Audio:** streamed to the Meta Model API for transcription; we don't store
  audio.
- **Call text:** kept server-side only during the call and deleted after the
  call ends (at most 15 minutes later).
- **Visitors:** no accounts and no phone numbers; IPs are kept only as salted
  hashes for rate limits. API keys stay server-side.

Details: the "AI disclosure and privacy" section of [README.md](README.md).

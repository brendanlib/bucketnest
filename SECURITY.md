# Security policy

BucketNest holds people's financial records, so security reports get priority.

## Reporting a vulnerability

Please **don't** open a public issue. Instead, report it privately through
[GitHub security advisories](https://github.com/bucketnest/bucketnest/security/advisories/new),
or email **security@bucketnest.org**.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get
a reply within 3 working days, and a fix or a plan within 30 days for anything serious. We'll
credit you in the release notes unless you'd rather we didn't.

Please only test against your own installation or the public demo, never against
someone else's server or the hosted service's real accounts.

## Supported versions

Security fixes go into the latest release. Self-hosters should keep up to date:
`git pull && docker compose up -d --build`.

## How the app is protected

See [docs/security.md](docs/security.md) for the OWASP Top 10 review and the controls in place.

# Security review (OWASP Top 10, 2021)

Reviewed in Phase 6 against the code, the nginx configuration and the Compose setup. Each section lists the controls in place and anything fixed during the review. Accepted risks are listed at the end.

## A01 Broken access control

- Every record carries a non-null `household_id`. Repositories always filter by the caller's household. An ID from another household returns **404**, never 403, so it doesn't confirm the record exists.
- Database triggers reject cross-household references: splits to transactions and categories, and transactions to accounts. The database enforces isolation even if a query is wrong.
- Only the owner can delete the household, and must also enter the household name and their password.
- API tests cover isolation for every resource type.

- Household roles: only the **owner** can invite, remove members, hand over ownership or delete the household. Members can use every budget feature and can leave.

## A02 Cryptographic failures

- Passwords: Argon2id.
- Session, reset and invite tokens: 256-bit random. Only an HMAC-SHA256 (keyed with `SESSION_SECRET`) is stored, so a database leak yields no usable tokens.
- Cookies: `HttpOnly`, `Secure` and `SameSite`, with the `__Host-` prefix over HTTPS. HSTS is sent by the backend, and by Caddy in the deployment guide.
- **Fixed:** API responses now send `Cache-Control: no-store`, so financial data isn't kept by browsers or proxies, for example on a shared computer.

## A03 Injection

- SQL: Prisma with parameters throughout. Raw SQL only uses tagged templates, and the only `*Unsafe` calls are in the test harness.
- Input: every route has a strict Zod schema (unknown keys are rejected), with lengths and ranges.
- XSS: React escapes all output; there is no `dangerouslySetInnerHTML`. The Content Security Policy is `script-src 'self'` with no inline scripts.
- CSV exports: cells a spreadsheet would read as a formula (`= + - @`) are prefixed with `'`. Plain numbers are left as numbers.
- Rules match plain text only, never regular expressions, so there is no ReDoS.

## A04 Insecure design

- Auth endpoints: 5 requests a minute per IP, plus a per-email limit with exponential backoff after repeated failures.
- **Fixed:** household deletion checks a password, so it now has the same limit (it previously had only the general 300-a-minute API limit).
- **Fixed:** using a password reset link now cancels every other reset link for that user. So does changing the password or a CLI reset.
- Registration closes after the first user unless `ALLOW_REGISTRATION=true`. An advisory lock prevents a race for "first user".

## A05 Security misconfiguration

- The backend refuses to start with a missing, short or example `SESSION_SECRET`, an invalid `PUBLIC_URL`, or an invalid time zone.
- Errors use one shape, `{ error: { code, message } }`, with no stack traces or internal messages.
- PostgreSQL has no published port and sits on an internal Docker network. All containers run as non-root.
- **Fixed:**
  - nginx: security headers were declared at server level and then lost in any `location` that added its own header, so hashed assets had no CSP or Referrer-Policy. They now come from one included snippet, applied to every web-app location.
  - API responses no longer carry a second, conflicting set of headers from nginx; the backend (helmet) sets them.
  - A `Cross-Origin-Opener-Policy` header was added.
- **Fixed:** nginx allowed 6 MB request bodies everywhere. That was too much for ordinary API calls and too little for a 5 MB bank CSV sent as JSON, which would have failed with 413 in production but not in development. Now ordinary requests are limited to 2 MB and `/api/import/` to 15 MB.
- **Fixed:** the web app showed a crash message when a proxy returned an HTML error page (413, 502, 504). It now explains what happened.

## A06 Vulnerable and outdated components

- `npm audit --omit=dev` reported high-severity advisories:
  - nodemailer 7 (address-parser denial of service, recipient-domain bypass): **upgraded to nodemailer 10**.
  - `deepmerge-ts` < 8 via the Prisma CLI's config loader (stack exhaustion; reachable only from Prisma's own config file): **overridden to 8.x**.

  Both packages now report 0 vulnerabilities.
- Lockfiles are committed and images build with `npm ci`.

## A07 Identification and authentication failures

- Sessions are server-side and revocable (Settings → Security). They end after 7 days idle or 30 days in total.
- A login always issues a new session; changing the password signs out every other device.
- Passwords need 12+ characters, are checked against a list of common passwords, and can't be the user's email address.
- Login takes the same time whether or not the email exists: unknown emails are checked against a dummy hash.
- **Fixed:** "forgot password" sent its email before replying, so the response time showed whether an account existed. The email is now sent after the response.

- **Invites:**
  - The link carries its token after `#`, which browsers never send to the server, so it can't appear in server logs or a `Referer` header. The page removes it from the address bar once read.
  - Lookups and accepts send the token in a POST body, under the login rate limit.
  - Each invite works once (claimed atomically together with the new membership) and expires after 7 days.
  - An invite can be tied to one email address. Joining with any other address is refused.

## A08 Software and data integrity failures

- State-changing requests need a matching `Origin` and a double-submit CSRF token (an HMAC of the cookie). A request with neither `Origin` nor `Referer` is refused.
- No deserialisation of untrusted objects. CSV imports are parsed as text and re-parsed on commit; nothing from the browser is trusted between steps.

## A09 Security logging and monitoring failures

- Logged: logins, failed logins (with IP), password changes and resets, registrations, household deletion, job failures.
- Cookies, the CSRF token and the internal request key are redacted from request logs. Passwords and tokens are never logged.
- **Fixed:** nginx no longer writes `/reset-password?token=…` to its access log. The web app also removes the token from the address bar once read, so it doesn't stay in browser history or get sent as a `Referer`.

## A10 Server-side request forgery

- The server makes no outbound requests based on user input. The only outbound connection is SMTP, to the host in `.env`. Recipients are account emails validated at sign-up.

## Accepted risks

- **CSP allows inline styles** (`style-src 'unsafe-inline'`), because React sets style attributes. Scripts remain `'self'` only.
- **Rate-limit counters are in memory.** They reset when the backend restarts and aren't shared between replicas (the app runs one).
- **Registration says "an account with this email already exists"** while sign-up is open, which is normally only until the first user registers.
- **No two-factor authentication** in v1. For an internet-facing install, Cloudflare Access (or a VPN such as Tailscale) adds a second layer.

## Re-running the checks

```bash
cd backend && npm audit --omit=dev && npm test        # includes the isolation, CSRF, origin and rate-limit tests
cd frontend && npm audit --omit=dev
cd e2e && E2E_DEMO_PASSWORD=... npx playwright test a11y   # accessibility scan, with no console/CSP errors allowed
```

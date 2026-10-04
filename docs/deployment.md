# Deploying on Ubuntu

The app is three containers. Only `frontend` is reachable from outside.

```
Reverse proxy (TLS) ──▶ frontend (nginx :8080) ── /api ──▶ backend (:3000) ──▶ postgres
                          published port            internal only          internal only
```

nginx serves the web app and forwards `/api` to the backend, so the browser talks to a single origin. No API URL is baked into the build, and no CORS is needed.

## 1. Install Docker

Follow Docker's official instructions for Ubuntu (docker-ce plus the compose plugin), then check:

```bash
docker compose version
```

## 2. Configure

```bash
cd /opt/home-budget
cp .env.example .env
```

| Setting | What to put |
| --- | --- |
| `PUBLIC_URL` | The exact address people type, e.g. `https://budget.example.com`. It's used for origin checks and email links, so it must match. |
| `SESSION_SECRET` | `openssl rand -hex 32`. The backend refuses to start with a short or example value. |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24`. Hex is URL-safe, which matters because the password goes into a connection URL. |
| `TRUST_PROXY` | How many reverse proxies sit in front of the app. Use `1` for Nginx Proxy Manager, Traefik or Cloudflare Tunnel. |
| `ALLOW_REGISTRATION` | Leave blank: anyone can register until the first account exists, then sign-up closes. `true` keeps it open; `false` keeps it closed. |
| `SMTP_*` | Optional. Without SMTP, password resets use the CLI. |

### Client IPs and `TRUST_PROXY`

Rate limits and login logs use the client's IP address. The bundled nginx is always trusted as one hop. `TRUST_PROXY` says how many more hops (your reverse proxies) to trust beyond it.

- **Blank:** the backend trusts only nginx. Every request appears to come from your reverse proxy, which works but rate limits per IP become shared.
- **The right number:** the backend uses the real client IP, and anything a client writes into `X-Forwarded-For` further back is ignored.

## 3. Start

```bash
docker compose up -d
docker compose ps        # all three should become "healthy"
```

The backend applies database migrations on every start.

## Reverse proxy

The app must be served from a domain or subdomain root. Hosting under a path like `/budget` isn't supported.

### Nginx Proxy Manager

Add a proxy host for `budget.example.com` forwarding to `http://<server-ip>:8080`. On the SSL tab, request a certificate and turn on **Force SSL** and **HSTS**.

### Traefik

Remove the `ports:` block from `frontend` in `docker-compose.yml`, attach the service to Traefik's network, and use the commented labels in the compose file as a starting point.

### Cloudflare Tunnel

Create a tunnel in the Cloudflare dashboard with a public hostname pointing at `http://frontend:8080`. Put the token in `CLOUDFLARE_TUNNEL_TOKEN`, then run:

```bash
docker compose --profile tunnel up -d
```

Putting Cloudflare Access in front adds a second login layer.

## Testing on a LAN without HTTPS

Session cookies are `Secure` by default, so browsers only send them over HTTPS. For a quick test over plain HTTP on your own network, set:

```env
PUBLIC_URL=http://192.168.1.50:8080
COOKIE_SECURE=false
```

Switch back before exposing the app to the internet.

## Updating

```bash
cd /opt/home-budget
./scripts/backup.sh
git pull
docker compose up -d --build
```

## Security checklist

- PostgreSQL is never published to the host. Its Docker network has no outside route.
- Containers run as non-root users.
- `.env` holds every secret and is in `.gitignore`. Restrict it with `chmod 600 .env`.
- Banking passwords are never stored, and only the last 4 digits of account numbers.
- Logs exclude passwords, tokens and cookies. Logins, failed logins and password changes are logged.

# Deploying on an Ubuntu server

This guide takes a fresh Ubuntu 24.04 LTS virtual machine to a running Home Budget at `https://budget.example.com`, with automatic HTTPS, a firewall and nightly backups. Allow about 30 minutes.

The app runs as three containers. Only `frontend` is published, and Caddy on the host puts HTTPS in front of it:

```
Browser ──HTTPS──▶ Caddy (host, :443) ──▶ frontend (nginx, 127.0.0.1:8080) ── /api ──▶ backend ──▶ postgres
                   certificates, HSTS       web app + proxy                        internal only   internal only
```

Not on a public server? See [Other ways in](#other-ways-in) for a home server behind a router (Cloudflare Tunnel) or a LAN-only install.

## What you need

- **A VM:** Ubuntu 24.04 LTS (22.04 also works), 2 vCPU, **2 GB RAM** and 20 GB of disk. The images are built on the server, and the build needs about 1.5 GB of memory. With 1 GB of RAM, add swap first (step 2).
- **A domain name** with a DNS **A record** for `budget.example.com` pointing at the VM's public IP address. Create it now, because Caddy needs it to get a certificate.
- **SSH access** to the VM as a user with `sudo`.

## 1. Prepare the server

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades git
sudo dpkg-reconfigure -plow unattended-upgrades   # answer Yes: security updates install themselves
sudo timedatectl set-timezone Australia/Sydney    # your time zone; cron uses it
```

The firewall allows only SSH and web traffic:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> Ports published by Docker bypass ufw. This guide keeps the app's port on `127.0.0.1` (step 5), so Caddy is the only way in.

## 2. Add swap (1 GB VMs only)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Install Docker

These are Docker's official instructions for Ubuntu:

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in, so the group change applies, then check:

```bash
docker run --rm hello-world
docker compose version
```

## 4. Get the code onto the server

Push the project to a **private** Git repository (GitHub, GitLab, Gitea…) and clone it:

```bash
sudo mkdir -p /opt/home-budget && sudo chown "$USER": /opt/home-budget
git clone git@github.com:you/home-budget.git /opt/home-budget
```

For a private GitHub repository, add the VM's SSH key as a read-only deploy key first (`ssh-keygen -t ed25519`, then paste `~/.ssh/id_ed25519.pub` into the repository's Settings → Deploy keys).

No Git remote? Copy the folder from your computer instead:

```bash
rsync -av --exclude node_modules --exclude dist --exclude .env --exclude backups \
  ~/home-budget/ you@your-vm:/opt/home-budget/
```

## 5. Configure

```bash
cd /opt/home-budget
cp .env.example .env
chmod 600 .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
nano .env
```

In the editor, set:

| Setting | Value |
| --- | --- |
| `PUBLIC_URL` | `https://budget.example.com`. It must be exactly the address people type: it's used for origin checks and email links. |
| `APP_BIND` | `127.0.0.1`, because Caddy runs on this server. |
| `TRUST_PROXY` | `1` (Caddy). |
| `DEFAULT_TIMEZONE` | Your time zone, e.g. `Australia/Perth`. |
| `SMTP_*` | Optional; see [Email](#email). |

Leave `ALLOW_REGISTRATION` blank. The first person to sign up becomes the owner, and sign-up then closes.

## 6. Start the app

The inbox folder is where bank files for [folder import](#folder-import) go. Create it owned by the app's user (uid 1000), so the backend can move imported files:

```bash
mkdir -p inbox && sudo chown 1000:1000 inbox
```

```bash
docker compose up -d --build     # the first build takes a few minutes
docker compose ps                # wait until all three show "healthy"
curl -s http://127.0.0.1:8080/api/health/ready   # {"status":"ok","database":"ok"}
```

Migrations run automatically each time the backend starts.

## 7. Add HTTPS with Caddy

Caddy gets and renews Let's Encrypt certificates by itself.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Replace `/etc/caddy/Caddyfile` with:

```caddy
budget.example.com {
	reverse_proxy 127.0.0.1:8080
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	encode gzip
}
```

```bash
sudo systemctl reload caddy
```

Open `https://budget.example.com`, create your account, and you're running. Caddy sets `X-Forwarded-For` to the real client address, which is why `TRUST_PROXY=1` is correct.

### Using nginx instead of Caddy

If the server already runs nginx (or you prefer it), skip the Caddy install. Keep `APP_BIND=127.0.0.1` and `TRUST_PROXY=1` in `.env`.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl disable --now caddy 2>/dev/null || true   # only if Caddy was installed
sudo tee /etc/nginx/sites-available/home-budget > /dev/null <<'EOF2'
server {
    listen 80;
    listen [::]:80;
    server_name budget.example.com;

    # CSV imports send up to about 15 MB.
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
EOF2
sudo ln -sf /etc/nginx/sites-available/home-budget /etc/nginx/sites-enabled/home-budget
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d budget.example.com --redirect --agree-tos -m you@example.com
```

Certbot adds the HTTPS server block and renews the certificate automatically. The app sends its own HSTS header over HTTPS, so nothing more is needed in nginx. For nginx on a different machine, see [Nginx Proxy Manager or Traefik on another machine](#nginx-proxy-manager-or-traefik-on-another-machine): the same applies, with `proxy_pass http://<vm-ip>:8080;`.

## 8. Nightly backups

```bash
cd /opt/home-budget
./scripts/backup.sh && ls -l backups/     # check one works
crontab -e
```

Add:

```cron
0 2 * * * cd /opt/home-budget && ./scripts/backup.sh >> backups/backup.log 2>&1
```

**Copy backups off the VM.** A backup on the same disk won't survive losing the VM. For example, pull them nightly from another machine:

```bash
rsync -av you@your-vm:/opt/home-budget/backups/ ~/home-budget-backups/
```

Test a restore now and then. See [backup-restore.md](backup-restore.md).

## Updating

```bash
cd /opt/home-budget
./scripts/backup.sh
git pull
docker compose up -d --build
docker image prune -f      # remove the old images
```

## Email

Email is optional. Without it, password resets use the command line (`docker compose exec backend npm run reset-password -- you@example.com`) and alerts are in-app only.

The server sends from **one address** for everyone (for example `Home Budget <budget@example.com>`). Each person receives mail at their own login email. Use a transactional email service (Postmark, Amazon SES, Mailgun, Brevo, Resend…) or your own mail provider's SMTP, with the domain verified (SPF and DKIM) so messages don't land in spam:

```env
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=<from the provider>
SMTP_PASS=<from the provider>
SMTP_FROM=Home Budget <budget@example.com>
```

Port 465 uses TLS from the start; port 587 upgrades with STARTTLS. Apply the change with `docker compose up -d`. Many cloud providers block outgoing port 25, so use 587 or 465.

## Bank feeds

### Up Bank

Up gives its customers a personal API, so the app talks to Up directly, with no aggregator involved.

1. Get a token at api.up.com.au (or in the Up app: Data sharing → Personal Access Token).
2. Paste it into **Settings → Bank feeds**.
3. Choose which app account each Up account feeds, and the date to import from.

How it works:
- The token is checked with Up, stored encrypted (AES-256-GCM, with a key derived from `SESSION_SECRET`), and never sent back to a browser. **Changing `SESSION_SECRET` means connecting Up again.**
- The server needs outgoing HTTPS to `api.up.com.au`, and nothing else.
- Settled transactions sync every 30 minutes, or on demand with **Sync now**. Pending transactions import once they settle.
- Each sync is an import batch, so the usual duplicate checks, bill matching and rules apply, and it can be undone from the Import page.

### Folder import

For banks without their own API, give an account a folder in **Settings → Bank feeds**. Then drop that bank's CSV exports into `inbox/<folder>/` on the server: by hand with `scp`, or automatically with Syncthing, a NAS share or a phone sync app. Every 5 minutes the backend:

- imports new files with the account's saved column layout (do one import by hand on the Import page first, so it knows the columns);
- moves each file to `imported/`, or to `failed/` with a `.error.txt` beside it saying why;
- waits for files changed in the last 30 seconds, so half-copied files aren't read.

Re-dropping a file you've already imported adds nothing.

## Trying it with demo data

To look around before entering real data, set `SEED_DEMO=true` (and optionally `DEMO_PASSWORD`) in `.env` **before the first start**. The backend then creates `demo@example.com` with a year of realistic transactions, schedules, sinking funds, debts and goals. Without `DEMO_PASSWORD`, the password is printed in `docker compose logs backend`.

On a server that's already running: `docker compose exec backend npm run seed:demo`.

When you're done, delete the demo household in **Settings → Data**. That also removes the demo user, so registration opens again for your own first account (when `ALLOW_REGISTRATION` is blank).

## Other ways in

### Home server behind a router: Cloudflare Tunnel

There's nothing to open on your router, and no public IP is needed. In the Cloudflare dashboard (Zero Trust → Networks → Tunnels), create a tunnel with a public hostname pointing at `http://frontend:8080`. Then, in `.env`:

```env
PUBLIC_URL=https://budget.example.com
TRUST_PROXY=1
APP_BIND=127.0.0.1
CLOUDFLARE_TUNNEL_TOKEN=<token>
```

```bash
docker compose --profile tunnel up -d --build
```

Skip Caddy and the 80/443 firewall rules. Adding Cloudflare Access in front gives a second login layer.

### Nginx Proxy Manager or Traefik on another machine

Set `APP_BIND=0.0.0.0` and allow port 8080 from that machine only (`sudo ufw allow from <proxy-ip> to any port 8080`). Remember Docker bypasses ufw for published ports, so prefer a private network between the two.

- **Nginx Proxy Manager:** a proxy host to `http://<vm-ip>:8080`, with SSL, Force SSL and HSTS on.
- **Traefik:** remove `ports:` from `frontend`, join Traefik's network, and use the commented labels in `docker-compose.yml`.

### LAN only, no HTTPS

For a quick test on your own network:

```env
PUBLIC_URL=http://192.168.1.50:8080
APP_BIND=0.0.0.0
COOKIE_SECURE=false
TRUST_PROXY=
```

Session cookies are `Secure` by default, and browsers only send those over HTTPS, so `COOKIE_SECURE=false` is required here. Never expose this setup to the internet. For remote access without opening ports, Tailscale on the VM is a good alternative.

The app must be served from a domain or subdomain root. Hosting under a path like `/budget` isn't supported.

## Client IPs and `TRUST_PROXY`

Rate limits and login logs use the client's IP address. The bundled nginx is always trusted as one hop. `TRUST_PROXY` says how many more proxies (yours) sit in front of it.

- **Blank:** every request appears to come from your proxy. That works, but the per-IP rate limits become shared.
- **The right number:** the backend sees the real client IP, and anything a client writes into `X-Forwarded-For` beyond your proxies is ignored.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "This request did not come from the app" | `PUBLIC_URL` doesn't exactly match the address in the browser (scheme, host and port). Fix it, then `docker compose up -d`. |
| Login succeeds but you're straight back at the login page | You're on plain HTTP with `COOKIE_SECURE=true`. Use HTTPS, or see [LAN only](#lan-only-no-https). |
| "The server is not responding" / 502 | The backend is starting or has stopped: `docker compose ps` and `docker compose logs backend`. |
| The backend exits at start with "Invalid configuration" | The log names the setting. `SESSION_SECRET` must be at least 32 characters and not the example. |
| The build is killed or hangs | Out of memory: add swap (step 2). |
| Caddy can't get a certificate | The DNS A record must point at this VM, and ports 80 and 443 must be open. Check `journalctl -u caddy`. |
| Everyone gets "Too many requests" together | `TRUST_PROXY` is blank behind a proxy, so all clients share one IP. |

## Security checklist

- PostgreSQL is never published. Its Docker network has no route outside.
- The app's port listens on `127.0.0.1` behind Caddy, and ufw allows only SSH, 80 and 443.
- Containers run as non-root users.
- `.env` holds every secret, is `chmod 600`, and is never committed.
- HTTPS everywhere, with HSTS from Caddy (and from the backend when `COOKIE_SECURE` is on).
- Banking passwords are never stored, and only the last 4 digits of account numbers.
- Logs exclude passwords, tokens and cookies. Logins, failed logins and password changes are logged.
- Security updates install automatically (unattended-upgrades). Update the app with `git pull && docker compose up -d --build`.
- Backups run nightly and are copied off the server.
- Bank tokens are encrypted at rest, only ever sent to the bank's own API host, and can only read data.

See [security.md](security.md) for the OWASP Top 10 review.

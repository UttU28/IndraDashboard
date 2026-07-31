# Indra

One web page to see the status of every project on this Desktop and control
them with one click — **PM2 apps, Docker stacks, ports, and public domains**.

- **Status**: PM2 process state, Docker container state, local port reachability,
  and HTTPS status code for each domain — refreshed every 10s.
- **Actions** (no sudo): `Pull`, `Restart`, `Rebuild`, `Stop`, `Start`, `Logs`.
  Docker start/rebuild are **scoped** to `compose_services` in `projects.yaml`
  (so Saral never brings up its nginx/certbot on :80/:443).
- **Deploy** button is **off by default** (`deploy.safe: false`). Full nginx/SSL
  deploys still belong in a terminal until you explicitly mark a project safe.

Runs on `127.0.0.1:9282`; put nginx in front for a domain (`nginx-indra.conf`).

## Why this exists

Your stack is mixed: some projects run under **PM2** (as your user), others as
**Docker Compose** stacks, all fronted by **nginx**. No single off-the-shelf tool
covers that combination, so Indra reads them all from `projects.yaml`
(generated from `~/Desktop/PORTS.md`).

## Setup

```bash
cd ~/Desktop/Indra
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# Run (foreground, to test):
venv/bin/uvicorn app:app --host 127.0.0.1 --port 9282
# open http://127.0.0.1:9282
```

Keep it running with PM2 (matches your other projects):

```bash
cd ~/Desktop/Indra
pm2 start ecosystem.config.cjs
pm2 save
```

## Auth (recommended)

Indra can restart/stop services, so protect it. Set HTTP Basic creds via env
(uncomment in `ecosystem.config.cjs`, then `pm2 restart indra`):

```
DASH_USER=admin
DASH_PASS=<a long random secret>
```

Also consider LAN-only access (IP allowlist in `nginx-dashboard.conf`).

## What is safe to click

| Action | Safe? | Notes |
|--------|-------|-------|
| Status / Logs | Yes | Read-only |
| Pull | Yes | Stash → pull → stash pop; conflicts shown in modal |
| Restart / Stop | Yes for running PM2 + scoped Docker | Missing PM2 names error but Docker still runs |
| Start / Rebuild | Yes when `compose_services` is set | Saral only starts `sjv-redis api frontend` (not nginx) |
| Deploy | **Hidden** until `deploy.safe: true` | Use terminal `sudo bash …/deploy.sh` for now |

## The "Deploy" button and sudo

`deploy.sh` scripts touch nginx/certbot, which need **sudo**, and your sudo
requires a password — so a web app cannot run them silently. Options:

1. **App-level actions only (default & safest).** Use `Restart` / `Rebuild` for
   day-to-day. These need no sudo and cover ~95% of "redeploy my app".

2. **Passwordless sudo for deploys.** Add a limited sudoers rule so the specific
   deploy scripts run without a password:

   ```bash
   sudo visudo -f /etc/sudoers.d/dashboard-deploy
   ```
   ```
   dedsec995 ALL=(root) NOPASSWD: /usr/bin/bash /home/dedsec995/Desktop/*/deploy.sh, \
       /usr/bin/bash /home/dedsec995/Desktop/*/*/deploy.sh
   ```
   Then the `Deploy` button works via `sudo -n`.

3. **Type the password in the UI.** Set `ALLOW_SUDO_PASSWORD=1` and enter your
   sudo password in the deploy modal (used once for that command, never stored).
   Only do this over the LAN / behind auth.

## Adding or changing a project

Edit `projects.yaml` — each entry maps a project to its PM2 names, Docker
compose dir + services, ports, domains, git repos, and deploy script. No code changes.

## Port

Uses **9282** (the next free frontend slot in `PORTS.md`). 9283 stays free.
Live at https://indra.thatinsaneguy.com

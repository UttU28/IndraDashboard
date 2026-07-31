/**
 * PM2: uvicorn on 127.0.0.1 (TLS terminated at nginx → indra.thatinsaneguy.com).
 * Port must match DASHBOARD_PORT in deploy.sh / nginx upstream (default 9282).
 * Typically started by ./deploy.sh in this directory.
 */
const path = require("path");

const ROOT = __dirname;
const port = process.env.DASHBOARD_PORT || "9282";

module.exports = {
  apps: [
    {
      name: "indra",
      cwd: ROOT,
      script: path.join(ROOT, "venv/bin/python"),
      args: ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(port)],
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      env: {
        NODE_ENV: "production",
        // Enable HTTP Basic auth (recommended behind a public domain):
        // DASH_USER: "admin",
        // DASH_PASS: "change-me",
        // Allow the UI to run `sudo -S bash deploy.sh` with a typed password:
        // ALLOW_SUDO_PASSWORD: "1",
      },
    },
  ],
};

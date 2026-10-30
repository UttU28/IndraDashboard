"use strict";
/* Indra — operations console. Talks to /api/status, /api/action, /api/server,
   /api/infra, /api/games/stop and /api/jobs/:id (see app.py). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------------ icons */
// Line icons in the Lucide style (24×24, stroke).
const ICONS = {
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  restart: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  hammer: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  pull: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  wrap: '<line x1="3" x2="21" y1="6" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" x2="10" y1="18" y2="18"/>',
  follow: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  steps: '<path d="M4 17h4v-4h4V9h4V5h4"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  habit: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  git: '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  sync: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
};
const ico = (name, cls = "") =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

/* ----------------------------------------------------------------- brands */
// Same marks and keyword order as the Apeksha app's Indra screen (app/lib/ui/brand_icons.dart).
const SI = window.simpleIcons || {};
const si = (slug, color) => ({ kind: "si", slug, color: lift(color || (SI[slug] && SI[slug].hex) || "#94a3b8") });
const glyph = (name, color) => ({ kind: "glyph", name, color });
const image = (src, color) => ({ kind: "img", src, color });

/** Brand colour lifted until it reads on the dark surfaces (Ollama, Steam, MariaDB are near black). */
function lift(hex) {
  let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lum = () => [r, g, b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
    .reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
  for (let k = 0; k < 6 && lum() < .12; k++) { r += (255 - r) * .3; g += (255 - g) * .3; b += (255 - b) * .3; }
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

const B = {
  apeksha: image("/static/brand/apeksha.png?v=1", "#2dd4bf"),
  indra: image("/static/brand/indra.png?v=1", "#38bdf8"),
  kubernetes: si("kubernetes"),
  docker: si("docker"),
  pm2: si("pm2", "#8B5CF6"), // brand navy is invisible on dark
  steam: si("steam"),
  argo: si("argo"),
  systemd: glyph("cpu", "#94a3b8"),
};
/** Keyword → logo, checked in order. Specific names first ("immich-postgres" before "immich"). */
const BRAND_KEYS = [
  ["apeksha", B.apeksha],
  ["bhasini", si("python")],
  ["indra", B.indra],
  ["habit", glyph("habit", "#22c55e")],
  ["nextcloud-redis", si("redis")],
  ["nextcloud-db", si("mariadb")],
  ["immich-machine-learning", si("tensorflow")],
  ["immich-postgres", si("postgresql")],
  ["immich-redis", si("redis")],
  ["nextcloud", si("nextcloud")],
  ["immich", si("immich")],
  ["jellyfin", si("jellyfin")],
  ["sunshine", glyph("sun", "#fbbf24")],
  ["octopi", si("octoprint")],
  ["octoprint", si("octoprint")],
  ["ingress-nginx", si("nginx")],
  ["nginx", si("nginx")],
  ["cert-manager", si("letsencrypt", "#4F9BE0")],
  ["docker", B.docker],
  ["transmission", si("transmission")],
  ["ollama", si("ollama")],
  ["k3s", B.kubernetes],
  ["kubernetes", B.kubernetes],
  ["argo", B.argo],
  ["steam", B.steam],
  ["saral", glyph("briefcase", "#818cf8")],
  ["link-it-up", glyph("link", "#2dd4bf")],
  ["linkitup", glyph("link", "#2dd4bf")],
  ["redis", si("redis")],
  ["postgres", si("postgresql")],
  ["mariadb", si("mariadb")],
  ["python", si("python")],
];
function brandFor(texts, fallback = B.docker) {
  for (const t of texts) {
    const low = String(t || "").toLowerCase();
    if (!low) continue;
    for (const [key, brand] of BRAND_KEYS) if (low.includes(key)) return brand;
  }
  return fallback;
}
const CAT_FALLBACK = {
  "web-app": glyph("globe", "#7c8cff"),
  "self-hosted": glyph("server", "#7c8cff"),
  "lan-device": glyph("wifi", "#60a5fa"),
};

function brandInner(b) {
  if (b.kind === "img") return `<img src="${esc(b.src)}" alt="" loading="lazy" />`;
  if (b.kind === "si") {
    const icon = SI[b.slug];
    return icon ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${icon.path}"/></svg>` : ico("box");
  }
  return ico(b.name);
}
function badge(b, size = "", status = "") {
  return `<span class="badge ${size}" style="--b:${b.color}">${brandInner(b)}${status ? `<span class="sdot ${status}"></span>` : ""}</span>`;
}
const mini = b => `<span class="mini" style="--b:${b.color}">${brandInner(b)}</span>`;

/* ------------------------------------------------------------------- meta */
const HEALTH = {
  up: { label: "Healthy" },
  partial: { label: "Degraded" },
  down: { label: "Down" },
  monitor: { label: "Monitor" },
};
const ACT = {
  pull: { label: "Pull", verb: "Pulling", icon: "pull", tip: "git pull the project's repos" },
  restart: { label: "Restart", verb: "Restarting", icon: "restart", tip: "Restart PM2 processes and containers" },
  rebuild: { label: "Rebuild", verb: "Rebuilding", icon: "hammer", tip: "Rebuild and restart with the latest code" },
  logs: { label: "Logs", verb: "Loading logs", icon: "terminal", tip: "Show recent logs" },
  stop: { label: "Stop", verb: "Stopping", icon: "stop", tip: "Stop" },
  start: { label: "Start", verb: "Starting", icon: "play", tip: "Start" },
  deploy: { label: "Deploy", verb: "Deploying", icon: "rocket", tip: "Run deploy.sh" },
  stop_all: { label: "Stop all", verb: "Stopping everything", icon: "power" },
  start_all: { label: "Start all", verb: "Starting everything", icon: "play" },
};
const SECTIONS = [
  { key: "web-app", title: "Web apps", icon: "globe" },
  { key: "self-hosted", title: "Self-hosted", icon: "server" },
  { key: "kubernetes", title: "Kubernetes", brand: B.kubernetes },
  { key: "lan-device", title: "LAN devices", icon: "wifi" },
  { key: "infra", title: "Infrastructure", icon: "cpu" },
];

const SERVER_TEXT = {
  stop_all: {
    tone: "danger", icon: "power", title: "Stop everything?", ok: "Stop all",
    note: "Sites will go offline.",
    body: `<p>This stops everything hosted on this machine except Apeksha:</p>
      <ul>
        <li>${mini(glyph("habit", "#22c55e"))} Habit Tracker</li>
        <li>${mini(si("jellyfin"))} Jellyfin, Immich, Nextcloud, Transmission</li>
        <li>${mini(B.kubernetes)} Kubernetes: Argo CD, Link It Up, Saral</li>
      </ul>
      <p class="muted">Left running: Apeksha (the main console at apeksha.thatinsaneguy.com/ops), Indra (this page), nginx, Docker, Sunshine and Steam. Games are not touched.
      Stopped apps stay stopped after a reboot until you press Start all.</p>
      <p class="muted">Runs <code>bash ~/Desktop/deploy.sh 9</code></p>`,
  },
  start_all: {
    tone: "good", icon: "play", title: "Start everything?", ok: "Start all",
    note: "Running apps are restarted.",
    body: `<p>This brings everything back, in this order:</p>
      <ol>
        <li><span class="step">1</span>${mini(B.kubernetes)} Kubernetes (Argo CD, Link It Up, Saral) — first, so apps that need it find it up</li>
        <li><span class="step">2</span>${mini(B.apeksha)} Apeksha, Habit Tracker</li>
        <li><span class="step">3</span>${mini(si("jellyfin"))} Jellyfin, Immich, Nextcloud, Transmission</li>
      </ol>
      <p class="muted">It is the normal deploy, so it also rebuilds anything whose code changed. It can take several
      minutes. Indra itself is not restarted.</p>
      <p class="muted">Runs <code>bash ~/Desktop/deploy.sh 1,2,3,8</code></p>`,
  },
};

/* ------------------------------------------------------------------ state */
const state = {
  status: null,
  lastOk: 0,
  error: null,
  loading: false,
  drawn: false,
  live: true,
  gameBusy: false,
  filter: { q: "", cat: "all", issues: false },
};
/** id → job record (this tab's jobs, plus a server job found running on load) */
const jobs = new Map();
/** project id → "rebuild" | "restart" after a pull brought new commits */
const suggestedAfterPull = {};
const lastHealth = new Map();

/* -------------------------------------------------------------------- api */
async function api(path, opts) {
  const r = await fetch(path, opts);
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    const err = new Error((data && (data.detail || data.message)) || text || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ------------------------------------------------------------------ utils */
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
const host = url => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function htmlEl(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Keyed DOM update: only replaces items whose HTML changed, so hover and animations survive refreshes. */
function reconcile(container, items, { enter = false } = {}) {
  const existing = new Map();
  [...container.children].forEach(el => { if (el.dataset.key) existing.set(el.dataset.key, el); else el.remove(); });
  let prev = null;
  items.forEach((it, idx) => {
    let el = existing.get(it.key);
    if (!el || el._html !== it.html) {
      const n = htmlEl(it.html);
      n.dataset.key = it.key;
      n._html = it.html;
      if (it.search != null) n.dataset.search = it.search;
      if (it.cat != null) n.dataset.cat = it.cat;
      if (it.issue != null) n.dataset.issue = it.issue ? "1" : "";
      if (enter && n.classList.contains("card")) { n.classList.add("enter"); n.style.setProperty("--i", idx); }
      if (el && it.health && el._health && el._health !== it.health) n.classList.add("changed");
      n._health = it.health;
      if (el) { n.hidden = el.hidden; el.replaceWith(n); }
      el = n;
    }
    existing.delete(it.key);
    const want = prev ? prev.nextElementSibling : container.firstElementChild;
    if (want !== el) container.insertBefore(el, want);
    prev = el;
  });
  existing.forEach(el => el.remove());
}

/* ------------------------------------------------------------------- jobs */
function activeJob(key) {
  for (const j of jobs.values()) if (j.key === key && !j.done && !j.quiet) return j;
  return null;
}

function trackJob(id, meta) {
  if (jobs.has(id)) return jobs.get(id);
  const j = {
    id, output: "", done: false, rc: null, conflicts: false, lost: false,
    started: Date.now(), finished: null, ...meta,
  };
  jobs.set(id, j);
  pruneJobs();
  pollJob(j);
  drawJobsUi();
  return j;
}

function pruneJobs() {
  // Keep the last few log reads; they are re-created on every reload / live tail tick.
  const quiet = [...jobs.values()].filter(j => j.quiet && j.done && j.id !== con.jobId);
  quiet.slice(0, Math.max(0, quiet.length - 3)).forEach(j => jobs.delete(j.id));
}

async function pollJob(j) {
  let misses = 0;
  while (!j.done) {
    try {
      const r = await api("/api/jobs/" + j.id);
      misses = 0;
      j.output = r.output || "";
      if (j.attached && r.started) j.started = r.started * 1000;
      if (r.done) {
        j.done = true;
        j.rc = r.rc;
        j.conflicts = !!r.conflicts;
        j.finished = r.finished ? Math.max(j.started, r.finished * 1000) : Date.now();
        if (j.action === "pull" && r.updated && !r.conflicts && !r.applied && j.project) {
          const p = (state.status?.projects || []).find(x => x.id === j.project);
          suggestedAfterPull[j.project] = p?.has_rebuild ? "rebuild" : "restart";
        }
      }
    } catch (e) {
      if (e.status === 404 || ++misses > 20) {
        j.done = true; j.lost = true; j.rc = -1; j.finished = Date.now();
        if (e.status === 404) j.output += "\n[Indra] This job is gone — the server was probably restarted.\n";
      }
    }
    if (con.jobId === j.id) consoleUpdate();
    if (j.done) break;
    await sleep(con.jobId === j.id ? 600 : 1500);
  }
  onJobDone(j);
}

function jobOutcome(j) {
  if (!j.done) return "run";
  if (j.conflicts) return "warn";
  return j.rc === 0 ? "ok" : "fail";
}

function onJobDone(j) {
  drawJobsUi();
  if (con.jobId === j.id) consoleUpdate();
  if (j.quiet) return;
  if (con.jobId !== j.id || document.hidden) {
    const o = jobOutcome(j);
    toast({
      tone: o,
      title: `${j.name} · ${ACT[j.action]?.label || j.action}`,
      msg: o === "ok" ? `Finished in ${fmtDur(j.finished - j.started)}.`
        : o === "warn" ? "Pulled with merge conflicts — open the log to see which files."
        : j.lost ? "Lost track of this job." : `Failed with exit code ${j.rc}.`,
      job: j.id,
    });
  }
  refresh();
}

/* ------------------------------------------------------------------ cards */
function chipFor(name, st, kind) {
  const b = brandFor([name], kind === "docker" ? B.docker : B.pm2);
  const good = st === "online" || st === "running";
  const cls = good ? "ok" : st === "missing" ? "idle" : "bad";
  return `<span class="chip ${cls}" title="${kind}: ${esc(name)} — ${esc(st)}">${mini(b)}<span class="nm">${esc(name)}</span><span class="st">${esc(st)}</span></span>`;
}
const portChip = p => `<span class="chip port ${p.open ? "ok" : "bad"}" title="127.0.0.1:${p.port} ${p.open ? "is listening" : "is closed"}"><span class="led"></span>${p.port}<span class="lbl">${esc(p.label)}</span></span>`;
function domainLink(d) {
  const code = d.code;
  const cls = code == null ? "bad" : code < 400 ? "ok" : code === 401 || code === 403 ? "warn" : "bad";
  return `<a class="link ${cls}" href="${esc(d.url)}" target="_blank" rel="noopener" title="${esc(d.url)} — ${code ?? "no response"}"><span class="code">${code ?? "—"}</span><span class="host">${esc(host(d.url))}</span>${ico("external")}</a>`;
}
const row = (label, vals, cls = "") => `<div class="row"><span class="lbl">${label}</span><div class="vals ${cls}">${vals}</div></div>`;
const htag = h => `<span class="htag ${h}">${HEALTH[h]?.label || h}</span>`;

function actBtn(target, a, { cls = "", job = null, iconOnly = false, data = "data-act=\"proj\"" } = {}) {
  const running = job && job.action === a;
  const disabled = job && a !== "logs";
  const meta = ACT[a];
  const label = iconOnly ? "" : `<span>${meta.label}</span>`;
  return `<button class="btn sm ${iconOnly ? "icon" : ""} ${cls}" type="button" ${data} data-t="${esc(target)}" data-a="${a}" title="${esc(meta.tip || meta.label)}" aria-label="${meta.label}" ${disabled ? "disabled" : ""}>${running ? '<span class="spinner"></span>' : ico(meta.icon)}${label}</button>`;
}
const busyStrip = j => `<button class="busy-strip" type="button" data-act="open-job" data-job="${j.id}"><span class="spinner"></span><b>${ACT[j.action]?.verb || j.action}…</b><span data-since="${j.started}"></span><span class="grow"></span><span class="view">View log ${ico("chevRight")}</span></button>`;

function projectCard(p) {
  const key = "p:" + p.id;
  const b = brandFor([p.id, p.name], CAT_FALLBACK[p.category] || glyph("box", "#94a3b8"));
  const job = activeJob(key);
  const pm2 = Object.entries(p.pm2 || {}), docker = Object.entries(p.docker || {});
  const chips = [...pm2.map(([n, s]) => chipFor(n, s, "pm2")), ...docker.map(([n, s]) => chipFor(n, s, "docker"))];
  if (p.has_docker && !docker.length) chips.push(`<span class="chip idle">${mini(B.docker)}<span class="nm">compose</span></span>`);

  const rows = [];
  if (chips.length) rows.push(row("Services", chips.join("")));
  if (p.ports?.length) rows.push(row("Ports", p.ports.map(portChip).join("")));
  if (p.domains?.length) rows.push(row("Web", p.domains.map(domainLink).join(""), "col"));

  const controllable = pm2.length > 0 || p.has_docker;
  const suggest = suggestedAfterPull[p.id];
  const acts = [];
  if (controllable) acts.push(actBtn(p.id, "logs", { job }));
  if (controllable) acts.push(actBtn(p.id, "restart", { job, cls: suggest === "restart" ? "suggested" : "" }));
  if (controllable && p.has_rebuild) acts.push(actBtn(p.id, "rebuild", { job, cls: suggest === "rebuild" ? "suggested" : "" }));
  if (p.has_git) acts.push(actBtn(p.id, "pull", { job }));
  if (p.deploy) acts.push(actBtn(p.id, "deploy", { job }));
  const power = controllable
    ? `<span class="power">${actBtn(p.id, "start", { job, iconOnly: true, cls: p.health === "down" ? "good" : "" })}${actBtn(p.id, "stop", { job, iconOnly: true, cls: "danger" })}</span>`
    : "";

  const sub = [
    p.category.replace("-", " "),
    pm2.length + docker.length ? plural(pm2.length + docker.length, "service") : "",
    p.ports?.length ? plural(p.ports.length, "port") : "",
  ].filter(Boolean).join(" · ");

  const html = `<article class="card st-${p.health}" style="--b:${b.color}">
    ${job ? '<div class="progress"></div>' : ""}
    <div class="card-head">${badge(b, "", p.health)}
      <div class="card-title"><h3>${esc(p.name)}</h3><p>${esc(sub)}</p></div>${htag(p.health)}</div>
    ${rows.length ? `<div class="rows">${rows.join("")}</div>` : ""}
    ${p.notes ? `<p class="note">${ico("info")}<span>${esc(p.notes)}</span></p>` : ""}
    ${suggest && !job ? `<div class="hint">${ico("arrowDown")}<span>Updates pulled — press <b>${suggest === "rebuild" ? "Rebuild" : "Restart"}</b> to apply them.</span></div>` : ""}
    ${job ? busyStrip(job) : ""}
    ${acts.length || power ? `<div class="actions">${acts.join("")}${power}</div>` : ""}
  </article>`;
  const search = [p.id, p.name, p.category, p.notes, ...pm2.map(x => x[0]), ...docker.map(x => x[0]),
    ...(p.ports || []).map(x => `${x.port} ${x.label}`), ...(p.domains || []).map(x => x.url)].join(" ").toLowerCase();
  return { key, html, search, cat: p.category, issue: p.health === "down" || p.health === "partial", health: p.health };
}

function argoCard(a) {
  const b = brandFor([a.name], B.kubernetes);
  const state_ = a.state || "partial";
  const syncCls = a.sync === "Synced" ? "ok" : "warn";
  const healthCls = a.health === "Healthy" ? "ok" : a.state === "down" ? "bad" : "warn";
  const rows = [
    row("Status", `<span class="chip ${syncCls}"><span class="led"></span><span class="nm">${esc(a.sync)}</span></span>
      <span class="chip ${healthCls}">${ico("heart")}<span class="nm">${esc(a.health)}</span></span>`),
  ];
  const src = [];
  if (a.path) src.push(`<span class="chip">${ico("folder")}<span class="nm">${esc(a.path)}</span></span>`);
  if (a.revision) src.push(`<span class="chip port">${mini(si("git"))}${esc(a.revision)}</span>`);
  if (src.length) rows.push(row("Source", src.join("")));
  if (a.urls?.length) rows.push(row("Web", a.urls.map(u => `<a class="link ${a.health === "Healthy" ? "ok" : "warn"}" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(u)}"><span class="code">${ico("globe")}</span><span class="host">${esc(host(u))}</span>${ico("external")}</a>`).join(""), "col"));
  const html = `<article class="card st-${state_}" style="--b:${b.color}">
    <div class="card-head">${badge(b, "", state_)}
      <div class="card-title"><h3>${esc(a.name)}</h3><p>Argo CD application</p></div>${htag(state_)}</div>
    <div class="rows">${rows.join("")}</div>
    <div class="actions"><a class="btn sm" href="/argocd/applications/argocd/${encodeURIComponent(a.name)}" target="_blank" rel="noopener">${mini(B.argo)}<span>Open in Argo CD</span></a></div>
  </article>`;
  return { key: "a:" + a.name, html, search: [a.name, a.path, ...(a.urls || []), "argo kubernetes"].join(" ").toLowerCase(), cat: "kubernetes", issue: state_ !== "up", health: state_ };
}

function noticeCard(key, b, title, text, h) {
  const html = `<article class="card st-${h}" style="--b:${b.color}">
    <div class="card-head">${badge(b, "", h)}<div class="card-title"><h3>${esc(title)}</h3><p>Kubernetes</p></div>${htag(h)}</div>
    <p class="note">${ico("info")}<span>${text}</span></p>
  </article>`;
  return { key, html, search: "kubernetes k3s argo " + title.toLowerCase(), cat: "kubernetes", issue: true, health: h };
}

function infraCard(i) {
  const key = "i:" + i.id;
  const b = brandFor([i.id, i.name], B.systemd);
  const hasUnit = "active" in i;
  const portsOpen = (i.ports || []).some(p => p.open);
  const unitOk = hasUnit ? i.active : true;
  const portsOk = i.ports ? portsOpen : true;
  const h = unitOk && portsOk ? "up" : (hasUnit && i.active) || portsOpen ? "partial" : "down";
  const job = activeJob(key);
  const rows = [];
  if (hasUnit) {
    const st = i.state || (i.active ? "active" : "inactive");
    rows.push(row("Service", `<span class="chip ${i.active ? "ok" : "bad"}">${ico("cpu")}<span class="nm">systemd</span><span class="st">${esc(st)}</span></span>`));
  }
  if (i.ports?.length) rows.push(row("Ports", i.ports.map(portChip).join("")));
  const data = 'data-act="infra"';
  const acts = i.control
    ? [actBtn(i.id, "restart", { job, data }),
       `<span class="power">${actBtn(i.id, "start", { job, data, iconOnly: true, cls: h === "down" ? "good" : "" })}${actBtn(i.id, "stop", { job, data, iconOnly: true, cls: "danger" })}</span>`]
    : [];
  const html = `<article class="card st-${h}" style="--b:${b.color}">
    ${job ? '<div class="progress"></div>' : ""}
    <div class="card-head">${badge(b, "", h)}
      <div class="card-title"><h3>${esc(i.name)}</h3><p>${hasUnit ? "systemd service" : "infrastructure"}</p></div>${htag(h)}</div>
    ${rows.length ? `<div class="rows">${rows.join("")}</div>` : ""}
    ${job ? busyStrip(job) : ""}
    ${acts.length ? `<div class="actions">${acts.join("")}</div>` : ""}
  </article>`;
  return { key, html, search: [i.id, i.name, "infra", ...(i.ports || []).map(x => `${x.port} ${x.label}`)].join(" ").toLowerCase(), cat: "infra", issue: h !== "up", health: h };
}

/* ------------------------------------------------------------------- hero */
function totals(items) {
  const t = { up: 0, partial: 0, down: 0, monitor: 0 };
  items.forEach(it => { t[it.health] = (t[it.health] || 0) + 1; });
  t.total = items.length;
  return t;
}

function ringSvg(t) {
  const r = 52, c = 2 * Math.PI * r, gap = t.total > 1 ? 4 : 0;
  let offset = 0;
  const segs = ["up", "partial", "down", "monitor"].filter(k => t[k]).map(k => {
    const len = Math.max(0, (t[k] / t.total) * c - gap);
    const s = `<circle class="seg-${k}" cx="60" cy="60" r="${r}" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    offset += (t[k] / t.total) * c;
    return s;
  });
  return `<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="${r}"/>${segs.join("")}</svg>`;
}

function pulseCard(t) {
  const tone = t.down ? "down" : t.partial ? "partial" : "up";
  const issues = t.down + t.partial;
  const headline = t.down ? `${plural(t.down, "service")} down`
    : t.partial ? `${plural(t.partial, "service")} need${t.partial === 1 ? "s" : ""} attention`
    : "All systems operational";
  const stat = (k, label) => `<button class="stat ${k}" type="button" data-act="${k === "up" ? "show-all" : "show-issues"}"><i></i><b>${t[k]}</b>${label}</button>`;
  return {
    key: "pulse",
    html: `<div class="hero-card pulse tone-${tone}">
      <div class="ring">${ringSvg(t)}<div class="ring-center"><b>${t.up}<small>/${t.total}</small></b><span>healthy</span></div></div>
      <div class="pulse-copy">
        <p class="eyebrow">System status</p>
        <h2>${headline}</h2>
        <p class="sub">${plural(t.total, "service")} on this machine${issues ? "" : " — everything is responding"} · updated <span data-ago="last"></span></p>
        <div class="stat-row">${stat("up", "healthy")}${stat("partial", "degraded")}${stat("down", "down")}${t.monitor ? stat("monitor", "monitor") : ""}</div>
      </div>
    </div>`,
  };
}

function serverCard(d) {
  const running = d.server?.running;
  const job = running ? jobs.get(running.job) : activeJob("server");
  const k3s = d.server?.k3s;
  const games = (d.games || []).filter(g => g && g.name);
  const gameOn = games.length > 0;
  const gameText = state.gameBusy ? "Closing the game…" : gameOn ? `${games.map(g => g.name).join(", ")} is running` : "No Steam game running";
  const actions = job
    ? busyStrip(job)
    : running
      ? `<div class="busy-strip"><span class="spinner"></span><b>${ACT[running.action]?.verb || "Working"}…</b></div>`
      : `<div class="srv-actions">
          <button class="btn lg good" type="button" data-act="server" data-s="start_all">${ico("play")}Start all</button>
          <button class="btn lg danger" type="button" data-act="server" data-s="stop_all">${ico("power")}Stop all</button>
        </div>`;
  return {
    key: "server",
    html: `<div class="hero-card server">
      <div class="hc-head">${badge(glyph("server", "#7c8cff"), "md")}<div><h3>Whole server</h3><p>Every hosted app at once. Indra keeps running.</p></div></div>
      <div class="srv-meta">
        <span class="chip ${k3s ? "ok" : "idle"}">${mini(B.kubernetes)}<span class="nm">Kubernetes</span><span class="st">${k3s ? "running" : "stopped"}</span></span>
        <span class="chip ok">${mini(B.indra)}<span class="nm">Indra</span><span class="st">online</span></span>
      </div>
      ${actions}
      <div class="game ${gameOn ? "on" : ""}">
        ${badge(B.steam, "md", gameOn ? "up" : "")}
        <div class="game-copy"><b>Game mode</b><span>${esc(gameText)}</span></div>
        <button class="btn sm ${gameOn ? "danger" : ""}" type="button" data-act="game" ${!gameOn || state.gameBusy ? "disabled" : ""} title="Close the running game. Steam stays open.">
          ${state.gameBusy ? '<span class="spinner"></span>' : ico("gamepad")}End game</button>
      </div>
    </div>`,
  };
}

function activityCard() {
  const list = [...jobs.values()].filter(j => !j.quiet).sort((a, b) => b.started - a.started).slice(0, 5);
  const icon = { run: '<span class="spinner"></span>', ok: ico("check"), fail: ico("x"), warn: ico("alert") };
  const body = list.length
    ? `<div class="activity-list">${list.map(j => {
        const o = jobOutcome(j);
        return `<button class="act-item" type="button" data-act="open-job" data-job="${j.id}">
          ${badge(j.brand || B.indra, "sm")}
          <span class="ai-main"><b>${esc(j.name)}</b><small>${o === "run" ? `${ACT[j.action]?.verb || j.action}…` : ACT[j.action]?.label || j.action}</small></span>
          <time data-ago="${j.started}"></time>
          <span class="ai-st ${o}">${icon[o]}</span>
        </button>`;
      }).join("")}</div>`
    : `<div class="empty-activity">${ico("activity")}<span>Nothing run yet in this tab.<br/>Restarts, rebuilds and logs show up here.</span></div>`;
  return {
    key: "activity",
    html: `<div class="hero-card activity">
      <div class="hc-head">${badge(glyph("activity", "#22d3ee"), "md")}<div><h3>Activity</h3><p>Jobs started from this tab</p></div></div>
      ${body}
    </div>`,
  };
}

/* ------------------------------------------------------------------- draw */
function buildItems(d) {
  const items = [];
  (d.projects || []).forEach(p => items.push(projectCard(p)));
  const argo = d.argo || {};
  if (argo.ok && argo.apps?.length) argo.apps.forEach(a => items.push(argoCard(a)));
  else if (argo.stopped) items.push(noticeCard("k:stopped", B.kubernetes, "Kubernetes is stopped", "Argo CD, Link It Up and Saral are off. Press <b>Start all</b> to bring them back.", "down"));
  else if (argo.ok === false) items.push(noticeCard("k:error", B.argo, "Argo CD unreachable", esc((argo.error || "unreachable").split("\n").slice(-1)[0]), "down"));
  (d.infra || []).forEach(i => items.push(infraCard(i)));
  return items;
}

function draw() {
  const d = state.status;
  if (!d) return;
  const items = buildItems(d);
  state.items = items;
  const t = totals(items);

  reconcile($("#hero"), [pulseCard(t), serverCard(d), activityCard()]);

  // Sections in a fixed order; unknown categories go before Infrastructure.
  const cats = new Map();
  items.forEach(it => { if (!cats.has(it.cat)) cats.set(it.cat, []); cats.get(it.cat).push(it); });
  const defs = [...SECTIONS];
  [...cats.keys()].forEach(k => {
    if (!defs.find(s => s.key === k)) defs.splice(defs.length - 1, 0, { key: k, title: k.replace(/-/g, " "), icon: "box" });
  });
  const sectionItems = defs.filter(s => cats.has(s.key)).map(s => {
    const list = cats.get(s.key);
    const extra = s.key === "kubernetes" ? `<a class="btn sm" href="/argocd/" target="_blank" rel="noopener">${mini(B.argo)}<span>Manage in Argo CD</span>${ico("external")}</a>` : "";
    return {
      key: "s:" + s.key,
      html: `<section class="section" data-sec="${esc(s.key)}">
        <div class="sec-head"><span class="sec-ico">${s.brand ? mini(s.brand) : ico(s.icon)}</span><h2>${esc(s.title)}</h2><span class="n">${list.length}</span><span class="line"></span>${extra}</div>
        <div class="grid"></div>
      </section>`,
      list,
    };
  });
  const sections = $("#sections");
  reconcile(sections, sectionItems.map(({ key, html }) => ({ key, html })));
  sectionItems.forEach(s => reconcile($(`[data-key="${CSS.escape(s.key)}"] .grid`, sections), s.list, { enter: !state.drawn }));

  drawTabs(defs.filter(s => cats.has(s.key)), cats, t);
  applyFilter();
  drawJobsUi(false);
  tick();
  if (!state.drawn) setTimeout(() => $("#hero").classList.remove("first"), 900);
  state.drawn = true;
}

function drawTabs(defs, cats, t) {
  const f = state.filter;
  const issuesIn = list => {
    const down = list.some(i => i.health === "down"), part = list.some(i => i.health === "partial");
    return down ? '<span class="warn-dot"></span>' : part ? '<span class="warn-dot partial"></span>' : "";
  };
  const all = [...cats.values()].flat();
  const tabs = [
    { key: "tab:all", html: `<button class="tab ${f.cat === "all" ? "active" : ""}" type="button" data-act="tab" data-cat="all">${ico("grid")}All<span class="n">${all.length}</span></button>` },
    ...defs.map(s => {
      const list = cats.get(s.key);
      return { key: "tab:" + s.key, html: `<button class="tab ${f.cat === s.key ? "active" : ""}" type="button" data-act="tab" data-cat="${esc(s.key)}">${s.brand ? mini(s.brand) : ico(s.icon)}${esc(s.title)}<span class="n">${list.length}</span>${issuesIn(list)}</button>` };
    }),
    { key: "tab:sep", html: '<span class="sep"></span>' },
    { key: "tab:issues", html: `<button class="tog" type="button" data-act="issues" aria-pressed="${f.issues}">${ico("alert")}Issues only<span class="n">${t.down + t.partial}</span></button>` },
  ];
  reconcile($("#tabs"), tabs);
}

function applyFilter() {
  const f = state.filter;
  const q = f.q.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  let shown = 0;
  $$("#sections .section").forEach(sec => {
    const inCat = f.cat === "all" || sec.dataset.sec === f.cat;
    let visible = 0;
    $$(".grid > .card", sec).forEach(card => {
      const ok = inCat && (!f.issues || card.dataset.issue === "1") && terms.every(w => (card.dataset.search || "").includes(w));
      card.hidden = !ok;
      if (ok) visible++;
    });
    sec.hidden = visible === 0;
    shown += visible;
  });
  const nr = $("#noResults");
  if (state.status && shown === 0) {
    nr.hidden = false;
    const why = q ? `Nothing matches “${esc(f.q.trim())}”` : f.issues ? "No issues — everything is healthy" : "Nothing to show";
    nr.innerHTML = `${ico(f.issues && !q ? "checkCircle" : "search")}<div>${why}</div><button class="btn sm" type="button" data-act="clear-filter">Clear filters</button>`;
  } else nr.hidden = true;
}

function drawJobsUi(withHero = true) {
  const running = [...jobs.values()].filter(j => !j.done && !j.quiet).sort((a, b) => a.started - b.started);
  reconcile($("#dock"), running.map(j => ({
    key: j.id,
    html: `<button class="dock-item" type="button" data-act="open-job" data-job="${j.id}" style="--b:${j.brand?.color || "#7c8cff"}">
      ${badge(j.brand || B.indra, "sm")}
      <span class="copy"><b>${esc(j.name)}</b><small>${ACT[j.action]?.verb || j.action}… <span data-since="${j.started}"></span></small></span>
      <span class="spinner"></span></button>`,
  })));
  if (withHero && state.status) {
    // Cards show a busy strip while their job runs, so redraw everything (cheap: keyed).
    draw();
  }
}

/* ----------------------------------------------------------------- toasts */
function toast({ tone = "info", title, msg = "", job = null, timeout = 7000 }) {
  const icon = { ok: "checkCircle", fail: "xCircle", warn: "alert", info: "info" }[tone] || "info";
  const el = htmlEl(`<div class="toast ${tone}" role="status">
    <span class="t-ico">${ico(icon)}</span>
    <div class="t-body"><b>${esc(title)}</b>${msg ? `<p>${esc(msg)}</p>` : ""}
      ${job ? `<div class="t-acts"><button class="btn sm" type="button" data-act="open-job" data-job="${job}">${ico("terminal")}View log</button></div>` : ""}</div>
    <button class="btn sm icon ghost t-x" type="button" aria-label="Dismiss">${ico("x")}</button>
  </div>`);
  const box = $("#toasts");
  box.prepend(el);
  while (box.children.length > 4) box.lastElementChild.remove();
  const kill = () => { if (!el.isConnected) return; el.classList.add("out"); setTimeout(() => el.remove(), 250); };
  el.querySelector(".t-x").addEventListener("click", kill);
  el.addEventListener("click", e => { if (e.target.closest("[data-act]")) kill(); });
  let timer = setTimeout(kill, timeout);
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => { timer = setTimeout(kill, 2500); });
}

/* ---------------------------------------------------------------- dialogs */
let dlgResolve = null;
function confirmDlg({ tone = "primary", icon = "alert", title, body = "", note = "", ok = "Confirm", password = false }) {
  const dlg = $("#dlg");
  dlg.className = `dialog ${tone}`;
  $("#dlgIcon").innerHTML = ico(icon);
  $("#dlgTitle").textContent = title;
  $("#dlgBody").innerHTML = body;
  $("#dlgNote").textContent = note;
  $("#dlgPwWrap").hidden = !password;
  $("#dlgPw").value = "";
  const okBtn = $("#dlgOk");
  okBtn.className = `btn lg ${tone === "danger" ? "danger solid" : tone === "good" ? "good solid" : "primary"}`;
  okBtn.textContent = ok;
  showScrim("#dlgScrim");
  setTimeout(() => (password ? $("#dlgPw") : okBtn).focus(), 30);
  return new Promise(res => { dlgResolve = res; });
}
function dlgDone(ok) {
  if (!dlgResolve) return;
  const res = dlgResolve;
  dlgResolve = null;
  const password = $("#dlgPw").value;
  $("#dlgPw").value = "";
  hideScrim("#dlgScrim");
  res({ ok, password });
}
function showScrim(sel) {
  const s = $(sel);
  s.classList.remove("closing");
  s.hidden = false;
  document.body.style.overflow = "hidden";
}
function hideScrim(sel) {
  const s = $(sel);
  if (s.hidden) return;
  s.classList.add("closing");
  setTimeout(() => {
    s.hidden = true;
    s.classList.remove("closing");
    if ($("#conScrim").hidden && $("#dlgScrim").hidden) document.body.style.overflow = "";
  }, 170);
}

/* ---------------------------------------------------------------- actions */
const findProject = id => (state.status?.projects || []).find(p => p.id === id);

async function onProjectAction(id, action) {
  const p = findProject(id);
  if (!p) return;
  const b = brandFor([p.id, p.name], CAT_FALLBACK[p.category]);
  const extra = {};
  if (action === "stop") {
    const names = [...Object.keys(p.pm2 || {}).map(n => `${mini(B.pm2)} ${esc(n)}`), ...Object.keys(p.docker || {}).map(n => `${mini(brandFor([n]))} ${esc(n)}`)];
    const { ok } = await confirmDlg({
      tone: "danger", icon: "stop", title: `Stop ${p.name}?`, ok: "Stop",
      body: `<p>These will be stopped:</p>${names.length ? `<ul>${names.map(n => `<li>${n}</li>`).join("")}</ul>` : ""}
        ${p.domains?.length ? `<p class="muted">${p.domains.map(d => esc(host(d.url))).join(", ")} will go offline until you press Start.</p>` : ""}`,
      note: "Nothing is deleted.",
    });
    if (!ok) return;
  }
  if (action === "deploy") {
    const { ok, password } = await confirmDlg({
      tone: "primary", icon: "rocket", title: `Deploy ${p.name}?`, ok: "Run deploy", password: true,
      body: `<p>Runs the project's <code>deploy.sh</code> (nginx / SSL — needs sudo).</p>
        <p class="muted">It tries passwordless sudo first. A password is only used when Indra runs with
        <code>ALLOW_SUDO_PASSWORD=1</code>; it is sent once and never stored.</p>`,
    });
    if (!ok) return;
    if (password) extra.sudo_password = password;
  }
  if (action === "logs") extra.lines = Number($("#conCount").value) || 120;
  if (action === "rebuild" || action === "restart") delete suggestedAfterPull[id];
  try {
    const { job } = await post("/api/action", { project: id, action, ...extra });
    const j = trackJob(job, { key: "p:" + id, project: id, name: p.name, action, brand: b, quiet: action === "logs" });
    openConsole(j.id);
  } catch (e) {
    toast({ tone: "fail", title: `${p.name} · ${ACT[action]?.label || action}`, msg: e.message });
  }
}

async function onInfraAction(id, action) {
  const i = (state.status?.infra || []).find(x => x.id === id);
  if (!i) return;
  if (action === "stop") {
    const { ok } = await confirmDlg({
      tone: "danger", icon: "stop", title: `Stop ${i.name}?`, ok: "Stop",
      body: `<p>Stops the <code>${esc(id)}</code> systemd service on this machine.</p>`,
      note: "Start brings it back.",
    });
    if (!ok) return;
  }
  try {
    const { job } = await post("/api/infra", { id, action });
    const j = trackJob(job, { key: "i:" + id, name: i.name, action, brand: brandFor([i.id, i.name], B.systemd) });
    openConsole(j.id);
  } catch (e) {
    toast({ tone: "fail", title: `${i.name} · ${ACT[action]?.label || action}`, msg: e.message });
  }
}

async function onServerAction(action) {
  const running = state.status?.server?.running;
  if (running?.job && jobs.has(running.job)) return openConsole(running.job);
  const meta = SERVER_TEXT[action];
  const { ok } = await confirmDlg(meta);
  if (!ok) return;
  try {
    const { job } = await post("/api/server", { action });
    const j = trackJob(job, { key: "server", name: "Whole server", action, brand: glyph("server", "#7c8cff") });
    openConsole(j.id);
  } catch (e) {
    toast({ tone: "fail", title: meta.ok, msg: e.message });
  }
}

async function onGame() {
  const games = (state.status?.games || []).filter(g => g && g.name);
  if (!games.length || state.gameBusy) return;
  const names = games.map(g => g.name);
  const { ok } = await confirmDlg({
    tone: "danger", icon: "gamepad", ok: "End game",
    title: names.length === 1 ? `End ${names[0]}?` : "End the running games?",
    body: `${names.length > 1 ? `<ul>${names.map(n => `<li>${mini(B.steam)} ${esc(n)}</li>`).join("")}</ul>` : ""}
      <p>The game is closed gently so it can save.</p><p class="muted">Steam stays open. This never starts a game.</p>`,
    note: "Steam stays open.",
  });
  if (!ok) return;
  state.gameBusy = true;
  draw();
  try {
    const res = await post("/api/games/stop");
    const closed = res.closed || [];
    toast({ tone: closed.length ? "ok" : "info", title: closed.length ? `Closed ${closed.join(", ")}` : "No game was running", msg: (res.log || "").trim().split("\n").slice(-1)[0] });
  } catch (e) {
    toast({ tone: "fail", title: "Couldn't close the game", msg: e.message });
  }
  state.gameBusy = false;
  refresh();
}

/** A Stop all / Start all started from another tab or before a reload: follow it here too. */
function attachServerJob(server) {
  const r = server?.running;
  if (r?.job && !jobs.has(r.job))
    trackJob(r.job, { key: "server", name: "Whole server", action: r.action, brand: glyph("server", "#7c8cff"), attached: true });
}

/* ---------------------------------------------------------------- console */
const con = { jobId: null, renderedId: null, rendered: 0, lineNo: 0, partial: "", follow: true, wrap: true, query: "", tail: false, tailTimer: null, max: false, hits: 0 };

function openConsole(jobId) {
  const j = jobs.get(jobId);
  if (!j) return;
  const sameLogs = con.jobId && jobs.get(con.jobId)?.quiet && j.quiet && jobs.get(con.jobId)?.project === j.project && !$("#conScrim").hidden;
  con.jobId = jobId;
  if (!sameLogs) {
    con.follow = true;
    con.renderedId = null;
    $("#conQ").value = con.query = "";
    setTail(false);
  }
  $("#conBadge").innerHTML = badge(j.brand || B.indra, "md");
  $("#conTitle").textContent = `${j.name} · ${ACT[j.action]?.label || j.action}`;
  $("#conLogTools").hidden = !(j.quiet && j.project);
  $("#conReload").innerHTML = `${ico("refresh")}<span>Reload</span>`;
  syncConsoleToggles();
  showScrim("#conScrim");
  consoleUpdate();
}

function closeConsole() {
  const j = jobs.get(con.jobId);
  setTail(false);
  hideScrim("#conScrim");
  if (j && !j.done && !j.quiet) toast({ tone: "info", title: `${j.name} is still running`, msg: "It keeps going in the background — the dock at the bottom brings the log back.", timeout: 4500 });
  con.jobId = null;
  con.renderedId = null;
}

function syncConsoleToggles() {
  const w = $("#conWrap"), f = $("#conFollow");
  w.setAttribute("aria-pressed", con.wrap);
  w.innerHTML = `${ico("wrap")}<span>Wrap</span>`;
  f.setAttribute("aria-pressed", con.follow);
  f.innerHTML = `${ico("follow")}<span>Follow</span>`;
  $("#conOut").classList.toggle("nowrap", !con.wrap);
  $("#conMax").innerHTML = ico(con.max ? "minimize" : "maximize");
  $("#conClose").innerHTML = ico("x");
  $("#console").classList.toggle("max", con.max);
  $("#conCopy").innerHTML = ico("copy");
  $("#conDl").innerHTML = ico("download");
}

const ANSI_SGR = /\x1b\[([0-9;]*)m/g;
const ANSI_OTHER = /\x1b\[[0-9;?]*[A-Za-ln-z]|\x1b[()][A-Z0-9]|\r(?!\n)/g;
const PFX_COLORS = ["#7c8cff", "#22d3ee", "#c084fc", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#fb923c"];
const pfxColor = s => PFX_COLORS[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PFX_COLORS.length];

function classify(text) {
  if (/^\$ /.test(text)) return "cmd";
  if (/^\[(Indra|sudo|continuing|timed out)/i.test(text)) return /continuing|timed out/i.test(text) ? "warn" : "sys";
  if (/\b(error|errors|failed|failure|fatal|exception|traceback|panic|denied|refused|unreachable|CONFLICT)\b|^E:\s|✗|ERR!/i.test(text)) return "err";
  if (/\b(warn|warning|deprecated)\b|⚠/i.test(text)) return "warn";
  if (/^\s*(✓|✔)|\b(successfully|already up to date|fast-forward|compiled|built in|is up|online|healthy)\b/i.test(text)) return "ok";
  return "";
}

/** One output line → HTML: ANSI colours, PM2/compose prefixes, timestamps, links, search marks. */
function lineHtml(raw, query) {
  const text = raw.replace(ANSI_OTHER, "");
  let html = "", fg = "", bold = false, last = 0, m;
  const plainParts = [];
  const emit = chunk => { if (chunk) plainParts.push({ chunk, cls: [fg, bold ? "a-bold" : ""].filter(Boolean).join(" ") }); };
  ANSI_SGR.lastIndex = 0;
  while ((m = ANSI_SGR.exec(text))) {
    emit(text.slice(last, m.index));
    last = ANSI_SGR.lastIndex;
    (m[1] || "0").split(";").forEach(code => {
      const n = Number(code);
      if (n === 0) { fg = ""; bold = false; }
      else if (n === 1) bold = true;
      else if (n === 22) bold = false;
      else if (n === 39) fg = "";
      else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) fg = "a-" + n;
    });
  }
  emit(text.slice(last));
  const plain = plainParts.map(p => p.chunk).join("");

  // Leading "0|apeksha-frontend | " (PM2) or "immich-server  | " (compose) prefix, then a timestamp.
  let pfxLen = 0, tsLen = 0, pfx = "";
  const pm = plain.match(/^(\d+\|[\w.@-]+\s*\|\s?)/) || plain.match(/^([\w.@-]+(?:-\d+)?\s+\|\s)/) || plain.match(/^(\/[\w./@-]+\.log\s+last \d+ lines:)/);
  if (pm) { pfxLen = pm[1].length; pfx = pm[1]; }
  const tm = plain.slice(pfxLen).match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?:?\s?)/);
  if (tm) tsLen = tm[1].length;

  const ql = (query || "").toLowerCase();
  const hits = [];
  if (ql) { let i = plain.toLowerCase().indexOf(ql); while (i !== -1) { hits.push([i, i + ql.length]); i = plain.toLowerCase().indexOf(ql, i + ql.length); } }

  // Walk characters once, opening spans for colour / prefix / timestamp / mark.
  let pos = 0;
  plainParts.forEach(({ chunk, cls }) => {
    for (const seg of splitAt(chunk, pos, [pfxLen, pfxLen + tsLen, ...hits.flat()])) {
      const start = pos, end = pos + seg.length;
      let s = esc(seg);
      if (hits.some(([a, b]) => start >= a && end <= b)) s = `<mark>${s}</mark>`;
      const role = start < pfxLen ? "pfx" : start < pfxLen + tsLen ? "ts" : "";
      const classes = [cls, role].filter(Boolean).join(" ");
      html += classes ? `<span class="${classes}"${role === "pfx" ? ` style="--pc:${pfxColor(pfx)}"` : ""}>${s}</span>` : s;
      pos = end;
    }
  });
  html = html.replace(/(https?:\/\/[^\s<"']+[^\s<"'.,;:)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return { html: html || " ", plain, hit: !ql || hits.length > 0 };
}
function splitAt(chunk, offset, cuts) {
  const local = [...new Set(cuts.map(c => c - offset).filter(c => c > 0 && c < chunk.length))].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  local.forEach(c => { out.push(chunk.slice(prev, c)); prev = c; });
  out.push(chunk.slice(prev));
  return out.filter(s => s.length);
}

function makeLine(raw) {
  const el = document.createElement("div");
  const { html, plain, hit } = lineHtml(raw, con.query);
  el.className = `ln ${classify(plain)} ${hit ? "hit" : ""}`;
  el._raw = raw;
  el.innerHTML = `<span class="no">${++con.lineNo}</span><span class="tx">${html}</span>`;
  if (hit && con.query) con.hits++;
  return el;
}

function consoleUpdate() {
  const j = jobs.get(con.jobId);
  if (!j) return;
  const out = $("#conOut");
  // A reloaded log keeps showing the old text until the new read has something.
  if (con.renderedId !== j.id && (j.output || j.done)) {
    out.innerHTML = "";
    con.renderedId = j.id;
    con.rendered = 0;
    con.lineNo = 0;
    con.partial = "";
    con.hits = 0;
  }
  if (con.renderedId === j.id) {
    const nearBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 60;
    const chunk = j.output.slice(con.rendered);
    con.rendered = j.output.length;
    if (chunk || j.done) {
      const old = out.querySelector(".ln.partial");
      if (old) { if (con.query && old.classList.contains("hit")) con.hits--; old.remove(); con.lineNo--; }
      const parts = (con.partial + chunk).split("\n");
      con.partial = parts.pop();
      const frag = document.createDocumentFragment();
      parts.forEach(l => frag.appendChild(makeLine(l)));
      if (con.partial) { const el = makeLine(con.partial); el.classList.add("partial"); frag.appendChild(el); }
      out.appendChild(frag);
      if (j.done && con.partial) { out.querySelector(".ln.partial")?.classList.remove("partial"); con.partial = ""; }
    }
    if (con.follow || nearBottom) out.scrollTop = out.scrollHeight;
    $("#conJump").hidden = con.follow || nearBottom;
  }
  $("#conEmpty").hidden = j.done || !!out.querySelector(".ln");
  if (j.done && !j.output) out.innerHTML = '<div class="ln sys"><span class="no">1</span><span class="tx">(no output)</span></div>';
  $("#conHits").textContent = con.query ? `${con.hits} match${con.hits === 1 ? "" : "es"}` : "";
  out.classList.toggle("filtering", !!con.query);

  const o = jobOutcome(j);
  const pill = $("#conStatus");
  pill.className = `status-pill ${o}`;
  pill.innerHTML = o === "run" ? `<span class="spinner"></span>Running <span data-since="${j.started}"></span>`
    : o === "ok" ? `${ico("checkCircle")}Done` : o === "warn" ? `${ico("alert")}Merge conflicts`
    : `${ico("xCircle")}${j.lost ? "Lost" : `Exit ${j.rc}`}`;
  const started = new Date(j.started).toLocaleTimeString();
  $("#conSub").textContent = j.done ? `Started ${started} · took ${fmtDur(j.finished - j.started)}` : `Started ${started}`;
  const steps = (j.output.match(/^\$ /gm) || []).length;
  $("#conMeta").innerHTML = [
    `<span>${ico("list")}${plural(con.lineNo, "line")}</span>`,
    steps ? `<span>${ico("steps")}${plural(steps, "command")}</span>` : "",
    j.conflicts ? `<span class="conflict">${ico("alert")}Resolve the conflicts in a terminal, then Pull again.</span>` : "",
  ].join("");
  $("#conHide").textContent = j.done || j.quiet ? "Close" : "Hide — keeps running";
  tick();
}

function rerenderConsole() {
  // Re-render all lines (search changed): reuse the stored raw text.
  const out = $("#conOut");
  con.hits = 0;
  $$(".ln", out).forEach(el => {
    if (el._raw == null) return;
    const { html, plain, hit } = lineHtml(el._raw, con.query);
    el.querySelector(".tx").innerHTML = html;
    el.classList.toggle("hit", hit);
    el.className = `ln ${classify(plain)} ${hit ? "hit" : ""}${el.classList.contains("partial") ? " partial" : ""}`;
    if (hit && con.query) con.hits++;
  });
  out.classList.toggle("filtering", !!con.query);
  $("#conHits").textContent = con.query ? `${con.hits} match${con.hits === 1 ? "" : "es"}` : "";
}

function setTail(on) {
  con.tail = on;
  $("#conTail").setAttribute("aria-pressed", on);
  clearInterval(con.tailTimer);
  if (on) con.tailTimer = setInterval(() => {
    const j = jobs.get(con.jobId);
    if (j && j.done && !document.hidden) reloadLogs();
  }, 5000);
}

async function reloadLogs() {
  const j = jobs.get(con.jobId);
  if (!j?.project) return;
  const btn = $("#conReload");
  btn.classList.add("spinning");
  try {
    const { job } = await post("/api/action", { project: j.project, action: "logs", lines: Number($("#conCount").value) || 120 });
    const nj = trackJob(job, { key: j.key, project: j.project, name: j.name, action: "logs", brand: j.brand, quiet: true });
    con.jobId = nj.id;
    consoleUpdate();
  } catch (e) {
    toast({ tone: "fail", title: "Couldn't reload logs", msg: e.message });
    setTail(false);
  } finally {
    setTimeout(() => btn.classList.remove("spinning"), 400);
  }
}

async function copyOutput() {
  const j = jobs.get(con.jobId);
  if (!j) return;
  const text = j.output.replace(ANSI_SGR, "").replace(ANSI_OTHER, "");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  const btn = $("#conCopy");
  btn.innerHTML = ico("check");
  setTimeout(() => { btn.innerHTML = ico("copy"); }, 1200);
}

function downloadOutput() {
  const j = jobs.get(con.jobId);
  if (!j) return;
  const text = j.output.replace(ANSI_SGR, "").replace(ANSI_OTHER, "");
  const stamp = new Date(j.started).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([text], { type: "text/plain" })),
    download: `${j.name.replace(/\W+/g, "-").toLowerCase()}-${j.action}-${stamp}.log`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------------------------------------------------------- refresh */
async function refresh() {
  if (state.loading) { state.again = true; return; }
  state.loading = true;
  $("#refreshBtn").classList.add("spinning");
  try {
    const d = await api("/api/status");
    state.status = d;
    state.error = null;
    state.lastOk = Date.now();
    attachServerJob(d.server);
    draw();
    $("#banner").hidden = true;
  } catch (e) {
    state.error = e.message;
    if (state.status) {
      const b = $("#banner");
      b.hidden = false;
      b.innerHTML = `${ico("alert")}<span>Can't reach Indra (${esc(e.message)}). Showing data from <span data-ago="last"></span> — retrying.</span>`;
      tick();
    } else {
      $("#hero").innerHTML = "";
      $("#tabs").innerHTML = "";
      $("#sections").innerHTML = `<div class="fatal"><div class="dlg-icon">${ico("alert")}</div><h2>Can't load the dashboard</h2><p>${esc(e.message)}</p><button class="btn primary" type="button" data-act="retry">${ico("refresh")}Try again</button></div>`;
    }
  } finally {
    state.loading = false;
    setTimeout(() => $("#refreshBtn").classList.remove("spinning"), 300);
    if (state.again) { state.again = false; refresh(); }
  }
}

function tick() {
  const now = Date.now();
  $$("[data-since]").forEach(el => { el.textContent = fmtDur(now - Number(el.dataset.since)); });
  $$("[data-ago]").forEach(el => { const t = el.dataset.ago === "last" ? state.lastOk : Number(el.dataset.ago); el.textContent = t ? fmtAgo(t) : "—"; });
  $("#liveText").textContent = !state.live ? "Paused" : state.lastOk ? `Live · ${fmtAgo(state.lastOk)}` : "Live";
}

/* ----------------------------------------------------------------- events */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if (!t || t.disabled) return;
  const act = t.dataset.act;
  if (act === "proj") onProjectAction(t.dataset.t, t.dataset.a);
  else if (act === "infra") onInfraAction(t.dataset.t, t.dataset.a);
  else if (act === "server") onServerAction(t.dataset.s);
  else if (act === "game") onGame();
  else if (act === "open-job") openConsole(t.dataset.job);
  else if (act === "tab") { state.filter.cat = t.dataset.cat; draw(); }
  else if (act === "issues") { state.filter.issues = !state.filter.issues; draw(); }
  else if (act === "show-issues") { state.filter.issues = true; state.filter.cat = "all"; draw(); $("#tabs").scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (act === "show-all") { state.filter.issues = false; state.filter.cat = "all"; draw(); }
  else if (act === "clear-filter") { state.filter = { q: "", cat: "all", issues: false }; $("#q").value = ""; draw(); }
  else if (act === "retry") refresh();
});

$("#q").addEventListener("input", e => { state.filter.q = e.target.value; applyFilter(); });
$("#refreshBtn").addEventListener("click", refresh);
$("#liveBtn").addEventListener("click", () => {
  state.live = !state.live;
  $("#liveBtn").classList.toggle("on", state.live);
  if (state.live) refresh();
  tick();
});

$("#dlgOk").addEventListener("click", () => dlgDone(true));
$("#dlgCancel").addEventListener("click", () => dlgDone(false));
$("#dlgScrim").addEventListener("click", e => { if (e.target.id === "dlgScrim") dlgDone(false); });
$("#dlgPw").addEventListener("keydown", e => { if (e.key === "Enter") dlgDone(true); });

$("#conClose").addEventListener("click", closeConsole);
$("#conHide").addEventListener("click", closeConsole);
$("#conScrim").addEventListener("click", e => { if (e.target.id === "conScrim") closeConsole(); });
$("#conMax").addEventListener("click", () => { con.max = !con.max; syncConsoleToggles(); });
$("#conWrap").addEventListener("click", () => { con.wrap = !con.wrap; syncConsoleToggles(); });
$("#conFollow").addEventListener("click", () => {
  con.follow = !con.follow;
  syncConsoleToggles();
  if (con.follow) { const o = $("#conOut"); o.scrollTop = o.scrollHeight; $("#conJump").hidden = true; }
});
$("#conJump").innerHTML = `${ico("arrowDown")}Jump to latest`;
$("#conJump").addEventListener("click", () => {
  const o = $("#conOut");
  o.scrollTo({ top: o.scrollHeight, behavior: "smooth" });
  con.follow = true;
  syncConsoleToggles();
  $("#conJump").hidden = true;
});
$("#conOut").addEventListener("scroll", () => {
  const o = $("#conOut");
  const atBottom = o.scrollHeight - o.scrollTop - o.clientHeight < 60;
  if (!atBottom && con.follow) { con.follow = false; syncConsoleToggles(); }
  const j = jobs.get(con.jobId);
  $("#conJump").hidden = atBottom || (j && j.done && !con.tail);
}, { passive: true });
let qTimer = null;
$("#conQ").addEventListener("input", e => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { con.query = e.target.value; rerenderConsole(); }, 120);
});
$("#conCopy").addEventListener("click", copyOutput);
$("#conDl").addEventListener("click", downloadOutput);
$("#conReload").addEventListener("click", reloadLogs);
$("#conCount").addEventListener("change", reloadLogs);
$("#conTail").addEventListener("click", () => { setTail(!con.tail); if (con.tail) reloadLogs(); });

document.addEventListener("keydown", e => {
  const typing = e.target.matches("input, textarea, select");
  if (e.key === "Escape") {
    if (!$("#dlgScrim").hidden) return dlgDone(false);
    if (!$("#conScrim").hidden) {
      if (e.target.id === "conQ" && e.target.value) { e.target.value = ""; con.query = ""; rerenderConsole(); return; }
      return closeConsole();
    }
    if (e.target.id === "q") { e.target.value = ""; state.filter.q = ""; applyFilter(); e.target.blur(); }
    return;
  }
  if (!$("#conScrim").hidden && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); $("#conQ").focus(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || !$("#conScrim").hidden || !$("#dlgScrim").hidden) return;
  if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  else if (e.key.toLowerCase() === "r") refresh();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden && state.live) refresh(); });
setInterval(() => { if (state.live && !document.hidden) refresh(); }, 10000);
setInterval(tick, 1000);
syncConsoleToggles();
refresh();

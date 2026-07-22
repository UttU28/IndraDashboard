"""Server Dashboard — one pane to view/control all Desktop projects.

Status (PM2 + Docker + ports + domains) and actions (restart/rebuild/stop/
start/logs/deploy) for every project defined in projects.yaml.

Runs as your user on 127.0.0.1:9282 (put nginx in front for a domain).
PM2 and Docker actions need no sudo. Full deploy.sh needs sudo; see README.
"""
from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import requests
import yaml
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
CONFIG_PATH = BASE_DIR / "projects.yaml"

# Optional HTTP Basic auth — set both to enable (recommended behind a domain).
DASH_USER = os.getenv("DASH_USER", "")
DASH_PASS = os.getenv("DASH_PASS", "")
# Allow running full deploy.sh (sudo) by passing a sudo password from the UI.
# Off by default for safety. When off, deploy uses `sudo -n` (NOPASSWD) or fails
# with the exact command to run in a terminal.
ALLOW_SUDO_PASSWORD = os.getenv("ALLOW_SUDO_PASSWORD", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)

DOMAIN_TIMEOUT = float(os.getenv("DASH_DOMAIN_TIMEOUT", "4"))
PORT_TIMEOUT = float(os.getenv("DASH_PORT_TIMEOUT", "0.4"))

app = FastAPI(title="Server Dashboard", docs_url=None, redoc_url=None)
security = HTTPBasic(auto_error=False)


def _auth(creds: HTTPBasicCredentials | None = Depends(security)) -> None:
    if not (DASH_USER and DASH_PASS):
        return  # auth disabled
    ok = (
        creds is not None
        and secrets.compare_digest(creds.username, DASH_USER)
        and secrets.compare_digest(creds.password, DASH_PASS)
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )


def expand(path: str) -> str:
    return os.path.expanduser(os.path.expandvars(path))


def load_config() -> dict[str, Any]:
    with open(CONFIG_PATH) as fh:
        return yaml.safe_load(fh) or {}


# --------------------------------------------------------------------------- #
# Status collection
# --------------------------------------------------------------------------- #
def pm2_map() -> dict[str, str]:
    """name -> status (online/stopped/errored/...); empty on failure."""
    try:
        out = subprocess.run(
            ["bash", "-lc", "pm2 jlist"],
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout
        data = json.loads(out)
        return {p["name"]: p.get("pm2_env", {}).get("status", "?") for p in data}
    except Exception:
        return {}


def docker_map() -> dict[str, str]:
    """container name -> state (running/exited/...); empty on failure."""
    try:
        out = subprocess.run(
            ["bash", "-lc", "docker ps -a --format '{{json .}}'"],
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout
        result: dict[str, str] = {}
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            c = json.loads(line)
            result[c.get("Names", "")] = c.get("State", c.get("Status", "?"))
        return result
    except Exception:
        return {}


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=PORT_TIMEOUT):
            return True
    except OSError:
        return False


def domain_status(url: str) -> int | None:
    try:
        r = requests.get(url, timeout=DOMAIN_TIMEOUT, allow_redirects=True)
        return r.status_code
    except requests.RequestException:
        return None


def systemd_active(unit: str) -> bool:
    try:
        return (
            subprocess.run(
                ["systemctl", "is-active", "--quiet", unit], timeout=5
            ).returncode
            == 0
        )
    except Exception:
        return False


def collect_status() -> dict[str, Any]:
    cfg = load_config()
    pm2 = pm2_map()
    dock = docker_map()

    projects = []
    for p in cfg.get("projects", []):
        pm2_states = {name: pm2.get(name, "missing") for name in p.get("pm2", [])}
        docker_states = {}
        d = p.get("docker")
        if d:
            # Prefer explicit container names; fall back to legacy `services` key.
            for name in d.get("containers") or d.get("services") or []:
                docker_states[name] = dock.get(name, "missing")
        ports = [
            {**pp, "open": port_open(pp["port"])} for pp in p.get("ports", [])
        ]
        domains = [
            {"url": u, "code": domain_status(u)} for u in p.get("domains", [])
        ]

        pm2_vals = list(pm2_states.values())
        docker_vals = list(docker_states.values())
        controllable = bool(pm2_vals or d)
        if not controllable and not p.get("domains"):
            health = "monitor"
        elif not controllable:
            # LAN / domain-only entries
            codes = [x["code"] for x in domains]
            health = (
                "up"
                if codes and all(c is not None and c < 400 for c in codes)
                else "monitor"
            )
        elif (not pm2_vals or all(v == "online" for v in pm2_vals)) and (
            not docker_vals or all(v == "running" for v in docker_vals)
        ):
            # If containers aren't listed, use open ports as a soft signal.
            if not docker_vals and d:
                health = (
                    "up"
                    if ports and any(pp["open"] for pp in ports)
                    else "partial"
                )
            else:
                health = "up"
        elif any(v == "online" for v in pm2_vals) or any(
            v == "running" for v in docker_vals
        ) or any(pp["open"] for pp in ports):
            health = "partial"
        else:
            health = "down"

        dep = p.get("deploy") or {}
        projects.append(
            {
                "id": p["id"],
                "name": p["name"],
                "category": p.get("category", "web-app"),
                "pm2": pm2_states,
                "docker": docker_states,
                "has_docker": bool(d),
                "ports": ports,
                "domains": domains,
                # Deploy only when explicitly marked safe (avoids interactive /
                # multi-project / wrong-cwd scripts).
                "deploy": bool(dep) and bool(dep.get("safe")),
                "notes": p.get("notes", ""),
                "health": health,
            }
        )

    infra = []
    for i in cfg.get("infra", []):
        entry: dict[str, Any] = {"id": i["id"], "name": i["name"]}
        if i.get("systemd"):
            entry["active"] = systemd_active(i["systemd"])
        if i.get("ports"):
            entry["ports"] = [
                {**pp, "open": port_open(pp["port"])} for pp in i["ports"]
            ]
        infra.append(entry)

    return {"projects": projects, "infra": infra, "ts": int(time.time())}


# --------------------------------------------------------------------------- #
# Action jobs (background threads with polled output)
# --------------------------------------------------------------------------- #
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


def _find_project(pid: str) -> dict[str, Any] | None:
    for p in load_config().get("projects", []):
        if p["id"] == pid:
            return p
    return None


def _compose_service_args(d: dict[str, Any] | None) -> str:
    """Return space-joined compose service names, or empty string.

    When set, start/rebuild/stop/restart/logs only touch these services — never
    sibling containers like Saral's nginx/certbot (host :80/:443 clash).
    """
    if not d:
        return ""
    names = d.get("compose_services") or []
    return " ".join(str(n) for n in names if n)


def _pm2_cmd(action: str, names: list[str], bootstrap: str | None = None) -> str:
    """Build a PM2 command that targets process names, not script paths.

    `pm2 start foo` treats `foo` as a script when no saved process exists —
    use restart-by-name for the Start button, and optional bootstrap script
    when the process was never registered (or was deleted from PM2).
    """
    if not names:
        return ""
    names_s = " ".join(names)
    pm2_action = "restart" if action == "start" else action
    if bootstrap and action == "start":
        boot = expand(bootstrap)
        checks = " ".join(
            f"pm2 describe {n!r} >/dev/null 2>&1 || missing=1;" for n in names
        )
        return (
            f"missing=0; {checks} "
            f'if [ "$missing" = "1" ]; then bash {boot!r}; '
            f"else pm2 {pm2_action} {names_s}; fi"
        )
    return f"pm2 {pm2_action} {names_s}"


def _docker_compose_cmd(ddir: str, base: str, d: dict[str, Any] | None) -> str:
    svc = _compose_service_args(d)
    if svc:
        return f"cd {ddir!r} && {base} {svc}"
    # Refuse unscoped start/rebuild — too easy to bring up host-port containers.
    if base.startswith("docker compose up"):
        raise ValueError(
            "docker start/rebuild requires compose_services in projects.yaml "
            "(refusing unscoped `docker compose up`)"
        )
    return f"cd {ddir!r} && {base}"


def _build_commands(p: dict[str, Any], action: str, sudo_pw: str | None) -> list[str]:
    cmds: list[str] = []
    pm2_names = p.get("pm2", [])
    d = p.get("docker")
    ddir = expand(d["dir"]) if d else None

    if action in ("restart", "stop", "start"):
        if pm2_names:
            pm2_line = _pm2_cmd(action, pm2_names, p.get("pm2_bootstrap"))
            if pm2_line:
                cmds.append(pm2_line)
        if ddir:
            dc = {
                "restart": "docker compose restart",
                "stop": "docker compose stop",
                "start": "docker compose up -d",
            }[action]
            cmds.append(_docker_compose_cmd(ddir, dc, d))
    elif action == "rebuild":
        if ddir:
            cmds.append(
                _docker_compose_cmd(ddir, "docker compose up -d --build", d)
            )
        if pm2_names:
            cmds.append(f"pm2 restart {' '.join(pm2_names)}")
    elif action == "logs":
        if pm2_names:
            cmds.append(f"pm2 logs {' '.join(pm2_names)} --lines 120 --nostream")
        if ddir:
            cmds.append(
                _docker_compose_cmd(ddir, "docker compose logs --tail 120", d)
            )
    elif action == "deploy":
        dep = p.get("deploy")
        if not dep:
            raise ValueError("no deploy script configured")
        if not dep.get("safe"):
            raise ValueError(
                "deploy disabled for this project (set deploy.safe: true after "
                "verifying the script is non-interactive and project-scoped)"
            )
        script = expand(dep["script"])
        args = " ".join(str(a) for a in (dep.get("args") or []))
        invoke = f"bash {script!r}" + (f" {args}" if args else "")
        if dep.get("sudo"):
            if sudo_pw and ALLOW_SUDO_PASSWORD:
                cmds.append(f"echo {sudo_pw!r} | sudo -S -p '' {invoke}")
            else:
                cmds.append(f"sudo -n {invoke}")
        else:
            cmds.append(invoke)
    else:
        raise ValueError(f"unknown action: {action}")

    if not cmds:
        raise ValueError("nothing to do for this project/action")
    return cmds


def _run_job(job_id: str, cmds: list[str], action: str) -> None:
    def append(text: str) -> None:
        with JOBS_LOCK:
            JOBS[job_id]["output"] += text

    worst_rc = 0
    for cmd in cmds:
        # Redact any inlined sudo password before showing the command.
        shown = cmd
        if cmd.startswith("echo '") and "| sudo -S" in cmd:
            shown = "sudo -S " + cmd.split("| sudo -S -p '' ", 1)[-1]
        append(f"\n$ {shown}\n")
        rc = 0
        try:
            proc = subprocess.Popen(
                ["bash", "-lc", cmd],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                append(line)
            proc.wait(timeout=900)
            rc = proc.returncode or 0
        except subprocess.TimeoutExpired:
            append("\n[timed out after 900s]\n")
            rc = 124
        except Exception as exc:  # noqa: BLE001
            append(f"\n[error: {exc!r}]\n")
            rc = 1
        if rc != 0:
            worst_rc = rc
            if action == "deploy" and "sudo -n" in cmd:
                append(
                    "\n[sudo requires a password] Run this in a terminal instead:\n"
                    f"  {cmd.replace('sudo -n', 'sudo')}\n"
                    "Or enable ALLOW_SUDO_PASSWORD and use the password field.\n"
                )
                break
            # Keep going for restart/start so a missing PM2 process does not
            # skip the Docker half of a mixed project.
            if action == "deploy":
                break
            append(f"\n[continuing despite exit {rc}]\n")

    with JOBS_LOCK:
        JOBS[job_id]["rc"] = worst_rc
        JOBS[job_id]["done"] = True
        JOBS[job_id]["finished"] = int(time.time())


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/api/status")
def api_status(_: None = Depends(_auth)) -> JSONResponse:
    return JSONResponse(collect_status())


@app.post("/api/action")
def api_action(payload: dict[str, Any], _: None = Depends(_auth)) -> JSONResponse:
    pid = payload.get("project", "")
    action = payload.get("action", "")
    sudo_pw = payload.get("sudo_password")
    p = _find_project(pid)
    if not p:
        raise HTTPException(404, f"unknown project {pid!r}")
    try:
        cmds = _build_commands(p, action, sudo_pw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    job_id = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[job_id] = {
            "project": pid,
            "action": action,
            "output": "",
            "rc": None,
            "done": False,
            "started": int(time.time()),
        }
    threading.Thread(
        target=_run_job, args=(job_id, cmds, action), daemon=True
    ).start()
    return JSONResponse({"job": job_id})


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str, _: None = Depends(_auth)) -> JSONResponse:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "unknown job")
        return JSONResponse(dict(job))


@app.get("/")
def index(_: None = Depends(_auth)) -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

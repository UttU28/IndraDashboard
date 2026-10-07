"""Indra — one pane to view/control all Desktop projects.

Status (PM2 + Docker + ports + domains) and actions (restart/rebuild/stop/
start/logs/deploy/pull) for every project defined in projects.yaml.

Runs as your user on 127.0.0.1:9282 (put nginx in front for a domain).
PM2 and Docker actions need no sudo. Full deploy.sh needs sudo; see README.
"""
from __future__ import annotations

import asyncio
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
import websockets
import yaml
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, status
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
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

app = FastAPI(title="Indra", docs_url=None, redoc_url=None)
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


def argo_applications() -> dict[str, Any]:
    """Read-only Argo CD application status from the local cluster."""
    try:
        out = subprocess.run(
            ["kubectl", "get", "applications", "-n", "argocd", "-o", "json"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "apps": []}
    if out.returncode != 0:
        err = (out.stderr or out.stdout or "kubectl failed").strip()
        return {"ok": False, "error": err, "apps": []}
    try:
        data = json.loads(out.stdout or "{}")
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"bad kubectl json: {exc}", "apps": []}

    apps: list[dict[str, Any]] = []
    for item in data.get("items") or []:
        meta = item.get("metadata") or {}
        status_obj = item.get("status") or {}
        source = (item.get("spec") or {}).get("source") or {}
        sync = (status_obj.get("sync") or {}).get("status") or "Unknown"
        health = (status_obj.get("health") or {}).get("status") or "Unknown"
        urls = []
        for raw in (status_obj.get("summary") or {}).get("externalURLs") or []:
            if not isinstance(raw, str) or any(ch in raw for ch in "()$"):
                continue
            urls.append(raw.rstrip("/"))
        if sync == "Synced" and health == "Healthy":
            state = "up"
        elif health in ("Degraded", "Missing"):
            state = "down"
        else:
            state = "partial"
        revision = (status_obj.get("sync") or {}).get("revision") or ""
        apps.append(
            {
                "name": meta.get("name") or "?",
                "sync": sync,
                "health": health,
                "path": source.get("path") or "",
                "revision": revision[:7],
                "urls": urls,
                "state": state,
            }
        )
    apps.sort(key=lambda a: a["name"])
    return {"ok": True, "apps": apps}


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
                "has_rebuild": bool(d) or bool(p.get("pm2")),
                "ports": ports,
                "domains": domains,
                # Deploy only when explicitly marked safe (avoids interactive /
                # multi-project / wrong-cwd scripts).
                "deploy": bool(dep) and bool(dep.get("safe")),
                "has_git": bool(p.get("git_repos")),
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

    return {
        "projects": projects,
        "infra": infra,
        "argo": argo_applications(),
        "ts": int(time.time()),
    }


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
            f'if [ "$missing" = "1" ]; then SKIP_NGINX=1 bash {boot!r}; '
            f"else pm2 {pm2_action} {names_s}; fi"
        )
    return f"pm2 {pm2_action} {names_s}"


def _compose_env_file(d: dict[str, Any] | None, ddir: str) -> str | None:
    """Compose interpolates ${VAR} from --env-file; service env_file is not enough."""
    if d and d.get("env_file"):
        path = expand(str(d["env_file"]))
        return path if Path(path).is_file() else None
    for candidate in (Path(ddir) / ".env", Path(ddir).parent / ".env"):
        if candidate.is_file():
            return str(candidate)
    return None


def _docker_compose_cmd(ddir: str, base: str, d: dict[str, Any] | None) -> str:
    env_file = _compose_env_file(d, ddir)
    if env_file:
        base = base.replace("docker compose ", f"docker compose --env-file {env_file!r} ", 1)
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
        extra = p.get("rebuild") or []
        for raw in extra:
            cmds.append(os.path.expanduser(os.path.expandvars(str(raw))))
        if not extra:
            app_dir = expand(p.get("app_dir") or "")
            if not app_dir and p.get("git_repos"):
                app_dir = expand(p["git_repos"][0])
            venv_py = Path(app_dir, "venv/bin/python") if app_dir else None
            reqs = Path(app_dir, "requirements.txt") if app_dir else None
            if venv_py and venv_py.exists() and reqs and reqs.is_file():
                cmds.append(
                    f"cd {app_dir!r} && venv/bin/python -m pip install -r requirements.txt"
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


def _git_repos(p: dict[str, Any]) -> list[str]:
    return [expand(r) for r in (p.get("git_repos") or []) if r]


def _git_rev(repo: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", repo, "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if out.returncode != 0:
            return None
        return out.stdout.strip()
    except Exception:
        return None


STASH_MSG = "indra-pull-autostash"


def _git_cmd(repo: str, *args: str, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _git_dirty(repo: str) -> bool:
    try:
        return bool(_git_cmd(repo, "status", "--porcelain").stdout.strip())
    except Exception:
        return False


def _git_unmerged(repo: str) -> list[str]:
    try:
        out = _git_cmd(repo, "diff", "--name-only", "--diff-filter=U").stdout
        return [line.strip() for line in out.splitlines() if line.strip()]
    except Exception:
        return []


def _git_stream(
    repo: str,
    append,
    *args: str,
    timeout: int = 120,
) -> int:
    append(f"$ git -C {repo!r} {' '.join(args)}\n")
    try:
        proc = subprocess.Popen(
            ["git", "-C", repo, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            append(line)
        proc.wait(timeout=timeout)
        return proc.returncode or 0
    except subprocess.TimeoutExpired:
        append(f"\n[timed out after {timeout}s]\n")
        return 124
    except Exception as exc:  # noqa: BLE001
        append(f"\n[error: {exc!r}]\n")
        return 1


def _stream_cmds(cmds: list[str], append, action: str) -> int:
    worst_rc = 0
    for cmd in cmds:
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
            if action == "deploy":
                break
            append(f"\n[continuing despite exit {rc}]\n")
    return worst_rc


def _run_pull_job(job_id: str, project: dict[str, Any], repos: list[str]) -> None:
    def append(text: str) -> None:
        with JOBS_LOCK:
            JOBS[job_id]["output"] += text

    worst_rc = 0
    updated = False
    conflicts = False
    applied = False
    desktop = expand("~/Desktop")

    append(
        "Stash local changes → pull remote updates → stash pop.\n"
        "If git brought new commits, Rebuild runs in this same log.\n\n"
    )

    for repo in repos:
        rel = repo.replace(desktop + "/", "")
        append(f"\n=== {rel or repo} ===\n")
        git_meta = Path(repo, ".git")
        if not git_meta.is_dir() and not git_meta.is_file():
            append("[skip: not a git repo]\n")
            worst_rc = max(worst_rc, 1)
            continue

        try:
            branch = _git_cmd(repo, "branch", "--show-current").stdout.strip() or "unknown"
        except Exception:
            branch = "unknown"
        append(f"branch: {branch}\n")

        stashed = False
        if _git_dirty(repo):
            append("local changes detected — stashing before pull\n")
            rc = _git_stream(
                repo, append, "stash", "push", "-u", "-m", STASH_MSG, timeout=60
            )
            if rc != 0:
                append("stash: failed (pull skipped for this repo)\n")
                worst_rc = max(worst_rc, rc)
                continue
            stashed = True
            append("stash: ok\n")
        else:
            append("working tree clean — no stash needed\n")

        before = _git_rev(repo)
        rc = _git_stream(repo, append, "pull", "--ff-only")
        if rc != 0:
            append("pull: failed\n")
            if stashed:
                append("restoring stashed changes…\n")
                pop_rc = _git_stream(repo, append, "stash", "pop")
                if pop_rc != 0:
                    append(
                        "[warning] could not restore stash — "
                        "run `git stash list` and `git stash pop` manually\n"
                    )
                    conflicts = True
                    worst_rc = max(worst_rc, pop_rc)
                else:
                    append("stash restored\n")
            worst_rc = max(worst_rc, rc)
            continue

        after = _git_rev(repo)
        repo_updated = bool(before and after and before != after)
        if repo_updated:
            updated = True
            append("pull: ok (updated)\n")
        else:
            append("pull: ok (already up to date)\n")

        if not stashed:
            continue

        append("re-applying stashed changes…\n")
        pop_rc = _git_stream(repo, append, "stash", "pop")
        if pop_rc != 0:
            unmerged = _git_unmerged(repo)
            conflicts = True
            worst_rc = max(worst_rc, pop_rc)
            append("\n*** MERGE CONFLICT after stash pop ***\n")
            append(
                "Remote updates were pulled, but your local changes conflict.\n"
                "Resolve conflicts in the repo, then rebuild/restart when ready.\n"
            )
            if unmerged:
                append("Conflicted files:\n")
                for path in unmerged:
                    append(f"  • {path}\n")
            else:
                append(
                    "Check `git status` in the repo for conflict markers (<<<<<<<).\n"
                )
            append(f"Repo path: {repo}\n")
        else:
            append("stash pop: ok (local changes restored)\n")

    if updated and not conflicts and worst_rc == 0:
        apply_action = (
            "rebuild"
            if project.get("docker") or project.get("pm2")
            else None
        )
        if apply_action:
            try:
                cmds = _build_commands(project, apply_action, None)
            except ValueError as exc:
                append(f"\n[skip apply: {exc}]\n")
                cmds = []
            if cmds:
                append(f"\n=== apply updates ({apply_action}) ===\n")
                apply_rc = _stream_cmds(cmds, append, apply_action)
                worst_rc = max(worst_rc, apply_rc)
                applied = apply_rc == 0
                if applied:
                    append(f"\n{apply_action}: ok — updates are live\n")
                else:
                    append(f"\n{apply_action}: failed (exit {apply_rc})\n")

    with JOBS_LOCK:
        JOBS[job_id]["rc"] = worst_rc
        JOBS[job_id]["done"] = True
        JOBS[job_id]["updated"] = updated and not conflicts
        JOBS[job_id]["conflicts"] = conflicts
        JOBS[job_id]["applied"] = applied
        JOBS[job_id]["finished"] = int(time.time())


def _run_job(job_id: str, cmds: list[str], action: str) -> None:
    def append(text: str) -> None:
        with JOBS_LOCK:
            JOBS[job_id]["output"] += text

    worst_rc = _stream_cmds(cmds, append, action)

    with JOBS_LOCK:
        JOBS[job_id]["rc"] = worst_rc
        JOBS[job_id]["done"] = True
        JOBS[job_id]["finished"] = int(time.time())


# --------------------------------------------------------------------------- #
# Argo CD UI on this same host (/argocd/)
# --------------------------------------------------------------------------- #
_ARGO_SKIP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "content-encoding",
}
_ARGO_IP = {"ip": "", "at": 0.0}
_ARGO_IP_LOCK = threading.Lock()


def argocd_cluster_ip() -> str:
    now = time.time()
    with _ARGO_IP_LOCK:
        if _ARGO_IP["ip"] and now - _ARGO_IP["at"] < 30:
            return _ARGO_IP["ip"]
    out = subprocess.run(
        [
            "kubectl",
            "get",
            "svc",
            "argocd-server",
            "-n",
            "argocd",
            "-o",
            "jsonpath={.spec.clusterIP}",
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )
    ip = (out.stdout or "").strip()
    if out.returncode != 0 or not ip:
        raise HTTPException(502, (out.stderr or "Argo CD service not found").strip())
    with _ARGO_IP_LOCK:
        _ARGO_IP["ip"] = ip
        _ARGO_IP["at"] = time.time()
    return ip


def _argocd_request_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in request.headers.items():
        if key.lower() in _ARGO_SKIP_HEADERS:
            continue
        headers[key] = value
    headers["Accept-Encoding"] = "identity"
    headers["X-Forwarded-Proto"] = request.headers.get("x-forwarded-proto") or request.url.scheme
    headers["X-Forwarded-Host"] = request.headers.get("host", "")
    return headers


def _rewrite_argocd_location(value: str, ip: str) -> str:
    for prefix in (f"http://{ip}/argocd", f"https://{ip}/argocd"):
        if value.startswith(prefix):
            return "/argocd" + value[len(prefix) :]
    return value


def _argocd_response(upstream: requests.Response, ip: str, body: bytes | None, stream):
    pairs: list[tuple[bytes, bytes]] = []
    for key, value in upstream.raw.headers.items():
        if isinstance(key, bytes):
            key = key.decode("latin1")
        if isinstance(value, bytes):
            value = value.decode("latin1")
        if key.lower() in _ARGO_SKIP_HEADERS:
            continue
        if key.lower() == "location":
            value = _rewrite_argocd_location(value, ip)
        pairs.append((key.encode("latin1"), value.encode("latin1")))
    if body is not None:
        response = StreamingResponse(iter([body]), status_code=upstream.status_code)
        upstream.close()
    else:
        response = StreamingResponse(stream, status_code=upstream.status_code)
    response.raw_headers = pairs
    return response


def _proxy_argocd(request: Request, path: str, body: bytes):
    # Theme file is read on each request so edits apply on refresh.
    if path.strip("/") == "indra.css":
        css_path = BASE_DIR / "argocd-theme.css"
        if not css_path.is_file():
            raise HTTPException(404, "Argo theme CSS is missing")
        return Response(
            css_path.read_bytes(),
            media_type="text/css",
            headers={"Cache-Control": "no-cache"},
        )

    ip = argocd_cluster_ip()
    url = f"http://{ip}/argocd/{path}"
    if request.url.query:
        url += "?" + request.url.query
    try:
        upstream = requests.request(
            request.method,
            url,
            headers=_argocd_request_headers(request),
            data=body,
            stream=True,
            allow_redirects=False,
            timeout=(10, None),
        )
    except requests.RequestException as exc:
        raise HTTPException(502, f"Argo CD proxy failed: {exc}") from exc

    ctype = upstream.headers.get("content-type", "")
    if "text/html" in ctype:
        text = upstream.content.decode("utf-8", "replace")
        text = text.replace('<base href="/">', '<base href="/argocd/">', 1)
        theme = '<link rel="stylesheet" href="/argocd/indra.css">'
        text = text.replace("</head>", theme + "</head>", 1)
        return _argocd_response(upstream, ip, text.encode(), None)

    def chunks():
        try:
            for chunk in upstream.iter_content(65536):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return _argocd_response(upstream, ip, None, chunks())


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

    if action == "pull":
        repos = _git_repos(p)
        if not repos:
            raise HTTPException(400, "no git_repos configured for this project")
        job_id = uuid.uuid4().hex[:12]
        with JOBS_LOCK:
            JOBS[job_id] = {
                "project": pid,
                "action": action,
                "output": "",
                "rc": None,
                "done": False,
                "updated": False,
                "conflicts": False,
                "applied": False,
                "started": int(time.time()),
            }
        threading.Thread(
            target=_run_pull_job, args=(job_id, p, repos), daemon=True
        ).start()
        return JSONResponse({"job": job_id})

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
            "updated": False,
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


@app.api_route("/argocd", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def argocd_root(_: None = Depends(_auth)) -> RedirectResponse:
    return RedirectResponse("/argocd/", status_code=307)


@app.api_route(
    "/argocd/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def argocd_proxy(path: str, request: Request, _: None = Depends(_auth)):
    body = await request.body()
    return await asyncio.to_thread(_proxy_argocd, request, path, body)


@app.websocket("/argocd/{path:path}")
async def argocd_terminal(websocket: WebSocket, path: str) -> None:
    await websocket.accept()
    try:
        ip = argocd_cluster_ip()
    except HTTPException:
        await websocket.close(code=1011)
        return
    query = websocket.scope.get("query_string", b"").decode()
    url = f"ws://{ip}/argocd/{path}"
    if query:
        url += "?" + query
    headers = [
        (key, value)
        for key, value in websocket.headers.items()
        if key.lower()
        not in {
            "host",
            "connection",
            "upgrade",
            "sec-websocket-key",
            "sec-websocket-version",
            "sec-websocket-extensions",
        }
    ]
    try:
        async with websockets.connect(
            url,
            additional_headers=headers,
            proxy=None,
            open_timeout=10,
            max_size=8 * 1024 * 1024,
        ) as upstream:
            async def client_to_server() -> None:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    if message.get("text") is not None:
                        await upstream.send(message["text"])
                    elif message.get("bytes") is not None:
                        await upstream.send(message["bytes"])

            async def server_to_client() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            done, pending = await asyncio.wait(
                {
                    asyncio.create_task(client_to_server()),
                    asyncio.create_task(server_to_client()),
                },
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
    except Exception:
        pass
    try:
        await websocket.close()
    except Exception:
        pass


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

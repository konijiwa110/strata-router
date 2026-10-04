"""核心：节点、配置、访问密钥、路由决策、健康检查。"""
import hashlib
import hmac
import http.client
import json
import os
import random
import secrets
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

MAX_SESSIONS = 1024
MAX_ROOTS = 4                                  # 每个节点记住的固定前缀数（对应 Strata 的系统提示检查点）
STATUS_KEYS = ("phase", "prompt_tokens", "generated", "max_tokens", "elapsed_s", "tokens_per_s")
MODES = ("enabled", "draining", "disabled")
STRATEGIES = ("even", "least_load", "random", "weighted")
DEFAULTS = {
    "listen": "0.0.0.0",
    "port": 8099,
    "routing": {"strategy": "even", "sticky": True, "reroute_max_tokens": 20000, "exclude_fixed": True, "retry": True},
    "health": {"interval_s": 2.0, "timeout_s": 3.0, "fail_threshold": 2, "metrics_interval_s": 5.0},
    "system": {"log_retention_days": 30, "session_hours": 72},
    "admin": {},
    "keys": [],
    "backends": [],
}


def now():
    return time.time()


def hash_key(k):
    return hashlib.sha256(k.encode()).hexdigest()


def hash_password(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"pbkdf2${salt}${h}"


def check_password(pw, stored):
    try:
        _, salt, _ = stored.split("$")
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(hash_password(pw, salt), stored)


def mask(k):
    return f"{k[:4]}…{k[-3:]}" if len(k) > 8 else "…"


def http_json(host, port, method, path, key, timeout):
    c = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        c.request(method, path, headers={"Authorization": f"Bearer {key}"} if key else {})
        r = c.getresponse()
        data = r.read()
        try:
            return r.status, json.loads(data) if data else None
        except ValueError:
            return r.status, None
    finally:
        c.close()


def migrate(cfg):
    """补齐默认值；把旧格式（顶层 api_key / strategy / reroute_max_tokens）转成新格式。"""
    out = json.loads(json.dumps(DEFAULTS))
    for k, v in cfg.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        elif k in out:
            out[k] = v
    if "strategy" in cfg:
        out["routing"]["strategy"] = cfg["strategy"]
    if "reroute_max_tokens" in cfg:
        out["routing"]["reroute_max_tokens"] = cfg["reroute_max_tokens"]
    if cfg.get("api_key") and not out["keys"]:
        k = cfg["api_key"]
        out["keys"] = [{"id": secrets.token_hex(4), "name": "默认", "hash": hash_key(k), "hint": mask(k),
                        "enabled": True, "created": now()}]
    for b in out["backends"]:
        b.setdefault("id", secrets.token_hex(4))
    return out


class Backend:
    def __init__(self, c):
        self.id = c.get("id") or secrets.token_hex(4)
        self.update(c)
        self.up = self.busy = False
        self.fails = self.queued = self.inflight = self.served = 0
        self.ever_up = False                             # 首次探测到在线不算“恢复”
        self.roots = []                              # 最近处理过的固定前缀指纹
        self.detail, self.metrics, self.info = {}, None, {}
        self.last_seen, self.last_error, self.metrics_at = None, "", 0.0

    def update(self, c):
        self.url = c["url"].rstrip("/")
        u = urlsplit(self.url)
        self.host, self.port = u.hostname, u.port or 80
        self.key = c.get("api_key", "")
        self.name = c.get("name") or f"{self.host}:{self.port}"
        self.weight = max(1, int(c.get("weight", 1)))
        self.tags = list(c.get("tags") or [])
        self.mode = c.get("mode", "enabled") if c.get("mode", "enabled") in MODES else "enabled"

    def config(self):
        return {"id": self.id, "name": self.name, "url": self.url, "api_key": self.key, "weight": self.weight,
                "tags": self.tags, "mode": self.mode}

    def connect(self, timeout=None):
        return http.client.HTTPConnection(self.host, self.port, timeout=timeout)

    def poll_status(self, timeout, fail_threshold):
        """返回 "up" / "down" 表示状态发生了切换，否则 None。"""
        try:
            st, s = http_json(self.host, self.port, "GET", "/status", self.key, timeout)
            if st != 200 or not isinstance(s, dict):
                raise OSError(f"HTTP {st}")
        except Exception as e:                       # noqa: BLE001 - 任何失败都算一次探测失败
            self.fails += 1
            self.last_error = str(e) or type(e).__name__
            if self.up and self.fails >= fail_threshold:
                self.up = False
                return "down"
            return None
        self.busy, self.queued = bool(s.get("busy")), int(s.get("queued") or 0)
        self.detail = {k: s.get(k) for k in STATUS_KEYS}
        self.fails, self.last_error, self.last_seen = 0, "", now()
        if not self.up:
            self.up = True
            if self.ever_up:
                return "up"
            self.ever_up = True
        return None

    def poll_metrics(self, timeout):
        try:
            st, m = http_json(self.host, self.port, "GET", "/metrics", self.key, timeout)
        except Exception:                            # noqa: BLE001
            return
        if st == 200 and isinstance(m, dict):
            self.metrics, self.metrics_at = m, now()
            eng, hw = m.get("engine") or {}, m.get("hardware_static") or {}
            self.info = {"model": eng.get("model"), "version": eng.get("version"), "context": eng.get("max_context"),
                         "gpu": hw.get("gpu_name"), "cpu": hw.get("cpu_name")}

    def idle(self):
        return self.up and not self.busy and self.queued == 0 and self.inflight == 0

    def load(self):
        return self.inflight + self.queued + (1 if self.busy else 0)

    def state(self):
        """运行状态：offline / generating / reading / queued / idle。"""
        if not self.up:
            return "offline"
        if self.busy or self.inflight:
            return "reading" if (self.detail.get("phase") or "").startswith("reading") else "generating"
        return "queued" if self.queued else "idle"

    def summary(self):
        hw = (self.metrics or {}).get("hardware") or {}
        hist = (self.metrics or {}).get("history") or {}
        live, ml = dict(self.detail), (self.metrics or {}).get("live") or {}
        if self.state() == "reading" and ml.get("state") == "reading" and ml.get("prompt_total"):
            live["prompt_read"], live["prompt_total"] = ml.get("prompt_read"), ml["prompt_total"]   # 读取进度只在 /metrics 里有
        return {"id": self.id, "name": self.name, "url": self.url, "mode": self.mode, "weight": self.weight,
                "tags": self.tags, "up": self.up, "state": self.state(), "busy": self.busy, "queued": self.queued,
                "inflight": self.inflight, "served": self.served, "last_seen": self.last_seen,
                "last_error": self.last_error, "info": self.info, "live": live, "key_hint": mask(self.key),
                "hw": {k: hw.get(k) for k in ("gpu_util", "gpu_mem_used", "gpu_mem_total", "gpu_temp", "gpu_power",
                                              "cpu", "ram_used", "ram_total")},
                "spark": {k: hist.get(k, [])[-30:] for k in ("tok_s", "gpu_util", "gpu_mem_used")}}


class Cluster:
    def __init__(self, path=None, cfg=None):
        self.path = path
        if cfg is None:
            with open(path, encoding="utf-8") as f:
                cfg = json.load(f)
        self.lock = threading.RLock()
        self.sessions = OrderedDict()               # 会话指纹 -> 节点 id
        self.backends = []
        self.on_event = lambda typ, node, msg: None
        self.apply(migrate(cfg))
        self.pool = ThreadPoolExecutor(max_workers=16)

    # ---- 配置 ----
    def apply(self, cfg):
        with self.lock:
            old = {b.id: b for b in self.backends}
            new = []
            for c in cfg["backends"]:
                b = old.get(c["id"])
                if b:
                    b.update(c)
                else:
                    b = Backend(c)
                new.append(b)
            self.cfg, self.backends = cfg, new

    def save(self):
        with self.lock:
            self.cfg["backends"] = [b.config() for b in self.backends]
            data = json.dumps(self.cfg, ensure_ascii=False, indent=2) + "\n"
        if self.path:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(data)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)

    @property
    def routing(self):
        return self.cfg["routing"]

    @property
    def health(self):
        return self.cfg["health"]

    def node(self, node_id):
        return next((b for b in self.backends if b.id == node_id), None)

    # ---- 访问密钥 ----
    def check_key(self, given):
        if not given:
            return None
        h = hash_key(given)
        for k in self.cfg["keys"]:
            if k.get("enabled", True) and hmac.compare_digest(k["hash"], h):
                return k
        return None

    # ---- 健康检查 ----
    def refresh(self, nodes=None, metrics=False, reading_metrics=False):
        """metrics：所有在线节点拉一次 /metrics；reading_metrics：只给正在读取提示的节点拉，用于显示读取进度。"""
        nodes = list(self.backends) if nodes is None else nodes
        h = self.health
        changes = list(self.pool.map(lambda b: (b, b.poll_status(h["timeout_s"], h["fail_threshold"])), nodes))
        for b, ch in changes:
            if ch == "up":
                self.on_event("node_up", b, ("节点恢复在线", "Node back online"))
            elif ch == "down":
                self.on_event("node_down", b, (f"节点离线：{b.last_error}", f"Node offline: {b.last_error}"))
        want = [b for b in nodes if b.up and (metrics or (reading_metrics and b.state() == "reading"))]
        if want:
            list(self.pool.map(lambda b: b.poll_metrics(h["timeout_s"]), want))

    def refresh_for_request(self):
        """请求到达时只快速刷新在线且参与分配的节点，避免离线节点拖慢请求。"""
        self.refresh([b for b in self.backends if b.up and b.mode != "disabled"])

    def health_loop(self, stop):
        last_metrics = 0.0
        while not stop.is_set():
            t = now()
            want_metrics = t - last_metrics >= self.health["metrics_interval_s"]
            try:
                self.refresh(metrics=want_metrics, reading_metrics=True)
            except Exception as e:                   # noqa: BLE001 - 健康检查线程不能退出
                print("health loop error:", e, flush=True)
            if want_metrics:
                last_metrics = t
            stop.wait(max(0.1, self.health["interval_s"] - (now() - t)))

    # ---- 路由 ----
    def by_strategy(self, cands):
        s = self.routing["strategy"]
        if s == "random":
            return random.choice(cands)
        if s == "least_load":
            return min(cands, key=lambda b: b.load())
        if s == "weighted":
            return min(cands, key=lambda b: b.served / b.weight)
        return min(cands, key=lambda b: b.served)    # even：累计分配次数最少

    def pick(self, sess, est_tokens, fixed=None, fixed_tokens=0, exclude=()):
        """返回 (节点, 原因, 决策快照)，并把节点 inflight 加一；没有可用节点时节点为 None。
        换节点的代价：目标节点处理过同样的固定前缀（系统提示 + 工具）时只算对话部分，否则算全部。"""
        r = self.routing
        if not r["exclude_fixed"]:
            fixed_tokens = 0
        with self.lock:
            usable = [b for b in self.backends if b.up and b.mode != "disabled" and b.id not in exclude]
            enabled = [b for b in usable if b.mode == "enabled"]
            idle = [b for b in enabled if b.idle()]
            home = None
            if r["sticky"] and sess:
                home = next((b for b in usable if self.sessions.get(sess) == b.id), None)

            def cost(x):
                return est_tokens - fixed_tokens if fixed and fixed in x.roots else est_tokens

            snap = [{"id": b.id, "name": b.name, "mode": b.mode, "up": b.up, "busy": b.busy, "queued": b.queued,
                     "inflight": b.inflight, "cost": cost(b), "home": b is home} for b in self.backends]
            if not usable:
                return None, "no-node", snap
            if home and home.idle():
                b, why = home, "sticky"
            elif home and idle:
                best = min(idle, key=cost)
                if cost(best) <= r["reroute_max_tokens"]:
                    b, why = best, "moved"
                else:
                    b, why = home, "sticky-wait"
            elif home:
                b, why = home, "sticky-allbusy"
            elif idle:
                b, why = self.by_strategy(idle), "idle"
            elif enabled:
                b, why = self.by_strategy(enabled), "allbusy"
            else:
                b, why = self.by_strategy(usable), "fallback-draining"
            b.inflight += 1
            if fixed:
                if fixed in b.roots:
                    b.roots.remove(fixed)
                b.roots = (b.roots + [fixed])[-MAX_ROOTS:]
            if sess:
                b.served += 1
                self.sessions[sess] = b.id
                self.sessions.move_to_end(sess)
                while len(self.sessions) > MAX_SESSIONS:
                    self.sessions.popitem(last=False)
            return b, why, snap

    def release(self, b):
        with self.lock:
            b.inflight -= 1

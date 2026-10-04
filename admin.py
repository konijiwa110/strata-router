"""管理接口 /api/admin/*：登录、总览、节点、请求、访问密钥、设置。"""
import secrets
import time
import traceback
from urllib.parse import urlsplit

from core import MODES, STRATEGIES, Backend, check_password, hash_key, hash_password, http_json, mask, now
from store import day_start

PUBLIC = {("POST", "login")}


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def need(cond, message, code=400):
    if not cond:
        raise ApiError(code, message)


def login(app, body):
    pw = body.get("password") or ""
    if not check_password(pw, app.cluster.cfg["admin"].get("password_hash")):
        time.sleep(1)                                  # 减缓暴力尝试
        raise ApiError(401, "密码不正确")
    token = secrets.token_urlsafe(32)
    hours = app.cluster.cfg["system"]["session_hours"]
    app.store.add_session(hash_key(token), now() + hours * 3600)
    return {"token": token, "expires_in": hours * 3600}


def authorized(app, token):
    return bool(token) and app.store.session_valid(hash_key(token))


# ---- 节点 ----
def probe(url, key, timeout=5):
    """测试连接：返回探测到的信息；失败抛 ApiError。"""
    u = urlsplit(url)
    need(u.scheme == "http" and u.hostname, "地址需要形如 http://主机:端口")
    host, port = u.hostname, u.port or 80
    try:
        st, health = http_json(host, port, "GET", "/health", None, timeout)
    except OSError as e:
        raise ApiError(400, f"无法连接：{e}") from e
    need(st == 200 and isinstance(health, dict) and health.get("service") == "strata", "该地址不是 Strata 服务")
    st, _ = http_json(host, port, "GET", "/status", key, timeout)
    need(st != 401, "节点密钥不正确")
    need(st == 200, f"状态接口返回 {st}")
    st, m = http_json(host, port, "GET", "/metrics", key, timeout)
    eng, hw = (m or {}).get("engine") or {}, (m or {}).get("hardware_static") or {}
    return {"model": health.get("model"), "context": health.get("max_context"), "images": health.get("images"),
            "loaded": health.get("loaded"), "version": eng.get("version"), "gpu": hw.get("gpu_name"),
            "gpu_count": hw.get("gpu_count"), "cpu": hw.get("cpu_name")}


def node_fields(body, partial):
    out = {}
    if "name" in body:
        out["name"] = (body.get("name") or "").strip()
    if "weight" in body:
        try:
            out["weight"] = int(body["weight"])
        except (TypeError, ValueError):
            raise ApiError(400, "权重需要是整数") from None
        need(1 <= out["weight"] <= 100, "权重范围 1～100")
    if "tags" in body:
        tags = body["tags"]
        need(isinstance(tags, list) and all(isinstance(t, str) for t in tags), "标签格式不正确")
        out["tags"] = [t.strip() for t in tags if t.strip()][:10]
    if "mode" in body:
        need(body["mode"] in MODES, "管理状态不正确")
        out["mode"] = body["mode"]
    if body.get("api_key") or not partial:
        out["api_key"] = body.get("api_key") or ""
    return out


def nodes_with_today(app):
    today = app.store.totals(day_start(), "node_id")
    total = app.store.totals(0, "node_id")
    rows = []
    for b in app.cluster.backends:
        s = b.summary()
        s["today"] = today.get(b.id, {"requests": 0, "output_tokens": 0, "errors": 0})
        s["total"] = total.get(b.id, {"requests": 0, "output_tokens": 0, "errors": 0})
        rows.append(s)
    return rows


def add_node(app, body):
    c = app.cluster
    url = (body.get("url") or "").strip().rstrip("/")
    f = node_fields(body, partial=False)
    with c.lock:
        need(not any(b.url == url for b in c.backends), "该地址已经添加过", 409)
        need(not f.get("name") or not any(b.name == f["name"] for b in c.backends), "名称已被使用", 409)
    info = probe(url, f["api_key"])
    b = Backend({"url": url, **f})
    with c.lock:
        c.backends.append(b)
    c.save()
    c.refresh([b], metrics=True)
    app.event("node_added", b, f"添加节点 {url}")
    return b.summary() | {"probe": info}


def patch_node(app, b, body):
    c = app.cluster
    f = node_fields(body, partial=True)
    if f.get("name"):
        need(not any(x.name == f["name"] and x is not b for x in c.backends), "名称已被使用", 409)
    if "api_key" in f:
        probe(b.url, f["api_key"])
    old_mode = b.mode
    with c.lock:
        cfg = b.config()
        cfg.update({k: v for k, v in f.items() if k != "name" or v})
        b.update(cfg)
    c.save()
    if b.mode != old_mode:
        app.event("node_mode", b, {"enabled": "启用", "draining": "排空", "disabled": "停用"}[b.mode])
    elif f:
        app.event("node_edit", b, "修改节点设置")
    return b.summary()


def delete_node(app, b):
    c = app.cluster
    with c.lock:
        c.backends = [x for x in c.backends if x is not b]
    c.save()
    app.event("node_removed", b, f"删除节点 {b.url}")
    return {"ok": True}


def node_detail(app, b):
    s = b.summary()
    s["metrics"] = b.metrics
    s["metrics_at"] = b.metrics_at
    s["today"] = app.store.totals(day_start(), "node_id").get(b.id, {"requests": 0, "output_tokens": 0, "errors": 0})
    s["recent"], _ = app.store.list_requests(node=b.id, limit=20)
    return s


# ---- 总览 ----
def overview(app):
    nodes = nodes_with_today(app)
    t = app.store.totals(day_start())
    prompt = t["prompt_tokens"] or 0
    live_speed = sum((n["live"].get("tokens_per_s") or 0) for n in nodes if n["state"] == "generating")
    return {
        "cluster": {"nodes": len(nodes), "online": sum(n["up"] for n in nodes),
                    "generating": sum(n["state"] in ("generating", "reading") for n in nodes),
                    "queued": sum(n["queued"] for n in nodes), "tok_s": round(live_speed, 1),
                    "sessions": len(app.cluster.sessions)},
        "today": t | {"hit_rate": round((t["cached_tokens"] or 0) / prompt, 3) if prompt else None},
        "nodes": nodes,
        "series": app.store.series(60),
        "events": app.store.events(15),
        "recent": app.store.list_requests(limit=8)[0],
    }


# ---- 访问密钥 ----
def keys_list(app):
    today = app.store.totals(day_start(), "key_id")
    total = app.store.totals(0, "key_id")
    return [{k: v for k, v in key.items() if k != "hash"} |
            {"today": today.get(key["id"], {"requests": 0, "output_tokens": 0}),
             "total": total.get(key["id"], {"requests": 0, "output_tokens": 0, "last_ts": None})}
            for key in app.cluster.cfg["keys"]]


def add_key(app, body):
    name = (body.get("name") or "").strip()
    need(name, "请填写名称")
    raw = (body.get("key") or "").strip() or "sk-" + secrets.token_urlsafe(24)
    need(len(raw) >= 8, "密钥至少 8 位")
    c = app.cluster
    with c.lock:
        need(not any(k["hash"] == hash_key(raw) for k in c.cfg["keys"]), "该密钥已存在", 409)
        item = {"id": secrets.token_hex(4), "name": name, "hash": hash_key(raw), "hint": mask(raw),
                "enabled": True, "created": now()}
        c.cfg["keys"].append(item)
    c.save()
    app.event("key_added", None, f"新建访问密钥 {name}")
    return {k: v for k, v in item.items() if k != "hash"} | {"key": raw}


def patch_key(app, key, body):
    if "name" in body:
        need((body["name"] or "").strip(), "名称不能为空")
        key["name"] = body["name"].strip()
    if "enabled" in body:
        key["enabled"] = bool(body["enabled"])
        app.event("key_toggle", None, f"{'启用' if key['enabled'] else '停用'}访问密钥 {key['name']}")
    app.cluster.save()
    return {k: v for k, v in key.items() if k != "hash"}


def delete_key(app, key):
    c = app.cluster
    with c.lock:
        c.cfg["keys"] = [k for k in c.cfg["keys"] if k is not key]
    c.save()
    app.event("key_removed", None, f"删除访问密钥 {key['name']}")
    return {"ok": True}


# ---- 设置 ----
def settings(app):
    c = app.cluster.cfg
    return {"routing": c["routing"], "health": c["health"], "system": c["system"],
            "listen": c["listen"], "port": c["port"]}


def put_settings(app, body):
    c = app.cluster
    new = {k: dict(c.cfg[k]) for k in ("routing", "health", "system")}
    for sec in new:
        for k, v in (body.get(sec) or {}).items():
            need(k in new[sec], f"未知设置 {sec}.{k}")
            new[sec][k] = v
    r, h, s = new["routing"], new["health"], new["system"]
    need(r["strategy"] in STRATEGIES, "分配策略不正确")
    for k in ("sticky", "exclude_fixed", "retry"):
        need(isinstance(r[k], bool), f"{k} 需要是开关")
    try:
        r["reroute_max_tokens"] = int(r["reroute_max_tokens"])
        h["interval_s"], h["timeout_s"] = float(h["interval_s"]), float(h["timeout_s"])
        h["metrics_interval_s"], h["fail_threshold"] = float(h["metrics_interval_s"]), int(h["fail_threshold"])
        s["log_retention_days"], s["session_hours"] = int(s["log_retention_days"]), int(s["session_hours"])
        port = int(body.get("port", c.cfg["port"]))
    except (TypeError, ValueError):
        raise ApiError(400, "数值格式不正确") from None
    need(0 <= r["reroute_max_tokens"] <= 1_000_000, "换节点阈值范围 0～1000000")
    need(0.1 <= h["interval_s"] <= 60 and 0.5 <= h["timeout_s"] <= 30, "检查间隔 0.1～60 秒，超时 0.5～30 秒")
    need(0.5 <= h["metrics_interval_s"] <= 300 and 1 <= h["fail_threshold"] <= 20, "指标间隔或失败次数超出范围")
    need(1 <= s["log_retention_days"] <= 3650 and 1 <= s["session_hours"] <= 24 * 90, "保留天数或登录有效期超出范围")
    need(1 <= port <= 65535, "端口范围 1～65535")
    with c.lock:
        c.cfg.update(new)
        restart = port != c.cfg["port"]
        c.cfg["port"] = port
    c.save()
    app.event("settings", None, "修改设置")
    return settings(app) | {"restart_required": restart}


def change_password(app, body, token):
    need(check_password(body.get("old") or "", app.cluster.cfg["admin"].get("password_hash")), "当前密码不正确", 403)
    pw = body.get("new") or ""
    need(len(pw) >= 8, "新密码至少 8 位")
    app.cluster.cfg["admin"]["password_hash"] = hash_password(pw)
    app.cluster.save()
    app.store.drop_all_sessions()
    app.event("password", None, "修改管理员密码")
    return login(app, {"password": pw})


# ---- 分发 ----
def handle(app, method, path, query, body, token):
    """path 为 /api/admin/ 之后的部分。返回 (状态码, 对象)。"""
    parts = [p for p in path.split("/") if p]
    try:
        if (method, "/".join(parts)) not in PUBLIC and not authorized(app, token):
            raise ApiError(401, "请先登录")
        return 200, route(app, method, parts, query, body, token)
    except ApiError as e:
        return e.code, {"error": {"message": str(e)}}
    except Exception as e:                                       # noqa: BLE001 - 意外错误返回 500 并记录堆栈
        print(f"admin {method} {path} failed:\n{traceback.format_exc()}", flush=True)
        return 500, {"error": {"message": f"服务内部错误：{e}"}}


def route(app, method, parts, query, body, token):
    c = app.cluster
    head, rest = (parts[0] if parts else ""), parts[1:]
    if head == "login" and method == "POST":
        return login(app, body)
    if head == "logout" and method == "POST":
        app.store.drop_session(hash_key(token))
        return {"ok": True}
    if head == "me" and method == "GET":
        return {"ok": True}
    if head == "overview" and method == "GET":
        return overview(app)
    if head == "nodes":
        if not rest:
            if method == "GET":
                return nodes_with_today(app)
            if method == "POST":
                return add_node(app, body)
        elif rest == ["test"] and method == "POST":
            return probe((body.get("url") or "").strip().rstrip("/"), body.get("api_key") or "")
        else:
            b = c.node(rest[0])
            need(b, "没有这个节点", 404)
            if method == "GET":
                return node_detail(app, b)
            if method == "PATCH":
                return patch_node(app, b, body)
            if method == "DELETE":
                return delete_node(app, b)
    if head == "requests" and method == "GET":
        if rest:
            r = app.store.get_request(int(rest[0])) if rest[0].isdigit() else None
            need(r, "没有这条请求", 404)
            return r
        g = lambda k: (query.get(k) or [None])[0]       # noqa: E731
        hours = float(g("hours") or 24)
        rows, total = app.store.list_requests(
            since=now() - hours * 3600 if hours > 0 else None, node=g("node"), key=g("key"), outcome=g("outcome"),
            reason=g("reason"), session=g("session"), q=g("q"),
            limit=min(int(g("limit") or 50), 200), offset=int(g("offset") or 0))
        return {"rows": rows, "total": total}
    if head == "keys":
        if not rest:
            if method == "GET":
                return keys_list(app)
            if method == "POST":
                return add_key(app, body)
        else:
            key = next((k for k in c.cfg["keys"] if k["id"] == rest[0]), None)
            need(key, "没有这个密钥", 404)
            if method == "PATCH":
                return patch_key(app, key, body)
            if method == "DELETE":
                return delete_key(app, key)
    if head == "settings":
        if method == "GET":
            return settings(app)
        if method == "PUT":
            return put_settings(app, body)
    if head == "password" and method == "POST":
        return change_password(app, body, token)
    if head == "logs" and rest == ["cleanup"] and method == "POST":
        days = int(body.get("days") or c.cfg["system"]["log_retention_days"])
        n = app.store.cleanup(days)
        app.event("cleanup", None, f"清理 {days} 天前的日志 {n} 条")
        return {"deleted": n}
    raise ApiError(404, "接口不存在")

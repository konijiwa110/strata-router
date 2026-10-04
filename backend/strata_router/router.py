"""Strata Router 入口：生成请求优先发到空闲节点，同一会话尽量回到原节点以保住对话缓存；附带管理控制台。只用标准库。"""
import hashlib
import json
import re
import mimetypes
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import admin
from .core import Cluster, hash_password, now
from .store import Store

GEN_PATHS = {"/v1/chat/completions": "openai", "/v1/messages": "anthropic", "/v1/responses": "responses"}
SKIP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization",
                "proxy-connection", "host", "content-length", "authorization", "x-api-key"}
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # 仓库根目录
WEB_DIR = os.path.join(ROOT, "web", "dist")


class App:
    def __init__(self, cluster, store):
        self.cluster, self.store = cluster, store
        cluster.on_event = self.event

    def event(self, typ, node, message):
        """message 为 (中文, 英文)，或只有中文的字符串。"""
        zh, en = message if isinstance(message, tuple) else (message, None)
        self.store.add_event(typ, node.id if node else None, node.name if node else None, zh, en)


# ---- 请求解析 ----
def _strip(x):
    """去掉 cache_control 等不影响内容的字段，避免指纹变化。"""
    if isinstance(x, dict):
        return {k: _strip(v) for k, v in x.items() if k != "cache_control"}
    if isinstance(x, list):
        return [_strip(v) for v in x]
    return x


def _digest(obj):
    raw = json.dumps(_strip(obj), ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha1(raw).hexdigest(), len(raw)


def fixed_part(path, req):
    """固定前缀：系统提示 + 工具列表。返回 (指纹, 粗估 token 数)；没有时返回 (None, 0)。"""
    if path == "/v1/messages":
        head = [req.get("system"), req.get("tools")]
    else:
        msgs = req.get("messages") or []
        n = next((i for i, m in enumerate(msgs) if m.get("role") not in ("system", "developer")), len(msgs))
        head = [msgs[:n], req.get("tools")]
    if not any(head):
        return None, 0
    h, size = _digest(head)
    return h, size // 3


def session_key(path, req):
    """会话指纹：系统提示 + 第一条用户消息。同一会话后续轮次这部分不变。"""
    msgs = req.get("messages") or []
    if not msgs:
        return None
    if path == "/v1/messages":
        head = [req.get("system"), msgs[:1]]
    else:
        n = next((i for i, m in enumerate(msgs) if m.get("role") == "user"), len(msgs) - 1)
        head = msgs[:n + 1]
    return _digest(head)[0]


def responses_view(req):
    """Responses 请求的 instructions + input 整理成 Chat 形式，只用于会话识别、固定前缀估算和预览。"""
    msgs = [{"role": "system", "content": req["instructions"]}] if req.get("instructions") else []
    items = req.get("input")
    for it in [{"role": "user", "content": items}] if isinstance(items, str) else items or []:
        if isinstance(it, dict) and it.get("role"):
            msgs.append({**it, "role": "system" if it["role"] == "developer" else it["role"]})
        elif isinstance(it, dict):                                 # function_call 等非消息条目
            msgs.append(it)
    return {"messages": msgs, "tools": req.get("tools")}


def preview(req):
    """最后一条用户消息的文字摘要，便于在请求日志里辨认。"""
    for m in reversed(req.get("messages") or []):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        if isinstance(c, list):
            c = " ".join(p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") in ("text", "input_text"))
        text = " ".join(REMINDER.sub(" ", str(c or "")).split())
        if text:
            return text[:160]
    return ""


def read_usage(obj, out):
    """从 OpenAI / Anthropic / Responses 响应对象（或流式事件）里取用量，写入 out。"""
    u = obj.get("usage") or (obj.get("message") or {}).get("usage") or (obj.get("response") or {}).get("usage")
    if not isinstance(u, dict):
        return
    if "prompt_tokens" in u:                                      # OpenAI
        out["prompt_tokens"] = u.get("prompt_tokens")
        out["cached_tokens"] = (u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
        out["output_tokens"] = u.get("completion_tokens")
    elif "input_tokens_details" in u:                             # Responses：input 含命中部分
        out["prompt_tokens"] = u.get("input_tokens")
        out["cached_tokens"] = (u.get("input_tokens_details") or {}).get("cached_tokens") or 0
        out["output_tokens"] = u.get("output_tokens")
    elif "input_tokens" in u:                                     # Anthropic：input 为未命中部分
        cached = u.get("cache_read_input_tokens") or 0
        out["prompt_tokens"] = (u.get("input_tokens") or 0) + cached
        out["cached_tokens"] = cached
        out["output_tokens"] = u.get("output_tokens") or 0


REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
FIRST_TOKEN = re.compile(rb'"content_block_delta"|"(?:reasoning_)?content":\s*"[^"]|"delta":\s*"[^"]')   # 空内容（节点第一块）不算首字


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    app = None

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, obj, headers=()):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _bearer(self):
        auth = self.headers.get("Authorization", "")
        return auth[7:].strip() if auth.lower().startswith("bearer ") else self.headers.get("x-api-key", "")

    def do_GET(self):
        self.handle_any()

    def do_POST(self):
        self.handle_any()

    def do_PUT(self):
        self.handle_any()

    def do_PATCH(self):
        self.handle_any()

    def do_DELETE(self):
        self.handle_any()

    def do_OPTIONS(self):
        self.handle_any()

    def handle_any(self):
        app = self.app
        u = urlsplit(self.path)
        path = u.path
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.command == "GET" and (path == "/admin" or path.startswith("/admin/")):
            return self.static(path)
        if path.startswith("/api/admin/"):
            try:
                req = json.loads(body) if body else {}
                if not isinstance(req, dict):
                    raise ValueError
            except ValueError:
                return self._send(400, {"error": {"message": admin.pick(("请求体需要是 JSON 对象", "Body must be a JSON object"),
                                                                       self.headers.get("X-Lang"))}})
            code, res = admin.handle(app, self.command, path[len("/api/admin/"):], parse_qs(u.query), req,
                                     self._bearer(), self.headers.get("X-Lang"))
            return self._send(code, res)
        key = None
        if self.command != "OPTIONS" and (path.startswith("/v1/") or path == "/status"):
            key = app.cluster.check_key(self._bearer())
            if not key:
                return self._send(401, {"error": {"type": "authentication_error", "message": "invalid api key"}})
        if self.command == "POST" and path in GEN_PATHS:
            return self.generate(path, body, key)
        app.cluster.refresh_for_request()
        b, _, _ = app.cluster.pick(None, 0)
        if b is None:
            return self._send(503, {"error": {"type": "server_error", "message": "no Strata node available"}})
        try:
            self.forward(b, body, {})
        except ConnectionError:
            b.up = False
            self._send(502, {"error": {"type": "server_error", "message": f"node {b.name} unreachable"}})
        finally:
            app.cluster.release(b)

    def generate(self, path, body, key):
        app, c = self.app, self.app.cluster
        try:
            req = view = json.loads(body or b"{}")
            vpath = path
            if path == "/v1/responses":                            # 节点原生支持，原样转发；识别会话时按 Chat 形式看
                view, vpath = responses_view(req), "/v1/chat/completions"
            sess = session_key(vpath, view)
            fixed, fixed_est = fixed_part(vpath, view)
        except (ValueError, AttributeError, TypeError):
            req, view, sess, fixed, fixed_est = {}, {}, None, None, 0
        if not isinstance(req, dict):
            req = view = {}
        est = len(body) // 3                                       # 粗估 token 数（JSON 字节数 / 3）
        rec = {"ts": now(), "key_id": key["id"], "key_name": key["name"], "api": GEN_PATHS[path], "path": path,
               "model": req.get("model"), "stream": int(bool(req.get("stream"))), "session": (sess or "")[:12],
               "est_tokens": est, "fixed_tokens": fixed_est, "outcome": "running", "preview": preview(view)}
        rid = app.store.add_request(rec)
        c.refresh_for_request()
        tried, t0 = [], time.time()
        while True:
            b, why, snap = c.pick(sess, est, fixed, fixed_est, exclude=tried)
            if b is None:
                app.store.update_request(rid, {"outcome": "no_node", "status": 503, "reason": why,
                                               "decision": json.dumps(snap, ensure_ascii=False),
                                               "duration_ms": int((time.time() - t0) * 1000)})
                return self._send(503, {"error": {"type": "server_error", "message": "no Strata node available"}})
            app.store.update_request(rid, {"node_id": b.id, "node_name": b.name, "reason": why,
                                           "decision": json.dumps(snap, ensure_ascii=False)})
            log(f"POST {path} -> {b.name} [{why}] sess={(sess or '-')[:8]} ~{est}tok(固定~{fixed_est})")
            out = {}
            try:
                status = self.forward(b, body, out, t0)
                break
            except ConnectionError as e:                           # 还没回给客户端任何内容
                b.up = False
                tried.append(b.id)
                app.event("node_down", b, (f"转发失败：{e}", f"Forwarding failed: {e}"))
                if not c.routing["retry"]:
                    status, out = 502, {"error": str(e)[:500]}
                    self._send(502, {"error": {"type": "server_error", "message": f"node {b.name} unreachable"}})
                    break
            finally:
                c.release(b)
        out["duration_ms"] = int((time.time() - t0) * 1000)
        out["status"] = status
        out.setdefault("outcome", "ok" if status < 400 else "error")
        app.store.update_request(rid, out)

    def forward(self, b, body, out, t0=None):
        """把请求转给节点并把响应直通给客户端；生成请求（t0 不为空）顺带把用量、首字延迟、错误写入 out。"""
        headers = {k: v for k, v in self.headers.items() if k.lower() not in SKIP_HEADERS}
        headers["Authorization"] = f"Bearer {b.key}"
        if body or self.command in ("POST", "PUT", "PATCH"):
            headers["Content-Length"] = str(len(body))
        conn = b.connect(timeout=None)
        try:
            try:
                conn.request(self.command, self.path, body=body or None, headers=headers)
                resp = conn.getresponse()
            except OSError as e:
                raise ConnectionError(str(e)) from e
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() not in SKIP_HEADERS:
                    self.send_header(k, v)
            length = resp.getheader("Content-Length")
            if length is not None:
                self.send_header("Content-Length", length)
            else:
                self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            sse = "event-stream" in (resp.getheader("Content-Type") or "")
            keep, tail = [], b""
            try:
                while True:
                    chunk = resp.read1(65536)
                    if not chunk:
                        break
                    if t0 is not None:
                        if "ttft_ms" not in out and FIRST_TOKEN.search(chunk):
                            out["ttft_ms"] = int((time.time() - t0) * 1000)
                        if sse:                                      # 只解析带 usage 的事件行
                            lines = (tail + chunk).split(b"\n")
                            tail = lines.pop()
                            for ln in lines:
                                if ln.startswith(b"data: ") and b'"usage"' in ln:
                                    try:
                                        read_usage(json.loads(ln[6:]), out)
                                    except ValueError:
                                        pass
                        elif sum(map(len, keep)) < 8 << 20:
                            keep.append(chunk)
                    self.wfile.write(chunk if length is not None else b"%x\r\n%s\r\n" % (len(chunk), chunk))
                if length is None:
                    self.wfile.write(b"0\r\n\r\n")
            except OSError:                                          # 客户端断开：关掉到节点的连接，让 Strata 停止生成
                self.close_connection = True
                out["outcome"] = "client_closed"
                return resp.status
            if keep:
                try:
                    obj = json.loads(b"".join(keep))
                    read_usage(obj, out)
                    if resp.status >= 400:
                        out["error"] = str((obj.get("error") or {}).get("message") or obj)[:500]
                except (ValueError, AttributeError):
                    if resp.status >= 400:
                        out["error"] = b"".join(keep)[:500].decode("utf-8", "replace")
            return resp.status
        finally:
            conn.close()

    def static(self, path):
        """控制台静态文件（web/dist）；/admin 重定向到 /admin/，未知路径回落到 index.html。"""
        if path == "/admin":
            self.send_response(302)
            self.send_header("Location", "/admin/")
            self.send_header("Content-Length", "0")
            return self.end_headers()
        f = os.path.realpath(os.path.join(WEB_DIR, path[len("/admin/"):] or "index.html"))
        if not f.startswith(WEB_DIR + os.sep) or not os.path.isfile(f):
            f = os.path.join(WEB_DIR, "index.html")
        if not os.path.isfile(f):
            return self._send(404, {"error": {"message": "console not built"}})
        with open(f, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(f)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache" if f.endswith(".html") else "max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(data)


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def ensure_admin(cluster):
    """首次启动生成管理员初始密码，写入同目录 initial-admin-password.txt（仅本人可读）。"""
    if cluster.cfg["admin"].get("password_hash"):
        return
    pw = secrets.token_urlsafe(9)
    cluster.cfg["admin"]["password_hash"] = hash_password(pw)
    cluster.save()
    p = os.path.join(os.path.dirname(cluster.path), "initial-admin-password.txt")
    with open(p, "w", encoding="utf-8") as f:
        f.write(pw + "\n")
    os.chmod(p, 0o600)
    log(f"管理员初始密码已写入 {p}")


def start(cluster, store, host, port):
    """启动服务与后台线程，返回 (server, stop_event)。测试也用它。"""
    app = App(cluster, store)
    Handler.app = app
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    stop = threading.Event()
    threading.Thread(target=cluster.health_loop, args=(stop,), daemon=True).start()

    def janitor():
        while not stop.wait(3600):
            store.cleanup(cluster.cfg["system"]["log_retention_days"])

    threading.Thread(target=janitor, daemon=True).start()
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, stop


def main():
    path = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "config.json"))
    cluster = Cluster(path)
    cluster.save()                                                   # 旧格式配置迁移后写回
    ensure_admin(cluster)
    store = Store(os.path.join(os.path.dirname(path), "data.db"))
    start(cluster, store, cluster.cfg["listen"], int(cluster.cfg["port"]))
    log(f"strata-router on {cluster.cfg['listen']}:{cluster.cfg['port']}, nodes={[b.name for b in cluster.backends]}")
    threading.Event().wait()


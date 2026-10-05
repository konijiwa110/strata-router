"""SQLite 存储：请求日志、事件、管理员登录会话。"""
import json
import re
import sqlite3
import threading
import time

REQ_FIELDS = ("ts", "key_id", "key_name", "api", "path", "model", "stream", "session", "node_id", "node_name", "reason",
              "est_tokens", "fixed_tokens", "prompt_tokens", "cached_tokens", "output_tokens", "ttft_ms",
              "duration_ms", "status", "outcome", "error", "decision", "preview", "client")

SCHEMA = """
CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY, ts REAL, key_id TEXT, key_name TEXT, api TEXT, path TEXT, model TEXT, stream INT,
  session TEXT, node_id TEXT, node_name TEXT, reason TEXT, est_tokens INT, fixed_tokens INT, prompt_tokens INT,
  cached_tokens INT, output_tokens INT, ttft_ms INT, duration_ms INT, status INT, outcome TEXT, error TEXT,
  decision TEXT, preview TEXT, client TEXT);
CREATE INDEX IF NOT EXISTS req_ts ON requests(ts);
CREATE INDEX IF NOT EXISTS req_node ON requests(node_id, ts);
CREATE INDEX IF NOT EXISTS req_key ON requests(key_id, ts);
CREATE INDEX IF NOT EXISTS req_session ON requests(session);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts REAL, type TEXT, node_id TEXT, node_name TEXT, message TEXT,
                                  message_en TEXT);
CREATE INDEX IF NOT EXISTS ev_ts ON events(ts);
CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY, expires REAL);
"""


def day_start(t=None):
    lt = time.localtime(t or time.time())
    return time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))


# 旧事件（加英文列之前写入的）按已知格式补英文；认不出的保持为空，界面显示中文
EVENT_EN = [(re.compile(p), en) for p, en in (
    (r"^节点(?:恢复在线|上线)$", "Node back online"),
    (r"^节点离线：(.*)$", r"Node offline: \1"),
    (r"^转发失败：(.*)$", r"Forwarding failed: \1"),
    (r"^启用$", "Enabled"), (r"^排空$", "Draining"), (r"^停用$", "Disabled"),
    (r"^添加节点 (.*)$", r"Added node \1"),
    (r"^删除节点 (.*)$", r"Removed node \1"),
    (r"^修改节点设置$", "Node settings changed"),
    (r"^新建访问密钥 (.*)$", r"Created access key \1"),
    (r"^启用访问密钥 (.*)$", r"Enabled access key \1"),
    (r"^停用访问密钥 (.*)$", r"Disabled access key \1"),
    (r"^删除访问密钥 (.*)$", r"Removed access key \1"),
    (r"^修改设置$", "Settings changed"),
    (r"^修改管理员密码$", "Admin password changed"),
    (r"^清理 (\d+) 天前的日志 (\d+) 条$", r"Deleted \2 log records older than \1 days"),
)]


def event_en(message):
    for p, en in EVENT_EN:
        if p.match(message or ""):
            return p.sub(en, message)
    return None


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.executescript(SCHEMA)
            if "message_en" not in [r[1] for r in self.db.execute("PRAGMA table_info(events)")]:   # 旧库补列
                self.db.execute("ALTER TABLE events ADD COLUMN message_en TEXT")
            if "client" not in [r[1] for r in self.db.execute("PRAGMA table_info(requests)")]:
                self.db.execute("ALTER TABLE requests ADD COLUMN client TEXT")
            rows = self.db.execute("SELECT id, message FROM events WHERE message_en IS NULL").fetchall()
            fill = [(event_en(msg), rid) for rid, msg in rows if event_en(msg)]
            if fill:                                         # 一个事务里写完，避免逐条提交拖慢启动
                self.db.execute("BEGIN")
                self.db.executemany("UPDATE events SET message_en=? WHERE id=?", fill)
                self.db.execute("COMMIT")

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def x(self, sql, args=()):
        with self.lock:
            cur = self.db.execute(sql, args)
            return cur.lastrowid, cur.rowcount

    # ---- 请求 ----
    def add_request(self, rec):
        cols = [k for k in REQ_FIELDS if k in rec]
        rid, _ = self.x(f"INSERT INTO requests({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                        [rec[k] for k in cols])
        return rid

    def update_request(self, rid, rec):
        cols = [k for k in REQ_FIELDS if k in rec]
        if cols:
            self.x(f"UPDATE requests SET {','.join(c + '=?' for c in cols)} WHERE id=?", [rec[k] for k in cols] + [rid])

    def list_requests(self, since=None, node=None, key=None, outcome=None, reason=None, session=None, q=None,
                      limit=50, offset=0):
        where, args = [], []
        for col, val in (("node_id", node), ("key_id", key), ("outcome", outcome), ("session", session)):
            if val:
                where.append(f"{col}=?")
                args.append(val)
        if since:
            where.append("ts>=?")
            args.append(since)
        if reason:
            where.append("reason LIKE ?")
            args.append(reason + "%")
        if q:
            where.append("(preview LIKE ? OR error LIKE ?)")
            args += [f"%{q}%", f"%{q}%"]
        w = ("WHERE " + " AND ".join(where)) if where else ""
        total = self.q(f"SELECT COUNT(*) n FROM requests {w}", args)[0]["n"]
        rows = self.q(f"SELECT id,ts,key_name,api,model,stream,session,node_id,node_name,reason,est_tokens,"
                      f"prompt_tokens,cached_tokens,output_tokens,ttft_ms,duration_ms,status,outcome,error,preview,client "
                      f"FROM requests {w} ORDER BY id DESC LIMIT ? OFFSET ?", args + [limit, offset])
        return rows, total

    def get_request(self, rid):
        rows = self.q("SELECT * FROM requests WHERE id=?", (rid,))
        if not rows:
            return None
        r = rows[0]
        r["decision"] = json.loads(r["decision"]) if r["decision"] else []
        return r

    def totals(self, since, group=None):
        """since 之后的汇总；group 为 node_id / key_id 时按其分组返回字典。"""
        cols = ("COUNT(*) requests, COALESCE(SUM(prompt_tokens),0) prompt_tokens, "
                "COALESCE(SUM(cached_tokens),0) cached_tokens, COALESCE(SUM(output_tokens),0) output_tokens, "
                "SUM(outcome='error') errors, MAX(ts) last_ts")
        if group:
            rows = self.q(f"SELECT {group} g, {cols} FROM requests WHERE ts>=? GROUP BY {group}", (since,))
            return {r.pop("g"): r for r in rows}
        return self.q(f"SELECT {cols} FROM requests WHERE ts>=?", (since,))[0]

    def series(self, minutes=60, bucket_s=60):
        start = (int(time.time()) // bucket_s - minutes + 1) * bucket_s
        rows = self.q("SELECT CAST(ts/? AS INT)*? b, COUNT(*) n, COALESCE(SUM(output_tokens),0) out "
                      "FROM requests WHERE ts>=? GROUP BY b", (bucket_s, bucket_s, start))
        m = {r["b"]: r for r in rows}
        return [{"t": start + i * bucket_s, "requests": m.get(start + i * bucket_s, {}).get("n", 0),
                 "output_tokens": m.get(start + i * bucket_s, {}).get("out", 0)} for i in range(minutes)]

    def cleanup(self, days):
        cut = time.time() - days * 86400
        _, n = self.x("DELETE FROM requests WHERE ts<?", (cut,))
        self.x("DELETE FROM events WHERE ts<?", (cut,))
        self.x("DELETE FROM admin_sessions WHERE expires<?", (time.time(),))
        return n

    # ---- 事件 ----
    def add_event(self, typ, node_id=None, node_name=None, message="", message_en=None):
        self.x("INSERT INTO events(ts,type,node_id,node_name,message,message_en) VALUES(?,?,?,?,?,?)",
               (time.time(), typ, node_id, node_name, message, message_en))

    def events(self, limit=30):
        return self.q("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))

    # ---- 管理员会话 ----
    def add_session(self, token_hash, expires):
        self.x("INSERT INTO admin_sessions VALUES(?,?)", (token_hash, expires))

    def session_valid(self, token_hash):
        return bool(self.q("SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires>?", (token_hash, time.time())))

    def drop_session(self, token_hash):
        self.x("DELETE FROM admin_sessions WHERE token_hash=?", (token_hash,))

    def drop_all_sessions(self):
        self.x("DELETE FROM admin_sessions")

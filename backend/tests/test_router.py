"""用本地模拟 Strata 测试入口：在 backend 目录下运行 python3 -m unittest discover tests -v"""
import http.client
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from strata_router import router
from strata_router.core import Cluster, hash_key, hash_password
from strata_router.store import Store

KEY, NODE_KEY, ADMIN_PW = "client-key-1", "node-key", "admin-pass-1"


class FakeStrata:
    """一次只处理一个生成请求；生成时逐段流式返回自己的名字，并带 Anthropic 风格用量。"""

    def __init__(self, name, delay=0.6):
        self.name, self.delay, self.lock, self.busy, self.waiting, self.served = name, delay, threading.Lock(), False, 0, []
        self.chats = []
        fake = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def reply(self, obj, code=200):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/health":
                    return self.reply({"service": "strata", "model": "m-" + fake.name, "max_context": 1000})
                if self.headers.get("Authorization") != f"Bearer {NODE_KEY}":
                    return self.reply({"error": "key"}, 401)
                if self.path == "/metrics":
                    return self.reply({"engine": {"version": "9.9", "max_context": 1000},
                                       "hardware_static": {"gpu_name": "GPU-" + fake.name}, "hardware": {"gpu_util": 5},
                                       "history": {"tok_s": [1, 2]}, "requests": []})
                self.reply({"busy": fake.busy, "queued": fake.waiting, "phase": "answering" if fake.busy else None})

            def chat(self, req):
                """OpenAI 风格：先思考、再回答自己的名字；请求带工具时再调用一次工具。"""
                fake.chats.append(req)
                usage = {"prompt_tokens": 50, "completion_tokens": 7, "total_tokens": 57,
                         "prompt_tokens_details": {"cached_tokens": 20}}
                calls = [{"index": 0, "id": "call_1", "type": "function",
                          "function": {"name": "get_weather", "arguments": '{"city": "SZ"}'}}] if req.get("tools") else []
                finish = "tool_calls" if calls else "stop"
                if not req.get("stream"):
                    msg = {"role": "assistant", "content": fake.name, "reasoning_content": "hmm"}
                    if calls:
                        msg["tool_calls"] = [{k: v for k, v in c.items() if k != "index"} for c in calls]
                    return self.reply({"id": "chatcmpl-1", "object": "chat.completion", "created": 1, "model": "m",
                                       "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                                       "usage": usage})
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                deltas = [{"role": "assistant", "content": ""}, {"reasoning_content": "hm"}, {"reasoning_content": "m"},
                          {"content": fake.name}, {"content": "!"}]
                if calls:
                    c = calls[0]
                    deltas += [{"tool_calls": [{**c, "function": {"name": "get_weather", "arguments": ""}}]},
                               {"tool_calls": [{"index": 0, "function": {"arguments": '{"city": '}}]},
                               {"tool_calls": [{"index": 0, "function": {"arguments": '"SZ"}'}}]}]
                for i, d in enumerate(deltas):
                    self.wfile.write(b"data: " + json.dumps({"choices": [{"index": 0, "delta": d, "finish_reason": None}]}).encode() + b"\n\n")
                    if i == 0:                              # 空内容块之后隔一会儿才出第一个字
                        self.wfile.flush()
                        time.sleep(fake.delay)
                self.wfile.write(b"data: " + json.dumps({"choices": [{"index": 0, "delta": {}, "finish_reason": finish}],
                                                          "usage": usage}).encode() + b"\n\ndata: [DONE]\n\n")
                self.close_connection = True

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                assert self.headers["Authorization"] == f"Bearer {NODE_KEY}"
                if req.get("fail"):
                    return self.reply({"error": {"message": "boom"}}, 400)
                if self.path == "/v1/chat/completions":
                    return self.chat(req)
                fake.waiting += 1
                with fake.lock:
                    fake.waiting -= 1
                    fake.busy = True
                    fake.served.append(req["messages"][0]["content"])
                    if not req.get("stream"):
                        time.sleep(fake.delay)
                        fake.busy = False
                        return self.reply({"content": [{"type": "text", "text": f"data: {fake.name}"}],
                                           "usage": {"input_tokens": 30, "cache_read_input_tokens": 70,
                                                     "output_tokens": 5}})
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()                      # 不带长度：http.server 用关闭连接结束
                    self.wfile.write(b'data: {"type": "message_start", "message": {"usage": {"input_tokens": 100}}}\n\n')
                    for i in range(3):
                        self.wfile.write(f'data: {fake.name} {i} "content_block_delta"\n\n'.encode())
                        self.wfile.flush()
                        time.sleep(fake.delay / 3)
                    self.wfile.write(b'data: {"type": "message_delta", "usage": {"input_tokens": 40, '
                                     b'"cache_read_input_tokens": 60, "output_tokens": 3}}\n\n')
                    fake.busy = False
                self.close_connection = True

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Base(unittest.TestCase):
    nodes = ("A", "B")

    def setUp(self):
        self.fakes = {n: FakeStrata(n) for n in self.nodes}
        self.dir = tempfile.mkdtemp()
        self.start_cluster([(n, f.url) for n, f in self.fakes.items()])

    def start_cluster(self, backends, **routing):
        cfg = {"routing": {"reroute_max_tokens": 100, **routing},
               "health": {"interval_s": 0.2, "timeout_s": 1, "fail_threshold": 1, "metrics_interval_s": 0.5},
               "admin": {"password_hash": hash_password(ADMIN_PW)},
               "keys": [{"id": "k1", "name": "默认", "hash": hash_key(KEY), "hint": "x", "enabled": True}],
               "backends": [{"id": f"id-{n}", "name": n, "url": u, "api_key": NODE_KEY} for n, u in backends]}
        self.cfg_path = os.path.join(self.dir, "config.json")
        with open(self.cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f)
        self.cluster = Cluster(self.cfg_path)
        self.store = Store(os.path.join(self.dir, f"data-{time.time()}.db"))
        self.srv, self.stop = router.start(self.cluster, self.store, "127.0.0.1", 0)
        self.port = self.srv.server_address[1]
        self.cluster.refresh(metrics=True)
        self.addCleanup(self.stop.set)
        self.addCleanup(self.srv.shutdown)

    def http(self, method, path, obj=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        c.request(method, path, body=json.dumps(obj) if obj is not None else None, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        try:
            return r.status, json.loads(data)
        except ValueError:
            return r.status, data

    def ask(self, first, pad=0, key=KEY, out=None, system="s", stream=True, **extra):
        """发一个会话请求；first 决定会话指纹，pad 加长对话部分。返回 (状态码, 回答节点名, 首字节耗时)。"""
        body = json.dumps({"system": system, "stream": stream, **extra,
                           "messages": [{"role": "user", "content": first}, {"role": "assistant", "content": "x" * pad}]})
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        t0 = time.time()
        c.request("POST", "/v1/messages", body=body, headers={"x-api-key": key, "Content-Type": "application/json"})
        r = c.getresponse()
        first_byte = r.read1(64)
        t1 = time.time() - t0
        text = (first_byte + r.read()).decode()
        c.close()
        node = ""
        if r.status == 200:
            node = text.split("data: ", 2)[2][:1] if stream else json.loads(text)["content"][0]["text"][-1:]
        res = (r.status, node, t1)
        if out is not None:
            out.append(res)
        return res

    def bg(self, *args, **kw):
        out = []
        t = threading.Thread(target=self.ask, args=args, kwargs={**kw, "out": out})
        t.start()
        time.sleep(0.15)
        return t, out

    def login(self):
        code, res = self.http("POST", "/api/admin/login", {"password": ADMIN_PW})
        self.assertEqual(code, 200)
        return {"Authorization": f"Bearer {res['token']}"}

    def wait_done(self):
        for _ in range(50):
            rows, _ = self.store.list_requests()
            if rows and all(r["outcome"] != "running" for r in rows):
                return rows
            time.sleep(0.05)
        self.fail("request still running")

    def other(self, home):
        return "A" if home == "B" else "B"


class RoutingTest(Base):
    def test_auth(self):
        self.assertEqual(self.ask("q", key="bad")[0], 401)

    def test_concurrent_new_sessions_spread(self):
        t1, o1 = self.bg("s1")
        t2, o2 = self.bg("s2")
        t1.join(), t2.join()
        self.assertNotEqual(o1[0][1], o2[0][1])

    def test_sticky_followup(self):
        home = self.ask("s1")[1]
        self.ask("other")
        for _ in range(2):
            self.assertEqual(self.ask("s1")[1], home)

    def test_short_session_moves_when_home_busy(self):
        home = self.ask("s1")[1]
        self.ask("blocker")
        self.fakes[home].delay = 2.0
        t, _ = self.bg("s1")
        moved = self.ask("s1")
        t.join()
        self.assertEqual(moved[1], self.other(home))

    def test_long_session_waits_for_home(self):
        home = self.ask("s1", pad=600)[1]
        self.fakes[home].delay = 1.0
        t, _ = self.bg("s1", pad=600)
        res = self.ask("s1", pad=600)
        t.join()
        self.assertEqual(res[1], home)

    def occupy_home_then_ask(self, system):
        home = self.ask("s1", system=system)[1]
        self.fakes[home].delay = 1.5
        t, _ = self.bg("s1", system=system)
        res = self.ask("s1", system=system)
        t.join()
        return home, res[1]

    def test_fixed_prefix_excluded_when_other_has_it(self):
        big = "S" * 900                                  # 固定前缀约 300 token，超过阈值 100
        self.ask("s1", system=big)
        self.ask("s2", system=big)                       # 另一台也处理过同样的系统提示
        self.cluster.sessions.clear()
        home, went = self.occupy_home_then_ask(big)
        self.assertNotEqual(went, home)

    def test_fixed_prefix_counted_when_other_lacks_it(self):
        home, went = self.occupy_home_then_ask("S" * 900)
        self.assertEqual(went, home)

    def test_streaming_not_buffered(self):
        for f in self.fakes.values():
            f.delay = 1.5
        self.assertLess(self.ask("s1")[2], 0.8)

    def test_down_node_skipped(self):
        self.start_cluster([("dead", f"http://127.0.0.1:{free_port()}"), ("B", self.fakes["B"].url)])
        for q in ("s1", "s2", "s3"):
            self.assertEqual(self.ask(q)[1], "B")

    def test_draining_keeps_sessions_but_takes_no_new(self):
        home = self.ask("s1")[1]
        self.cluster.node(f"id-{home}").mode = "draining"
        self.assertEqual(self.ask("s1")[1], home)        # 已有会话照常回来
        for q in ("n1", "n2", "n3"):
            self.assertEqual(self.ask(q)[1], self.other(home))

    def test_disabled_takes_nothing(self):
        home = self.ask("s1")[1]
        self.cluster.node(f"id-{home}").mode = "disabled"
        self.assertEqual(self.ask("s1")[1], self.other(home))

    def test_sticky_off_setting(self):
        h = self.login()
        self.assertEqual(self.http("PUT", "/api/admin/settings", {"routing": {"sticky": False}}, h)[0], 200)
        got = {self.ask("s1")[1] for _ in range(4)}
        self.assertEqual(got, {"A", "B"})               # 不粘性：同一会话按平均分配轮到两台


class LogTest(Base):
    def test_stream_usage_and_ttft(self):
        self.ask("hello there")
        r = self.wait_done()[0]
        self.assertEqual((r["prompt_tokens"], r["cached_tokens"], r["output_tokens"]), (100, 60, 3))
        self.assertEqual((r["outcome"], r["status"], r["reason"], r["key_name"]), ("ok", 200, "idle", "默认"))
        self.assertEqual(r["preview"], "hello there")
        self.assertIsNotNone(r["ttft_ms"])

    def test_chat_stream_ttft_skips_empty_chunk(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        c.request("POST", "/v1/chat/completions", headers={"Authorization": f"Bearer {KEY}"},
                  body=json.dumps({"stream": True, "messages": [{"role": "user", "content": "q"}]}))
        c.getresponse().read()
        c.close()
        r = self.wait_done()[0]
        self.assertGreaterEqual(r["ttft_ms"], 500)

    def test_nonstream_usage(self):
        self.ask("q", stream=False)
        r = self.wait_done()[0]
        self.assertEqual((r["prompt_tokens"], r["cached_tokens"], r["output_tokens"]), (100, 70, 5))

    def test_error_recorded(self):
        code, _, _ = self.ask("q", stream=False, fail=True)
        self.assertEqual(code, 400)
        r = self.wait_done()[0]
        self.assertEqual((r["outcome"], r["status"], r["error"]), ("error", 400, "boom"))

    def test_request_api_filters_and_detail(self):
        h = self.login()
        self.ask("a1")
        self.ask("b1")
        self.wait_done()
        code, res = self.http("GET", "/api/admin/requests?hours=1&node=id-A", headers=h)
        self.assertEqual(code, 200)
        self.assertTrue(res["total"] >= 1 and all(r["node_id"] == "id-A" for r in res["rows"]))
        code, d = self.http("GET", f"/api/admin/requests/{res['rows'][0]['id']}", headers=h)
        self.assertEqual(code, 200)
        self.assertEqual({x["name"] for x in d["decision"]}, {"A", "B"})


class AdminTest(Base):
    def test_login_required_and_wrong_password(self):
        self.assertEqual(self.http("GET", "/api/admin/overview")[0], 401)
        self.assertEqual(self.http("GET", "/api/admin/overview", headers={"Authorization": f"Bearer {KEY}"})[0], 401)
        self.assertEqual(self.http("POST", "/api/admin/login", {"password": "nope"})[0], 401)

    def test_overview(self):
        h = self.login()
        self.ask("x")
        code, o = self.http("GET", "/api/admin/overview", headers=h)
        self.assertEqual(code, 200)
        self.assertEqual((o["cluster"]["nodes"], o["cluster"]["online"]), (2, 2))
        self.assertEqual(len(o["series"]), 60)
        self.assertEqual(o["nodes"][0]["info"]["gpu"], "GPU-A")
        self.assertNotIn(NODE_KEY, json.dumps(o))       # 不外泄节点密钥

    def test_node_lifecycle(self):
        h = self.login()
        c = FakeStrata("C")
        code, res = self.http("POST", "/api/admin/nodes/test", {"url": c.url, "api_key": "wrong"}, h)
        self.assertEqual((code, res["error"]["message"]), (400, "节点密钥不正确"))
        code, res = self.http("POST", "/api/admin/nodes/test", {"url": f"http://127.0.0.1:{free_port()}"}, h)
        self.assertEqual(code, 400)
        code, res = self.http("POST", "/api/admin/nodes/test", {"url": c.url, "api_key": NODE_KEY}, h)
        self.assertEqual((code, res["model"], res["gpu"]), (200, "m-C", "GPU-C"))
        code, n = self.http("POST", "/api/admin/nodes", {"url": c.url, "api_key": NODE_KEY, "weight": 3}, h)
        self.assertEqual((code, n["name"], n["weight"]), (200, f"127.0.0.1:{c.port}", 3))
        self.assertEqual(self.http("POST", "/api/admin/nodes", {"url": c.url, "api_key": NODE_KEY}, h)[0], 409)
        code, n = self.http("PATCH", f"/api/admin/nodes/{n['id']}", {"name": "C", "mode": "draining"}, h)
        self.assertEqual((code, n["name"], n["mode"]), (200, "C", "draining"))
        with open(self.cfg_path, encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual([b["name"] for b in saved["backends"]], ["A", "B", "C"])
        code, d = self.http("GET", f"/api/admin/nodes/{n['id']}", headers=h)
        self.assertEqual((code, d["metrics"]["engine"]["version"]), (200, "9.9"))
        self.assertEqual(self.http("DELETE", f"/api/admin/nodes/{n['id']}", headers=h)[0], 200)
        self.assertEqual(len(self.cluster.backends), 2)
        types = [e["type"] for e in self.store.events()]
        self.assertTrue({"node_added", "node_mode", "node_removed"} <= set(types))

    def test_keys(self):
        h = self.login()
        code, k = self.http("POST", "/api/admin/keys", {"name": "笔记本"}, h)
        self.assertEqual(code, 200)
        self.assertTrue(k["key"].startswith("sk-"))
        self.assertEqual(self.ask("q", key=k["key"])[0], 200)
        code, keys = self.http("GET", "/api/admin/keys", headers=h)
        self.assertNotIn("hash", json.dumps(keys))
        self.http("PATCH", f"/api/admin/keys/{k['id']}", {"enabled": False}, h)
        self.assertEqual(self.ask("q", key=k["key"])[0], 401)
        self.assertEqual(self.http("DELETE", f"/api/admin/keys/{k['id']}", headers=h)[0], 200)

    def test_settings_validation_and_password(self):
        h = self.login()
        self.assertEqual(self.http("PUT", "/api/admin/settings", {"routing": {"strategy": "nope"}}, h)[0], 400)
        code, s = self.http("PUT", "/api/admin/settings", {"routing": {"strategy": "least_load"}}, h)
        self.assertEqual((code, self.cluster.routing["strategy"]), (200, "least_load"))
        self.assertEqual(self.http("POST", "/api/admin/password", {"old": "x", "new": "newpass99"}, h)[0], 403)
        code, res = self.http("POST", "/api/admin/password", {"old": ADMIN_PW, "new": "newpass99"}, h)
        self.assertEqual(code, 200)
        self.assertEqual(self.http("GET", "/api/admin/me", headers=h)[0], 401)       # 旧登录失效
        self.assertEqual(self.http("GET", "/api/admin/me", headers={"Authorization": f"Bearer {res['token']}"})[0], 200)


class MigrateTest(unittest.TestCase):
    def test_old_config(self):
        c = Cluster(cfg={"api_key": "old-key-123", "strategy": "random", "reroute_max_tokens": 5,
                         "backends": [{"name": "j", "url": "http://h:1", "api_key": "n"}]})
        self.assertEqual(c.routing["strategy"], "random")
        self.assertEqual(c.routing["reroute_max_tokens"], 5)
        self.assertEqual(c.check_key("old-key-123")["name"], "默认")
        self.assertEqual(c.backends[0].mode, "enabled")


if __name__ == "__main__":
    unittest.main()


class ResponsesTest(Base):
    nodes = ("A",)

    def post(self, obj):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        c.request("POST", "/v1/responses", body=json.dumps(obj), headers={"Authorization": f"Bearer {KEY}"})
        r = c.getresponse()
        data = r.read().decode()
        c.close()
        return r.status, data

    def events(self, text):
        return [json.loads(b.split("data: ", 1)[1]) for b in text.split("\n\n") if "data: " in b]

    def test_request_converted(self):
        tools = [{"type": "function", "name": "get_weather", "parameters": {"type": "object"}}, {"type": "web_search"}]
        self.post({"model": "m", "instructions": "be brief", "max_output_tokens": 99, "reasoning": {"effort": "xhigh"},
                   "tools": tools, "tool_choice": {"type": "function", "name": "get_weather"},
                   "text": {"format": {"type": "json_schema", "name": "x", "schema": {"type": "object"}}},
                   "input": [{"role": "developer", "content": "dev"},
                             {"role": "user", "content": [{"type": "input_text", "text": "hi"}]},
                             {"role": "assistant", "content": [{"type": "output_text", "text": "let me check"}]},
                             {"type": "function_call", "call_id": "c1", "name": "get_weather", "arguments": "{}"},
                             {"type": "reasoning", "summary": []},
                             {"type": "function_call_output", "call_id": "c1", "output": "sunny"}]})
        req = self.fakes["A"].chats[0]
        self.assertEqual(req["messages"], [
            {"role": "system", "content": "be brief"}, {"role": "system", "content": "dev"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "let me check", "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "sunny"}])
        self.assertEqual((req["max_tokens"], req["reasoning_effort"], req["stream"]), (99, "high", False))
        self.assertEqual(req["tools"], [{"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object"}}}])
        self.assertEqual(req["tool_choice"], {"type": "function", "function": {"name": "get_weather"}})
        self.assertEqual(req["response_format"]["json_schema"]["name"], "x")

    def test_nonstream(self):
        code, data = self.post({"model": "m", "input": "hi", "tools": [{"type": "function", "name": "get_weather"}]})
        self.assertEqual(code, 200)
        r = json.loads(data)
        self.assertEqual((r["object"], r["status"]), ("response", "completed"))
        self.assertEqual([o["type"] for o in r["output"]], ["reasoning", "message", "function_call"])
        self.assertEqual(r["output"][1]["content"][0]["text"], "A")
        self.assertEqual((r["output"][2]["call_id"], r["output"][2]["arguments"]), ("call_1", '{"city": "SZ"}'))
        self.assertEqual((r["usage"]["input_tokens"], r["usage"]["output_tokens"],
                          r["usage"]["input_tokens_details"]["cached_tokens"]), (50, 7, 20))
        rec = self.wait_done()[0]
        self.assertEqual((rec["api"], rec["prompt_tokens"], rec["output_tokens"], rec["preview"]),
                         ("responses", 50, 7, "hi"))

    def test_stream(self):
        code, data = self.post({"model": "m", "input": "hi", "stream": True,
                                "tools": [{"type": "function", "name": "get_weather"}]})
        self.assertEqual(code, 200)
        evs = self.events(data)
        self.assertEqual([e["sequence_number"] for e in evs], list(range(len(evs))))
        types = [e["type"] for e in evs]
        self.assertEqual(types[:2], ["response.created", "response.in_progress"])
        self.assertEqual(types[-1], "response.completed")
        self.assertEqual("".join(e["delta"] for e in evs if e["type"] == "response.output_text.delta"), "A!")
        self.assertEqual("".join(e["delta"] for e in evs if e["type"] == "response.reasoning_summary_text.delta"), "hmm")
        self.assertEqual("".join(e["delta"] for e in evs if e["type"] == "response.function_call_arguments.delta"),
                         '{"city": "SZ"}')
        self.assertEqual(types.count("response.output_item.added"), 3)
        self.assertEqual(types.count("response.output_item.done"), 3)
        done = evs[-1]["response"]
        self.assertEqual([o["type"] for o in done["output"]], ["reasoning", "message", "function_call"])
        self.assertEqual(done["output"][1]["content"][0]["text"], "A!")
        self.assertEqual(done["usage"]["output_tokens"], 7)
        rec = self.wait_done()[0]
        self.assertEqual((rec["outcome"], rec["prompt_tokens"], rec["cached_tokens"]), ("ok", 50, 20))
        self.assertIsNotNone(rec["ttft_ms"])

    def test_previous_response_id_rejected(self):
        code, _ = self.post({"model": "m", "input": "hi", "previous_response_id": "resp_x"})
        self.assertEqual(code, 400)


class I18nTest(Base):
    nodes = ("A",)

    def test_admin_error_follows_lang(self):
        self.assertEqual(self.http("POST", "/api/admin/login", {"password": "nope"})[1]["error"]["message"], "密码不正确")
        code, res = self.http("POST", "/api/admin/login", {"password": "nope"}, {"X-Lang": "en"})
        self.assertEqual((code, res["error"]["message"]), (401, "Wrong password"))

    def test_event_stored_in_both_languages(self):
        h = self.login()
        self.http("POST", "/api/admin/keys", {"name": "ci"}, h)
        e = self.store.events()[0]
        self.assertEqual((e["type"], e["message"], e["message_en"]), ("key_added", "新建访问密钥 ci", "Created access key ci"))

    def test_old_events_table_gets_column(self):
        import sqlite3
        path = os.path.join(self.dir, "old.db")
        db = sqlite3.connect(path)
        db.execute("CREATE TABLE events(id INTEGER PRIMARY KEY, ts REAL, type TEXT, node_id TEXT, node_name TEXT, message TEXT)")
        db.execute("INSERT INTO events(ts, type, message) VALUES(1, 'x', '旧事件')")
        db.commit()
        db.close()
        s = Store(path)
        s.add_event("y", message="新", message_en="new")
        self.assertEqual([(e["message"], e["message_en"]) for e in s.events()], [("新", "new"), ("旧事件", None)])

    def test_reading_progress_in_summary(self):
        self.stop.set()                                     # 停掉健康检查，免得它覆盖下面手动设置的状态
        time.sleep(0.5)
        b = self.cluster.backends[0]
        b.busy, b.detail = True, {"phase": "reading the prompt"}
        b.metrics = {"live": {"state": "reading", "prompt_read": 40, "prompt_total": 100}}
        live = b.summary()["live"]
        self.assertEqual((live["prompt_read"], live["prompt_total"]), (40, 100))
        b.metrics = {"live": {"state": "generating", "prompt_read": None, "prompt_total": None}}
        self.assertNotIn("prompt_read", b.summary()["live"])

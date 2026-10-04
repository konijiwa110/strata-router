"""OpenAI Responses 接口（/v1/responses）与 Chat Completions 互转：节点只支持 Chat，
入口把 Responses 请求转成 Chat 发给节点，再把结果（含流式事件）转回 Responses 格式。
字段映射参考 new-api 的 apicompat（它做的是反方向）。"""
import copy
import json
import time
import uuid

EFFORT = {"minimal": "low", "xhigh": "high"}               # 节点只认 none / low / medium / high


def _id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


def _content(c):
    """Responses 的内容片段 -> Chat 内容：全是文字时拼成字符串，含图片时给片段列表。"""
    if not isinstance(c, list):
        return c if c is not None else ""
    parts = []
    for p in c:
        if not isinstance(p, dict):
            continue
        t = p.get("type")
        if t in ("input_text", "output_text", "text"):
            parts.append({"type": "text", "text": p.get("text") or ""})
        elif t == "refusal":
            parts.append({"type": "text", "text": p.get("refusal") or ""})
        elif t == "input_image" and p.get("image_url"):
            parts.append({"type": "image_url", "image_url": {"url": p["image_url"]}})
    if all(p["type"] == "text" for p in parts):
        return "".join(p["text"] for p in parts)
    return parts


def to_chat(req):
    """Responses 请求 -> Chat 请求。不支持的内容抛 ValueError。"""
    if req.get("previous_response_id"):
        raise ValueError("previous_response_id is not supported; send the full conversation in input")
    msgs = []
    if req.get("instructions"):
        msgs.append({"role": "system", "content": req["instructions"]})
    inp = req.get("input")
    if isinstance(inp, str):
        inp = [{"role": "user", "content": inp}]
    for it in inp or []:
        if not isinstance(it, dict):
            continue
        t = it.get("type") or "message"
        if t == "message":
            role = it.get("role") or "user"
            msgs.append({"role": "system" if role == "developer" else role, "content": _content(it.get("content"))})
        elif t == "function_call":                          # 连续的调用并进同一条 assistant 消息
            call = {"id": it.get("call_id") or it.get("id"), "type": "function",
                    "function": {"name": it.get("name"), "arguments": it.get("arguments") or "{}"}}
            if msgs and msgs[-1]["role"] == "assistant":
                msgs[-1].setdefault("tool_calls", []).append(call)
            else:
                msgs.append({"role": "assistant", "content": "", "tool_calls": [call]})
        elif t == "function_call_output":
            out = it.get("output")
            if not isinstance(out, str):
                out = _content(out) if isinstance(out, list) else json.dumps(out, ensure_ascii=False)
            msgs.append({"role": "tool", "tool_call_id": it.get("call_id"), "content": out})
        # reasoning 等其他条目节点用不上，跳过
    chat = {"model": req.get("model"), "messages": msgs, "stream": bool(req.get("stream"))}
    for k in ("temperature", "top_p", "parallel_tool_calls", "user"):
        if k in req:
            chat[k] = req[k]
    if req.get("max_output_tokens"):
        chat["max_tokens"] = req["max_output_tokens"]
    effort = (req.get("reasoning") or {}).get("effort")
    if effort:
        chat["reasoning_effort"] = EFFORT.get(effort, effort)
    tools = [{"type": "function", "function": {k: t[k] for k in ("name", "description", "parameters", "strict") if k in t}}
             for t in req.get("tools") or [] if isinstance(t, dict) and t.get("type") == "function"]
    if tools:
        chat["tools"] = tools
    tc = req.get("tool_choice")
    if isinstance(tc, dict) and tc.get("type") == "function":
        tc = {"type": "function", "function": {"name": tc.get("name")}}
    if isinstance(tc, str) or (tc and tools):
        chat["tool_choice"] = tc
    fmt = (req.get("text") or {}).get("format") or {}
    if fmt.get("type") == "json_schema":
        chat["response_format"] = {"type": "json_schema", "json_schema": {
            k: fmt[k] for k in ("name", "description", "schema", "strict") if k in fmt}}
    elif fmt.get("type") == "json_object":
        chat["response_format"] = {"type": "json_object"}
    return chat


# ---- 结果转换 ----
def _base(req, model, created, status):
    return {"id": _id("resp"), "object": "response", "created_at": created, "status": status, "model": model,
            "output": [], "error": None, "incomplete_details": None, "instructions": req.get("instructions"),
            "max_output_tokens": req.get("max_output_tokens"), "parallel_tool_calls": req.get("parallel_tool_calls", True),
            "temperature": req.get("temperature"), "top_p": req.get("top_p"), "tool_choice": req.get("tool_choice", "auto"),
            "tools": req.get("tools") or [], "text": req.get("text") or {"format": {"type": "text"}},
            "reasoning": req.get("reasoning"), "store": False, "metadata": req.get("metadata") or {}, "usage": None}


def _usage(u):
    if not isinstance(u, dict):
        return None
    pt, ct = u.get("prompt_tokens") or 0, u.get("completion_tokens") or 0
    return {"input_tokens": pt,
            "input_tokens_details": {"cached_tokens": (u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0},
            "output_tokens": ct, "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": pt + ct}


def _finish(resp, finish, usage):
    resp["status"] = "incomplete" if finish == "length" else "completed"
    if finish == "length":
        resp["incomplete_details"] = {"reason": "max_output_tokens"}
    resp["usage"] = _usage(usage)


def _reasoning(text):
    return {"type": "reasoning", "id": _id("rs"), "summary": [{"type": "summary_text", "text": text}]}


def _message(text):
    return {"type": "message", "id": _id("msg"), "status": "completed", "role": "assistant",
            "content": [{"type": "output_text", "text": text, "annotations": []}]}


def _call(call_id, name, args):
    return {"type": "function_call", "id": _id("fc"), "call_id": call_id or _id("call"), "name": name,
            "arguments": args or "", "status": "completed"}


def from_chat(obj, req):
    """非流式 Chat 结果 -> Responses 结果。"""
    ch = (obj.get("choices") or [{}])[0]
    m = ch.get("message") or {}
    resp = _base(req, obj.get("model") or req.get("model"), obj.get("created") or int(time.time()), "completed")
    if m.get("reasoning_content"):
        resp["output"].append(_reasoning(m["reasoning_content"]))
    text = _content(m.get("content"))
    if text:
        resp["output"].append(_message(text if isinstance(text, str) else json.dumps(text, ensure_ascii=False)))
    for c in m.get("tool_calls") or []:
        f = c.get("function") or {}
        resp["output"].append(_call(c.get("id"), f.get("name"), f.get("arguments")))
    _finish(resp, ch.get("finish_reason"), obj.get("usage"))
    return resp


DELTA = {"reasoning": "response.reasoning_summary_text.delta", "message": "response.output_text.delta",
         "call": "response.function_call_arguments.delta"}


class Stream:
    """流式 Chat 分块 -> Responses 事件。每次 feed 一个分块，返回要发给客户端的事件列表；结束时调 finish。"""

    def __init__(self, req):
        self.req, self.seq, self.cur, self.calls = req, 0, None, {}
        self.finish_reason, self.usage, self.done = None, None, False
        self.resp = _base(req, req.get("model"), int(time.time()), "in_progress")

    def ev(self, typ, **kw):
        self.seq += 1
        return {"type": typ, "sequence_number": self.seq - 1, **copy.deepcopy(kw)}

    def start(self):
        return [self.ev("response.created", response=self.resp), self.ev("response.in_progress", response=self.resp)]

    def _open(self, kind, key=None, name=None, call_id=None):
        if self.cur and self.cur["key"] == (kind, key):
            return []
        out = self._close()
        idx = len(self.resp["output"])
        if kind == "reasoning":
            item = {"type": "reasoning", "id": _id("rs"), "summary": []}
        elif kind == "message":
            item = {"type": "message", "id": _id("msg"), "status": "in_progress", "role": "assistant", "content": []}
        else:
            item = {"type": "function_call", "id": _id("fc"), "call_id": call_id or _id("call"), "name": name,
                    "arguments": "", "status": "in_progress"}
        self.resp["output"].append(item)
        self.cur = {"key": (kind, key), "item": item, "idx": idx, "text": ""}
        out.append(self.ev("response.output_item.added", output_index=idx, item=item))
        if kind == "reasoning":
            out.append(self.ev("response.reasoning_summary_part.added", item_id=item["id"], output_index=idx,
                               summary_index=0, part={"type": "summary_text", "text": ""}))
        elif kind == "message":
            out.append(self.ev("response.content_part.added", item_id=item["id"], output_index=idx, content_index=0,
                               part={"type": "output_text", "text": "", "annotations": []}))
        return out

    def _delta(self, text):
        c = self.cur
        c["text"] += text
        kind = c["key"][0]
        extra = {"reasoning": {"summary_index": 0}, "message": {"content_index": 0}, "call": {}}[kind]
        return [self.ev(DELTA[kind], item_id=c["item"]["id"], output_index=c["idx"], delta=text, **extra)]

    def _close(self):
        c, self.cur = self.cur, None
        if not c:
            return []
        item, text, kind = c["item"], c["text"], c["key"][0]
        at = {"item_id": item["id"], "output_index": c["idx"]}
        if kind == "reasoning":
            part = {"type": "summary_text", "text": text}
            item["summary"] = [part]
            out = [self.ev("response.reasoning_summary_text.done", **at, summary_index=0, text=text),
                   self.ev("response.reasoning_summary_part.done", **at, summary_index=0, part=part)]
        elif kind == "message":
            part = {"type": "output_text", "text": text, "annotations": []}
            item["content"], item["status"] = [part], "completed"
            out = [self.ev("response.output_text.done", **at, content_index=0, text=text),
                   self.ev("response.content_part.done", **at, content_index=0, part=part)]
        else:
            item["arguments"], item["status"] = text, "completed"
            out = [self.ev("response.function_call_arguments.done", **at, arguments=text)]
        return out + [self.ev("response.output_item.done", output_index=c["idx"], item=item)]

    def feed(self, obj):
        if self.done:
            return []
        if obj.get("error"):
            e = obj["error"]
            return self.fail(e.get("message") if isinstance(e, dict) else str(e))
        out = []
        for ch in obj.get("choices") or []:
            d = ch.get("delta") or {}
            if d.get("reasoning_content"):
                out += self._open("reasoning") + self._delta(d["reasoning_content"])
            if d.get("content"):
                out += self._open("message") + self._delta(d["content"])
            for tc in d.get("tool_calls") or []:
                i, f = tc.get("index", 0), tc.get("function") or {}
                cid, name = self.calls.setdefault(i, (tc.get("id"), f.get("name")))
                out += self._open("call", i, name, cid)
                if f.get("arguments"):
                    out += self._delta(f["arguments"])
            if ch.get("finish_reason"):
                self.finish_reason = ch["finish_reason"]
        if obj.get("usage"):
            self.usage = obj["usage"]
        return out

    def fail(self, message):
        if self.done:
            return []
        self.done = True
        out = self._close()
        self.resp["status"] = "failed"
        self.resp["error"] = {"code": "server_error", "message": message}
        return out + [self.ev("response.failed", response=self.resp)]

    def finish(self):
        if self.done:
            return []
        if self.finish_reason is None:
            return self.fail("upstream stream ended unexpectedly")
        self.done = True
        out = self._close()
        _finish(self.resp, self.finish_reason, self.usage)
        typ = "response.incomplete" if self.resp["status"] == "incomplete" else "response.completed"
        return out + [self.ev(typ, response=self.resp)]

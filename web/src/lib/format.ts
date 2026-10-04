import type { NodeMode, NodeState } from "./types"

export const num = (n?: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("zh-CN"))

export function tokens(n?: number | null) {
  if (n == null) return "—"
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
  return String(Math.round(n))
}

export const gb = (bytes?: number | null) => (bytes == null ? "—" : (bytes / 1024 ** 3).toFixed(1))

export function ms(v?: number | null) {
  if (v == null) return "—"
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`
}

export const pct = (v?: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`)

const pad = (n: number) => String(n).padStart(2, "0")

export function clock(ts?: number | null) {
  if (!ts) return "—"
  const d = new Date(ts * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function dateTime(ts?: number | null) {
  if (!ts) return "—"
  const d = new Date(ts * 1000)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? clock(ts) : `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ago(ts?: number | null) {
  if (!ts) return "从未"
  const s = Date.now() / 1000 - ts
  if (s < 5) return "刚刚"
  if (s < 60) return `${Math.round(s)} 秒前`
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`
  return `${Math.round(s / 86400)} 天前`
}

export const STATE: Record<NodeState, { label: string; tone: Tone }> = {
  idle: { label: "空闲", tone: "muted" },
  reading: { label: "读取中", tone: "info" },
  generating: { label: "生成中", tone: "brand" },
  queued: { label: "排队", tone: "warn" },
  offline: { label: "离线", tone: "danger" },
}

export const MODE: Record<NodeMode, { label: string; tone: Tone }> = {
  enabled: { label: "启用", tone: "brand" },
  draining: { label: "排空中", tone: "warn" },
  disabled: { label: "已停用", tone: "muted" },
}

export const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  running: { label: "进行中", tone: "info" },
  ok: { label: "成功", tone: "brand" },
  error: { label: "失败", tone: "danger" },
  client_closed: { label: "客户端断开", tone: "warn" },
  no_node: { label: "无可用节点", tone: "danger" },
}

export const REASON: Record<string, string> = {
  sticky: "回到原节点",
  "sticky-wait": "等待原节点",
  "sticky-allbusy": "原节点（均忙）",
  moved: "换到空闲节点",
  idle: "空闲节点",
  allbusy: "均忙，按策略",
  "fallback-draining": "仅剩排空节点",
  "no-node": "无可用节点",
}

export const STRATEGY: Record<string, { label: string; desc: string }> = {
  even: { label: "平均分配", desc: "新会话分给累计分配次数最少的节点" },
  least_load: { label: "按负载", desc: "新会话分给当前在途与排队最少的节点" },
  random: { label: "随机", desc: "在候选节点中随机选择" },
  weighted: { label: "按权重", desc: "按节点权重比例分配新会话" },
}

const PHASE: Record<string, string> = {
  "reading the prompt": "读取提示",
  thinking: "思考中",
  answering: "回答中",
  "tool call complete": "工具调用完成",
}

export const phase = (p?: string | null) =>
  !p ? "—" : p.startsWith("writing a tool call") ? "调用工具" : (PHASE[p] ?? p)

export type Tone = "brand" | "info" | "warn" | "danger" | "muted"

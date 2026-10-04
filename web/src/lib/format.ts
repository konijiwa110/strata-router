import { getLang, t } from "./i18n"
import type { NodeMode, NodeState } from "./types"

export const num = (n?: number | null) => (n == null ? "—" : Math.round(n).toLocaleString(getLang() === "en" ? "en-US" : "zh-CN"))

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
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sameDay ? clock(ts) : t(`${d.getMonth() + 1}月${d.getDate()}日 ${hm}`, `${d.getMonth() + 1}/${d.getDate()} ${hm}`)
}

export function ago(ts?: number | null) {
  if (!ts) return t("从未", "never")
  const s = Date.now() / 1000 - ts
  if (s < 5) return t("刚刚", "just now")
  if (s < 60) return t(`${Math.round(s)} 秒前`, `${Math.round(s)}s ago`)
  if (s < 3600) return t(`${Math.round(s / 60)} 分钟前`, `${Math.round(s / 60)}m ago`)
  if (s < 86400) return t(`${Math.round(s / 3600)} 小时前`, `${Math.round(s / 3600)}h ago`)
  return t(`${Math.round(s / 86400)} 天前`, `${Math.round(s / 86400)}d ago`)
}

/** 文字随语言变化：用 getter 在读取时取当前语言 */
const L = (zh: string, en: string, tone: Tone) => ({ get label() { return t(zh, en) }, tone })
const tr = <T extends Record<string, [string, string]>>(m: T) =>
  new Proxy(m, { get: (o, k: string) => (o[k] ? t(o[k][0], o[k][1]) : undefined) }) as unknown as Record<keyof T, string>

export const STATE: Record<NodeState, { label: string; tone: Tone }> = {
  idle: L("空闲", "Idle", "muted"),
  reading: L("读取中", "Reading", "info"),
  generating: L("生成中", "Generating", "brand"),
  queued: L("排队", "Queued", "warn"),
  offline: L("离线", "Offline", "danger"),
}

export const MODE: Record<NodeMode, { label: string; tone: Tone }> = {
  enabled: L("启用", "Enabled", "brand"),
  draining: L("排空中", "Draining", "warn"),
  disabled: L("已停用", "Disabled", "muted"),
}

export const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  running: L("进行中", "Running", "info"),
  ok: L("成功", "OK", "brand"),
  error: L("失败", "Failed", "danger"),
  client_closed: L("客户端断开", "Client closed", "warn"),
  no_node: L("无可用节点", "No node", "danger"),
}

export const REASON: Record<string, string> = tr({
  sticky: ["回到原节点", "Back to home node"],
  "sticky-wait": ["等待原节点", "Waiting for home node"],
  "sticky-allbusy": ["原节点（均忙）", "Home node (all busy)"],
  moved: ["换到空闲节点", "Moved to idle node"],
  idle: ["空闲节点", "Idle node"],
  allbusy: ["均忙，按策略", "All busy, by strategy"],
  "fallback-draining": ["仅剩排空节点", "Only draining nodes left"],
  "no-node": ["无可用节点", "No node available"],
})

const S = (zh: [string, string], en: [string, string]) => ({
  get label() { return t(zh[0], en[0]) },
  get desc() { return t(zh[1], en[1]) },
})

export const STRATEGY: Record<string, { label: string; desc: string }> = {
  even: S(["平均分配", "新会话分给累计分配次数最少的节点"], ["Even", "New sessions go to the node with the fewest assignments"]),
  least_load: S(["按负载", "新会话分给当前在途与排队最少的节点"], ["Least load", "New sessions go to the node with the fewest in-flight and queued requests"]),
  random: S(["随机", "在候选节点中随机选择"], ["Random", "Pick a random candidate node"]),
  weighted: S(["按权重", "按节点权重比例分配新会话"], ["Weighted", "Assign new sessions in proportion to node weights"]),
}

const PHASE = tr({
  "reading the prompt": ["读取提示", "Reading prompt"],
  thinking: ["思考中", "Thinking"],
  answering: ["回答中", "Answering"],
  "tool call complete": ["工具调用完成", "Tool call done"],
})

export const phase = (p?: string | null) =>
  !p ? "—" : p.startsWith("writing a tool call") ? t("调用工具", "Calling tool") : ((PHASE as Record<string, string>)[p] ?? p)

export type Tone = "brand" | "info" | "warn" | "danger" | "muted"

/** 事件文字：英文界面优先用后端给的英文版（旧事件没有英文时用中文） */
export const eventText = (e: { message: string; message_en?: string | null }) =>
  getLang() === "en" && e.message_en ? e.message_en : e.message

/** 读取提示的进度（0～1）；不在读取或节点没给进度时为 null */
export const readFrac = (state: string, live: { prompt_read?: number | null; prompt_total?: number | null }) =>
  state === "reading" && live.prompt_total ? Math.min(1, (live.prompt_read ?? 0) / live.prompt_total) : null

/** 节点连接错误：401 显示为密钥不正确，其余原样 */
export const nodeError = (e?: string | null) => (e === "HTTP 401" ? t("节点密钥不正确", "Invalid node key") : e)

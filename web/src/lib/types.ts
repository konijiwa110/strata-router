export type NodeState = "idle" | "reading" | "generating" | "queued" | "offline"
export type NodeMode = "enabled" | "draining" | "disabled"

export type Totals = { requests: number; output_tokens: number; errors?: number; prompt_tokens?: number; cached_tokens?: number; last_ts?: number | null }

export type NodeSummary = {
  id: string
  name: string
  url: string
  mode: NodeMode
  weight: number
  tags: string[]
  up: boolean
  state: NodeState
  busy: boolean
  queued: number
  inflight: number
  served: number
  last_seen: number | null
  last_error: string
  key_hint: string
  info: { model?: string; version?: string; context?: number; gpu?: string; cpu?: string }
  live: { phase?: string | null; prompt_tokens?: number | null; generated?: number | null; max_tokens?: number | null; elapsed_s?: number | null; tokens_per_s?: number | null }
  hw: { gpu_util?: number; gpu_mem_used?: number; gpu_mem_total?: number; gpu_temp?: number; gpu_power?: number; cpu?: number; ram_used?: number; ram_total?: number }
  spark: { tok_s: number[]; gpu_util: number[]; gpu_mem_used: number[] }
  today: Totals
  total: Totals
}

export type StrataRequest = {
  time: number
  duration_s: number
  finish: string
  prompt_tokens: number
  reused: number
  output_tokens: number
  decode_tok_s: number
  hit_rate: number
}

export type NodeMetrics = {
  engine: Record<string, string | number | boolean | null>
  live: Record<string, number | string | null>
  hardware: Record<string, number>
  hardware_static: { gpu_name?: string; gpu_count?: number; cpu_name?: string; cores?: number; threads?: number }
  history: Record<string, number[]>
  requests: StrataRequest[]
  totals: Record<string, number>
}

export type NodeDetail = NodeSummary & { metrics: NodeMetrics | null; metrics_at: number; recent: RequestRow[] }

export type RequestRow = {
  id: number
  ts: number
  key_name: string
  api: "openai" | "anthropic"
  model: string | null
  stream: number
  session: string
  node_id: string | null
  node_name: string | null
  reason: string | null
  est_tokens: number
  prompt_tokens: number | null
  cached_tokens: number | null
  output_tokens: number | null
  ttft_ms: number | null
  duration_ms: number | null
  status: number | null
  outcome: string
  error: string | null
  preview: string
}

export type Decision = { id: string; name: string; mode: NodeMode; up: boolean; busy: boolean; queued: number; inflight: number; cost: number; home: boolean }

export type RequestDetail = RequestRow & { key_id: string; path: string; fixed_tokens: number; decision: Decision[] }

export type ClusterEvent = { id: number; ts: number; type: string; node_id: string | null; node_name: string | null; message: string }

export type Overview = {
  cluster: { nodes: number; online: number; generating: number; queued: number; tok_s: number; sessions: number }
  today: Totals & { hit_rate: number | null }
  nodes: NodeSummary[]
  series: { t: number; requests: number; output_tokens: number }[]
  events: ClusterEvent[]
  recent: RequestRow[]
}

export type AccessKey = { id: string; name: string; hint: string; enabled: boolean; created: number; today: Totals; total: Totals; key?: string }

export type Settings = {
  routing: { strategy: string; sticky: boolean; reroute_max_tokens: number; exclude_fixed: boolean; retry: boolean }
  health: { interval_s: number; timeout_s: number; fail_threshold: number; metrics_interval_s: number }
  system: { log_retention_days: number; session_hours: number }
  listen: string
  port: number
  restart_required?: boolean
}

export type Probe = { model?: string; context?: number; version?: string; gpu?: string; gpu_count?: number; cpu?: string; images?: boolean; loaded?: boolean }

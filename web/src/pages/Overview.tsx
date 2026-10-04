import { useState } from "react"
import { motion } from "framer-motion"
import { ArrowRight, Cpu, Gauge as GaugeIcon, MessagesSquare, Plus, Server, Zap } from "lucide-react"

import { NodeDetailSheet } from "@/pages/NodeDetail"
import { CardTitle, Empty, Metric, Pill, Progress, Sparkline, StCard, StTable, StatePill } from "@/components/st"
import { Button } from "@/components/ui/button"
import { usePoll } from "@/hooks/usePoll"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { MODE, OUTCOME, REASON, clock, gb, ms, num, pct, phase, tokens } from "@/lib/format"
import type { NodeSummary, Overview as OverviewData } from "@/lib/types"

export function NodeTile({ n, onClick }: { n: NodeSummary; onClick: () => void }) {
  const live = n.live
  const active = n.state === "generating" || n.state === "reading"
  const progress = live.max_tokens ? ((live.generated ?? 0) / live.max_tokens) * 100 : 0
  const memPct = n.hw.gpu_mem_total ? (n.hw.gpu_mem_used ?? 0) / n.hw.gpu_mem_total : null
  return (
    <motion.button
      layout
      onClick={onClick}
      whileHover={{ y: -2 }}
      className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5 text-left shadow-card transition-shadow hover:shadow-pop"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-ink">{n.name}</div>
          <div className="truncate text-xs text-ink-muted">{n.info.gpu ?? n.url}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {n.mode !== "enabled" && <Pill tone={MODE[n.mode].tone}>{MODE[n.mode].label}</Pill>}
          <StatePill state={n.state} />
        </div>
      </div>
      <div className="w-full space-y-2">
        <div className="flex justify-between text-[13px] text-ink-muted">
          <span>{active ? phase(live.phase) : n.up ? "等待请求" : n.last_error || "无法连接"}</span>
          {active && live.prompt_tokens != null && <span className="tabular">提示 {tokens(live.prompt_tokens)} · 生成 {num(live.generated)}</span>}
        </div>
        <Progress
          value={active ? progress : 0}
          indeterminate={n.state === "reading"}
          tone={n.state === "reading" ? "info" : "brand"}
        />
      </div>
      <div className="grid w-full grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-ink-muted">速度</div>
          <div className="tabular text-lg font-black text-ink">
            {active && live.tokens_per_s ? live.tokens_per_s : "—"}
            <span className="ml-0.5 text-xs font-medium text-ink-muted">t/s</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-muted">GPU</div>
          <div className="tabular text-lg font-black text-ink">
            {n.hw.gpu_util ?? "—"}
            <span className="ml-0.5 text-xs font-medium text-ink-muted">%</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-muted">显存</div>
          <div className="tabular text-lg font-black text-ink">
            {gb(n.hw.gpu_mem_used)}
            <span className="ml-0.5 text-xs font-medium text-ink-muted">/ {gb(n.hw.gpu_mem_total)} GB</span>
          </div>
        </div>
      </div>
      <div className="w-full">
        <Sparkline data={n.spark.tok_s} height={28} />
      </div>
      <div className="flex w-full justify-between text-xs text-ink-muted">
        <span>今日 {num(n.today.requests)} 次 · 输出 {tokens(n.today.output_tokens)}</span>
        <span>{memPct != null ? `显存 ${pct(memPct)}` : ""}</span>
      </div>
    </motion.button>
  )
}

function Throughput({ series }: { series: OverviewData["series"] }) {
  const max = Math.max(...series.map((s) => s.output_tokens), 1)
  const total = series.reduce((a, s) => a + s.requests, 0)
  return (
    <StCard className="lg:col-span-2">
      <CardTitle actions={<span className="text-[13px] text-ink-muted">近 1 小时 · {num(total)} 次请求</span>}>输出吞吐</CardTitle>
      <div className="flex h-44 items-end gap-[3px]">
        {series.map((s) => (
          <div key={s.t} className="group relative flex h-full flex-1 items-end">
            <motion.div
              className="w-full rounded-t-[4px] bg-brand/80 group-hover:bg-brand"
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(s.output_tokens ? 4 : 1.5, (s.output_tokens / max) * 100)}%` }}
              transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
              style={{ opacity: s.output_tokens ? 1 : 0.25 }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-pop group-hover:block">
              <div className="font-bold">{clock(s.t).slice(0, 5)}</div>
              <div className="text-ink-muted">{s.requests} 次 · 输出 {tokens(s.output_tokens)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-muted">
        <span>{clock(series[0]?.t).slice(0, 5)}</span>
        <span>现在</span>
      </div>
    </StCard>
  )
}

const EVENT_TONE: Record<string, "brand" | "danger" | "warn" | "info" | "muted"> = {
  node_up: "brand",
  node_down: "danger",
  node_added: "info",
  node_removed: "warn",
  node_mode: "warn",
}

export default function Overview({ onGo }: { onGo: (page: "nodes" | "requests") => void }) {
  const { data, error } = usePoll(() => api<OverviewData>("overview"), 2000)
  const [detail, setDetail] = useState<string | null>(null)

  if (!data) return <div className="py-20 text-center text-ink-muted">{error || "加载中…"}</div>
  const { cluster, today } = data
  const speedSpark = data.nodes.length
    ? data.nodes[0].spark.tok_s.map((_, i) => data.nodes.reduce((a, n) => a + (n.spark.tok_s[i] ?? 0), 0))
    : []

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={<Server />}
          label="在线节点"
          value={cluster.online}
          unit={`/ ${cluster.nodes}`}
          sub={`${cluster.generating} 个工作中 · ${cluster.queued} 个排队`}
          right={cluster.online < cluster.nodes ? <Pill tone="danger">{cluster.nodes - cluster.online} 离线</Pill> : <Pill tone="brand">正常</Pill>}
        />
        <Metric icon={<Zap />} label="集群速度" value={cluster.tok_s || "0"} unit="t/s" sub="正在生成的节点合计" spark={speedSpark} />
        <Metric
          icon={<MessagesSquare />}
          label="今日请求"
          value={num(today.requests)}
          sub={today.errors ? <span className="text-danger-text">失败 {today.errors} 次</span> : `活跃会话 ${cluster.sessions}`}
          spark={data.series.map((s) => s.requests)}
          tone="info"
        />
        <Metric icon={<GaugeIcon />} label="今日输出" value={tokens(today.output_tokens)} unit="tokens" sub={`提示 ${tokens(today.prompt_tokens)} · 缓存命中 ${pct(today.hit_rate)}`} spark={data.series.map((s) => s.output_tokens)} />
      </div>

      <div>
        <CardTitle actions={<Button variant="ghost" size="sm" onClick={() => onGo("nodes")}>管理节点<ArrowRight /></Button>}>节点</CardTitle>
        {data.nodes.length ? (
          <motion.div layout className={cn("grid gap-4 md:grid-cols-2", data.nodes.length % 3 === 1 && data.nodes.length < 3 ? "xl:grid-cols-2" : "xl:grid-cols-3")}>
            {data.nodes.map((n) => <NodeTile key={n.id} n={n} onClick={() => setDetail(n.id)} />)}
            {data.nodes.length % 3 !== 0 && (
              <motion.button
                layout
                onClick={() => onGo("nodes")}
                className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-line text-ink-muted transition-colors hover:border-brand hover:bg-brand-tint/40 hover:text-brand-text"
              >
                <Plus className="size-6" />
                <span className="text-sm font-medium">添加节点</span>
              </motion.button>
            )}
          </motion.div>
        ) : (
          <StCard><Empty icon={<Cpu />} title="还没有节点" action={<Button onClick={() => onGo("nodes")}>添加节点</Button>} /></StCard>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Throughput series={data.series} />
        <StCard>
          <CardTitle>最近事件</CardTitle>
          {data.events.length ? (
            <ul className="space-y-3">
              {data.events.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-start gap-3 text-sm">
                  <span className="tabular mt-0.5 w-16 shrink-0 text-xs text-ink-muted">{clock(e.ts).slice(0, 5)}</span>
                  <Pill tone={EVENT_TONE[e.type] ?? "muted"} className="mt-px">{e.node_name ?? "系统"}</Pill>
                  <span className="min-w-0 flex-1 text-ink-soft">{e.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="暂无事件" />
          )}
        </StCard>
      </div>

      <StCard>
        <CardTitle actions={<Button variant="ghost" size="sm" onClick={() => onGo("requests")}>全部请求<ArrowRight /></Button>}>最近请求</CardTitle>
        {data.recent.length ? (
          <StTable head={[{ label: "时间" }, { label: "节点" }, { label: "路由" }, { label: "内容" }, { label: "输出", num: true }, { label: "耗时", num: true }, { label: "状态" }]}>
            {data.recent.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{clock(r.ts)}</td>
                <td className="whitespace-nowrap font-medium text-ink">{r.node_name ?? "—"}</td>
                <td className="whitespace-nowrap">{REASON[r.reason ?? ""] ?? r.reason ?? "—"}</td>
                <td className="max-w-[360px] truncate text-ink-muted">{r.preview || "—"}</td>
                <td className="text-right">{num(r.output_tokens)}</td>
                <td className="text-right">{ms(r.duration_ms)}</td>
                <td><Pill tone={OUTCOME[r.outcome]?.tone ?? "muted"} pulse={r.outcome === "running"}>{OUTCOME[r.outcome]?.label ?? r.outcome}</Pill></td>
              </tr>
            ))}
          </StTable>
        ) : (
          <Empty icon={<MessagesSquare />} title="还没有请求" />
        )}
      </StCard>

      <NodeDetailSheet nodeId={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

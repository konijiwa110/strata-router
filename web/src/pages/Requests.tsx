import { useState } from "react"
import { ChevronLeft, ChevronRight, ListTree, Search } from "lucide-react"

import { Choice } from "@/components/Choice"
import { CardTitle, Empty, KV, PageHeader, Pill, Segmented, StCard, StTable, StatePill } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { usePoll } from "@/hooks/usePoll"
import { api } from "@/lib/api"
import { OUTCOME, REASON, dateTime, ms, num, pct, tokens } from "@/lib/format"
import type { AccessKey, NodeSummary, RequestDetail, RequestRow } from "@/lib/types"

const PAGE = 50
const RANGES = [
  { value: "1", label: "1 小时" },
  { value: "24", label: "24 小时" },
  { value: "168", label: "7 天" },
  { value: "720", label: "30 天" },
]

function OutcomePill({ outcome }: { outcome: string }) {
  const o = OUTCOME[outcome]
  return <Pill tone={o?.tone ?? "muted"} pulse={outcome === "running"}>{o?.label ?? outcome}</Pill>
}

function Detail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: r } = usePoll(() => (id ? api<RequestDetail>(`requests/${id}`) : Promise.resolve(null)), 3000, [id])
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-background p-0 data-[side=right]:sm:max-w-[640px]">
        <SheetHeader className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-4">
          <SheetTitle className="flex items-center gap-2.5 text-lg font-black">
            请求 #{id}
            {r && <OutcomePill outcome={r.outcome} />}
          </SheetTitle>
          {r && <div className="text-xs text-ink-muted">{dateTime(r.ts)} · {{ openai: "OpenAI", anthropic: "Anthropic", responses: "Responses" }[r.api]} · {r.stream ? "流式" : "非流式"}</div>}
        </SheetHeader>
        {r && (
          <div className="space-y-5 p-6">
            {r.preview && (
              <StCard>
                <CardTitle>内容</CardTitle>
                <p className="text-sm leading-relaxed text-ink-soft">{r.preview}</p>
              </StCard>
            )}
            {r.error && (
              <div className="rounded-[14px] bg-danger-tint p-4 text-sm text-danger-text">{r.error}</div>
            )}
            <StCard>
              <CardTitle>概况</CardTitle>
              <div className="grid gap-x-8 sm:grid-cols-2">
                <KV label="节点" value={r.node_name ?? "—"} />
                <KV label="路由" value={REASON[r.reason ?? ""] ?? r.reason ?? "—"} />
                <KV label="密钥" value={r.key_name} />
                <KV label="模型" value={r.model ?? "—"} />
                <KV label="提示" value={num(r.prompt_tokens)} />
                <KV label="缓存命中" value={r.prompt_tokens ? `${num(r.cached_tokens)}（${pct((r.cached_tokens ?? 0) / r.prompt_tokens)}）` : "—"} />
                <KV label="输出" value={num(r.output_tokens)} />
                <KV label="首字" value={ms(r.ttft_ms)} />
                <KV label="耗时" value={ms(r.duration_ms)} />
                <KV label="状态码" value={r.status ?? "—"} />
                <KV label="会话" value={r.session || "—"} mono />
                <KV label="估算" value={`${tokens(r.est_tokens)}（固定 ${tokens(r.fixed_tokens)}）`} />
              </div>
            </StCard>
            <StCard>
              <CardTitle>路由决策</CardTitle>
              <StTable head={[{ label: "节点" }, { label: "当时状态" }, { label: "在途", num: true }, { label: "排队", num: true }, { label: "换入重读", num: true }, { label: "" }]}>
                {r.decision.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium text-ink">{d.name}</td>
                    <td>
                      <StatePill state={!d.up ? "offline" : d.busy || d.inflight ? "generating" : d.queued ? "queued" : "idle"} />
                      {d.mode !== "enabled" && <span className="ml-1.5 text-xs text-ink-muted">{d.mode === "draining" ? "排空中" : "已停用"}</span>}
                    </td>
                    <td className="text-right">{d.inflight}</td>
                    <td className="text-right">{d.queued}</td>
                    <td className="text-right">{tokens(d.cost)}</td>
                    <td className="space-x-1 text-right whitespace-nowrap">
                      {d.home && <Pill tone="info">原节点</Pill>}
                      {d.id === r.node_id && <Pill tone="brand">选中</Pill>}
                    </td>
                  </tr>
                ))}
              </StTable>
            </StCard>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default function Requests() {
  const [hours, setHours] = useState("24")
  const [node, setNode] = useState("all")
  const [key, setKey] = useState("all")
  const [outcome, setOutcome] = useState("all")
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<number | null>(null)

  const params = new URLSearchParams({ hours, limit: String(PAGE), offset: String(page * PAGE) })
  if (node !== "all") params.set("node", node)
  if (key !== "all") params.set("key", key)
  if (outcome !== "all") params.set("outcome", outcome)
  if (query) params.set("q", query)
  const { data, error } = usePoll(() => api<{ rows: RequestRow[]; total: number }>(`requests?${params}`), page === 0 ? 3000 : 60000, [params.toString()])
  const { data: nodes } = usePoll(() => api<NodeSummary[]>("nodes"), 30000)
  const { data: keys } = usePoll(() => api<AccessKey[]>("keys"), 30000)
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0) }
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1

  return (
    <div>
      <PageHeader title="请求">{data && <Pill tone="muted">{num(data.total)} 条</Pill>}</PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented options={RANGES} value={hours} onChange={reset(setHours)} size="sm" />
        <Choice value={node} onChange={reset(setNode)} options={[{ value: "all", label: "全部节点" }, ...(nodes ?? []).map((n) => ({ value: n.id, label: n.name }))]} />
        <Choice value={key} onChange={reset(setKey)} options={[{ value: "all", label: "全部密钥" }, ...(keys ?? []).map((k) => ({ value: k.id, label: k.name }))]} />
        <Choice value={outcome} onChange={reset(setOutcome)} options={[{ value: "all", label: "全部状态" }, ...Object.entries(OUTCOME).map(([v, o]) => ({ value: v, label: o.label }))]} />
        <form
          className="relative ml-auto"
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(q.trim())
            setPage(0)
          }}
        >
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索内容或错误" className="h-9 w-64 rounded-[10px] bg-surface pl-9" />
        </form>
      </div>

      <StCard className="p-2">
        {!data ? (
          <div className="py-16 text-center text-ink-muted">{error || "加载中…"}</div>
        ) : data.rows.length === 0 ? (
          <Empty icon={<ListTree />} title="没有符合条件的请求" />
        ) : (
          <StTable
            head={[
              { label: "时间" }, { label: "密钥" }, { label: "节点" }, { label: "路由" }, { label: "内容" },
              { label: "提示", num: true }, { label: "命中", num: true }, { label: "输出", num: true }, { label: "首字", num: true }, { label: "耗时", num: true }, { label: "状态" },
            ]}
          >
            {data.rows.map((r) => (
              <tr key={r.id} className="cursor-pointer" onClick={() => setDetail(r.id)}>
                <td className="whitespace-nowrap">{dateTime(r.ts)}</td>
                <td className="whitespace-nowrap">{r.key_name}</td>
                <td className="whitespace-nowrap font-medium text-ink">{r.node_name ?? "—"}</td>
                <td className="whitespace-nowrap">{REASON[r.reason ?? ""] ?? r.reason ?? "—"}</td>
                <td className="max-w-[280px] truncate text-ink-muted">{r.error && r.outcome !== "ok" ? <span className="text-danger-text">{r.error}</span> : r.preview || "—"}</td>
                <td className="text-right">{tokens(r.prompt_tokens)}</td>
                <td className="text-right">{r.prompt_tokens ? pct((r.cached_tokens ?? 0) / r.prompt_tokens) : "—"}</td>
                <td className="text-right">{num(r.output_tokens)}</td>
                <td className="text-right">{ms(r.ttft_ms)}</td>
                <td className="text-right">{ms(r.duration_ms)}</td>
                <td><OutcomePill outcome={r.outcome} /></td>
              </tr>
            ))}
          </StTable>
        )}
      </StCard>

      {data && data.total > PAGE && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-ink-muted">
          <span className="tabular">第 {page + 1} / {pages} 页</span>
          <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="上一页"><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="下一页"><ChevronRight /></Button>
        </div>
      )}

      <Detail id={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

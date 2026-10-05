import { useState } from "react"
import { ChevronLeft, ChevronRight, ListTree, Search } from "lucide-react"

import { Choice } from "@/components/Choice"
import { CardTitle, Empty, KV, PageHeader, Pill, Segmented, StCard, StTable, StatePill } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { usePoll } from "@/hooks/usePoll"
import { api } from "@/lib/api"
import { OUTCOME, REASON, clientName, dateTime, ms, num, pct, tokens } from "@/lib/format"
import { t } from "@/lib/i18n"
import type { AccessKey, NodeSummary, RequestDetail, RequestRow } from "@/lib/types"

const PAGE = 50
const R = (value: string, zh: string, en: string) => ({ value, get label() { return t(zh, en) } })
const RANGES = [R("1", "1 小时", "1 h"), R("24", "24 小时", "24 h"), R("168", "7 天", "7 d"), R("720", "30 天", "30 d")]

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
            {t("请求", "Request")} #{id}
            {r && <OutcomePill outcome={r.outcome} />}
          </SheetTitle>
          {r && <div className="text-xs text-ink-muted">{dateTime(r.ts)} · {{ openai: "OpenAI", anthropic: "Anthropic", responses: "Responses" }[r.api]} · {r.stream ? t("流式", "Streaming") : t("非流式", "Non-streaming")}</div>}
        </SheetHeader>
        {r && (
          <div className="space-y-5 p-6">
            {r.preview && (
              <StCard>
                <CardTitle>{t("内容", "Content")}</CardTitle>
                <p className="text-sm leading-relaxed text-ink-soft">{r.preview}</p>
              </StCard>
            )}
            {r.error && (
              <div className="rounded-[14px] bg-danger-tint p-4 text-sm text-danger-text">{r.error}</div>
            )}
            <StCard>
              <CardTitle>{t("概况", "Summary")}</CardTitle>
              <div className="grid gap-x-8 sm:grid-cols-2">
                <KV label={t("节点", "Node")} value={r.node_name ?? "—"} />
                <KV label={t("路由", "Route")} value={REASON[r.reason ?? ""] ?? r.reason ?? "—"} />
                <KV label={t("密钥", "Key")} value={r.key_name} />
                <KV label={t("客户端", "Client")} value={r.client || "—"} mono />
                <KV label={t("模型", "Model")} value={r.model ?? "—"} />
                <KV label={t("提示", "Prompt")} value={num(r.prompt_tokens)} />
                <KV label={t("缓存命中", "Cache hit")} value={r.prompt_tokens ? t(`${num(r.cached_tokens)}（${pct((r.cached_tokens ?? 0) / r.prompt_tokens)}）`, `${num(r.cached_tokens)} (${pct((r.cached_tokens ?? 0) / r.prompt_tokens)})`) : "—"} />
                <KV label={t("输出", "Output")} value={num(r.output_tokens)} />
                <KV label={t("首字", "TTFT")} value={ms(r.ttft_ms)} />
                <KV label={t("耗时", "Duration")} value={ms(r.duration_ms)} />
                <KV label={t("状态码", "Status code")} value={r.status ?? "—"} />
                <KV label={t("会话", "Session")} value={r.session || "—"} mono />
                <KV label={t("估算", "Estimate")} value={t(`${tokens(r.est_tokens)}（固定 ${tokens(r.fixed_tokens)}）`, `${tokens(r.est_tokens)} (fixed ${tokens(r.fixed_tokens)})`)} />
              </div>
            </StCard>
            <StCard>
              <CardTitle>{t("路由决策", "Routing decision")}</CardTitle>
              <StTable head={[{ label: t("节点", "Node") }, { label: t("当时状态", "State then") }, { label: t("在途", "In flight"), num: true }, { label: t("排队", "Queued"), num: true }, { label: t("换入重读", "Re-read cost"), num: true }, { label: "" }]}>
                {r.decision.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium text-ink">{d.name}</td>
                    <td>
                      <StatePill state={!d.up ? "offline" : d.busy || d.inflight ? "generating" : d.queued ? "queued" : "idle"} />
                      {d.mode !== "enabled" && <span className="ml-1.5 text-xs text-ink-muted">{d.mode === "draining" ? t("排空中", "Draining") : t("已停用", "Disabled")}</span>}
                    </td>
                    <td className="text-right">{d.inflight}</td>
                    <td className="text-right">{d.queued}</td>
                    <td className="text-right">{tokens(d.cost)}</td>
                    <td className="space-x-1 text-right whitespace-nowrap">
                      {d.home && <Pill tone="info">{t("原节点", "Home")}</Pill>}
                      {d.id === r.node_id && <Pill tone="brand">{t("选中", "Chosen")}</Pill>}
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
      <PageHeader title={t("请求", "Requests")}>{data && <Pill tone="muted">{t(`${num(data.total)} 条`, `${num(data.total)} total`)}</Pill>}</PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented options={RANGES} value={hours} onChange={reset(setHours)} size="sm" />
        <Choice value={node} onChange={reset(setNode)} options={[{ value: "all", label: t("全部节点", "All nodes") }, ...(nodes ?? []).map((n) => ({ value: n.id, label: n.name }))]} />
        <Choice value={key} onChange={reset(setKey)} options={[{ value: "all", label: t("全部密钥", "All keys") }, ...(keys ?? []).map((k) => ({ value: k.id, label: k.name }))]} />
        <Choice value={outcome} onChange={reset(setOutcome)} options={[{ value: "all", label: t("全部状态", "All statuses") }, ...Object.entries(OUTCOME).map(([v, o]) => ({ value: v, label: o.label }))]} />
        <form
          className="relative ml-auto"
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(q.trim())
            setPage(0)
          }}
        >
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索内容或错误", "Search content or errors")} className="h-9 w-64 rounded-[10px] bg-surface pl-9" />
        </form>
      </div>

      <StCard className="p-2">
        {!data ? (
          <div className="py-16 text-center text-ink-muted">{error || t("加载中…", "Loading…")}</div>
        ) : data.rows.length === 0 ? (
          <Empty icon={<ListTree />} title={t("没有符合条件的请求", "No matching requests")} />
        ) : (
          <StTable
            head={[
              { label: t("时间", "Time") }, { label: t("密钥", "Key") }, { label: t("节点", "Node") }, { label: t("路由", "Route") }, { label: t("客户端", "Client") }, { label: t("内容", "Content") },
              { label: t("提示", "Prompt"), num: true }, { label: t("命中", "Hit"), num: true }, { label: t("输出", "Output"), num: true }, { label: t("首字", "TTFT"), num: true }, { label: t("耗时", "Duration"), num: true }, { label: t("状态", "Status") },
            ]}
          >
            {data.rows.map((r) => (
              <tr key={r.id} className="cursor-pointer" onClick={() => setDetail(r.id)}>
                <td className="whitespace-nowrap">{dateTime(r.ts)}</td>
                <td className="whitespace-nowrap">{r.key_name}</td>
                <td className="whitespace-nowrap font-medium text-ink">{r.node_name ?? "—"}</td>
                <td className="whitespace-nowrap">{REASON[r.reason ?? ""] ?? r.reason ?? "—"}</td>
                <td className="whitespace-nowrap text-ink-muted" title={r.client ?? undefined}>{clientName(r.client)}</td>
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
          <span className="tabular">{t(`第 ${page + 1} / ${pages} 页`, `Page ${page + 1} / ${pages}`)}</span>
          <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={t("上一页", "Previous page")}><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label={t("下一页", "Next page")}><ChevronRight /></Button>
        </div>
      )}

      <Detail id={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

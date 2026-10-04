import { Cpu, ExternalLink, Gauge as GaugeIcon, HardDrive, Layers, MemoryStick, Plug, Thermometer, Zap } from "lucide-react"

import { CardTitle, Gauge, KV, Metric, Pill, Progress, StCard, StTable, StatePill } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { usePoll } from "@/hooks/usePoll"
import { api } from "@/lib/api"
import { MODE, OUTCOME, REASON, ago, clock, gb, ms, num, pct, phase, tokens } from "@/lib/format"
import type { NodeDetail } from "@/lib/types"

function Body({ id }: { id: string }) {
  const { data: n, error } = usePoll(() => api<NodeDetail>(`nodes/${id}`), 2000, [id])
  if (!n) return <div className="py-20 text-center text-ink-muted">{error || "加载中…"}</div>
  const m = n.metrics
  const hw = m?.hardware ?? {}
  const hist = m?.history ?? {}
  const eng = m?.engine ?? {}
  const live = n.live
  const active = n.state === "generating" || n.state === "reading"
  const ctx = Number(eng.max_context ?? n.info.context ?? 0)
  const used = live.prompt_tokens ?? (m?.requests?.[0]?.prompt_tokens ?? 0)

  return (
    <div className="space-y-5">
      <StCard>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold">
            {active ? "当前请求" : "最近一次请求"}
            {active && <Pill tone={n.state === "reading" ? "info" : "brand"} pulse>{phase(live.phase)}</Pill>}
          </div>
          <span className="tabular text-[13px] text-ink-muted">
            {active ? `已用 ${live.elapsed_s ?? 0} s` : n.up ? `最近心跳 ${ago(n.last_seen)}` : n.last_error}
          </span>
        </div>
        <Progress
          value={active && live.max_tokens ? ((live.generated ?? 0) / live.max_tokens) * 100 : 0}
          indeterminate={n.state === "reading"}
          tone={n.state === "reading" ? "info" : "brand"}
        />
        <div className="tabular mt-2 flex justify-between text-xs text-ink-muted">
          <span>提示 {num(live.prompt_tokens)} · 生成 {num(live.generated)}{active ? ` / ${num(live.max_tokens)}` : ""}</span>
          <span>{active && live.tokens_per_s ? `${live.tokens_per_s} t/s` : ""}</span>
        </div>
      </StCard>

      {m ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={<Zap />} label="速度" value={hw.tok_s ? hw.tok_s.toFixed(1) : "0"} unit="t/s" sub={`prefill ${num(hw.prefill_tok_s_mean)} t/s`} spark={hist.tok_s} />
            <Metric icon={<GaugeIcon />} label="GPU 负载" value={num(hw.gpu_util)} unit="%" spark={hist.gpu_util} sparkMax={100} />
            <Metric icon={<Layers />} label="显存" value={gb(hw.gpu_mem_used)} unit={`/ ${gb(hw.gpu_mem_total)} GB`} sub={`${num(Number(eng.expert_slots))} 个专家槽位`} spark={hist.gpu_mem_used} sparkMax={hw.gpu_mem_total} />
            <Metric icon={<Thermometer />} label="GPU 温度" value={num(hw.gpu_temp)} unit="°C" spark={hist.gpu_temp} tone="warn" sparkMax={100} />
            <Metric icon={<Plug />} label="功耗" value={num(hw.gpu_power)} unit="W" sub={`上限 ${num(hw.gpu_power_limit)} W`} spark={hist.gpu_power} sparkMax={hw.gpu_power_limit} />
            <Metric icon={<Cpu />} label="CPU" value={num(hw.cpu)} unit="%" sub={`${m.hardware_static.cores ?? "—"} 核 · ${m.hardware_static.threads ?? "—"} 线程`} spark={hist.cpu} sparkMax={100} tone="info" />
            <Metric icon={<MemoryStick />} label="内存" value={gb(hw.ram_used)} unit={`/ ${gb(hw.ram_total)} GB`} spark={hist.ram_used} sparkMax={hw.ram_total} tone="info" />
            <Metric icon={<HardDrive />} label="PCIe" value={`Gen${hw.gpu_pcie_gen ?? "—"}`} unit={`x${hw.gpu_pcie_width ?? "—"}`} sub={`到 GPU ${(hw.gpu_pcie_rx_mb ?? 0).toFixed(1)} MB/s`} spark={hist.gpu_pcie_rx_mb} tone="info" />
          </div>

          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            <StCard className="flex flex-col items-center">
              <CardTitle className="self-start">上下文占用</CardTitle>
              <Gauge value={ctx ? used / ctx : 0} label={pct(ctx ? used / ctx : 0)} sub={`${tokens(used)} / ${tokens(ctx)}`} />
            </StCard>
            <StCard>
              <CardTitle>引擎</CardTitle>
              <div className="grid gap-x-8 sm:grid-cols-2">
                <KV label="模型" value={String(eng.model ?? n.info.model ?? "—")} />
                <KV label="版本" value={String(eng.version ?? "—")} />
                <KV label="上下文" value={tokens(ctx)} />
                <KV label="KV 缓存" value={String(eng.kv ?? "—")} />
                <KV label="专家缓存" value={`${num(Number(eng.expert_slots))} 槽 · ${gb(Number(eng.expert_cache_mib) * 1024 ** 2)} GB`} />
                <KV label="会话缓存" value={eng.conversation_cache_mib ? `${gb(Number(eng.conversation_cache_mib) * 1024 ** 2)} GB · ${eng.conversation_cache_slots} 段` : "关闭"} />
                <KV label="GPU" value={m.hardware_static.gpu_name ?? "—"} />
                <KV label="CPU" value={m.hardware_static.cpu_name ?? "—"} />
              </div>
            </StCard>
          </div>

          <StCard>
            <CardTitle actions={<span className="text-[13px] text-ink-muted">节点自身记录</span>}>最近请求</CardTitle>
            <StTable head={[{ label: "时间" }, { label: "提示", num: true }, { label: "复用", num: true }, { label: "输出", num: true }, { label: "速度", num: true }, { label: "命中率", num: true }, { label: "耗时", num: true }]}>
              {(m.requests ?? []).slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td>{clock(r.time)}</td>
                  <td className="text-right">{num(r.prompt_tokens)}</td>
                  <td className="text-right">{num(r.reused)}</td>
                  <td className="text-right">{num(r.output_tokens)}</td>
                  <td className="text-right">{r.decode_tok_s ?? "—"}</td>
                  <td className="text-right">{pct(r.hit_rate)}</td>
                  <td className="text-right">{r.duration_s} s</td>
                </tr>
              ))}
            </StTable>
          </StCard>
        </>
      ) : (
        <StCard><div className="py-8 text-center text-sm text-ink-muted">暂时无法获取节点指标</div></StCard>
      )}

      <StCard>
        <CardTitle actions={<span className="text-[13px] text-ink-muted">经集群入口分配</span>}>路由记录</CardTitle>
        <StTable head={[{ label: "时间" }, { label: "密钥" }, { label: "路由" }, { label: "内容" }, { label: "输出", num: true }, { label: "耗时", num: true }, { label: "状态" }]}>
          {n.recent.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{clock(r.ts)}</td>
              <td className="whitespace-nowrap">{r.key_name}</td>
              <td className="whitespace-nowrap">{REASON[r.reason ?? ""] ?? r.reason}</td>
              <td className="max-w-[240px] truncate text-ink-muted">{r.preview || "—"}</td>
              <td className="text-right">{num(r.output_tokens)}</td>
              <td className="text-right">{ms(r.duration_ms)}</td>
              <td><Pill tone={OUTCOME[r.outcome]?.tone ?? "muted"}>{OUTCOME[r.outcome]?.label ?? r.outcome}</Pill></td>
            </tr>
          ))}
        </StTable>
      </StCard>
    </div>
  )
}

export function NodeDetailSheet({ nodeId, onClose, title }: { nodeId: string | null; onClose: () => void; title?: React.ReactNode }) {
  return (
    <Sheet open={nodeId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-background p-0 data-[side=right]:sm:max-w-[960px]">
        {nodeId && <NodeSheetInner id={nodeId} title={title} />}
      </SheetContent>
    </Sheet>
  )
}

function NodeSheetInner({ id }: { id: string; title?: React.ReactNode }) {
  const { data: n } = usePoll(() => api<NodeDetail>(`nodes/${id}`), 5000, [id])
  return (
    <>
      <SheetHeader className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-4">
        <SheetTitle className="flex flex-wrap items-center gap-2.5 pr-10 text-lg font-black">
          {n?.name ?? "节点"}
          {n && <StatePill state={n.state} />}
          {n && n.mode !== "enabled" && <Pill tone={MODE[n.mode].tone}>{MODE[n.mode].label}</Pill>}
          {n && (
            <Button variant="outline" size="sm" className="ml-auto" render={<a href={n.url} target="_blank" rel="noreferrer" />}>
              节点网页<ExternalLink />
            </Button>
          )}
        </SheetTitle>
        {n && <div className="text-xs text-ink-muted">{n.url} · {n.info.model ?? "—"} · 今日 {num(n.today.requests)} 次</div>}
      </SheetHeader>
      <div className="p-6">
        <Body id={id} />
      </div>
    </>
  )
}

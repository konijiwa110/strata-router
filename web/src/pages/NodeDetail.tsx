import { Cpu, ExternalLink, Gauge as GaugeIcon, HardDrive, Layers, MemoryStick, Plug, Thermometer, Zap } from "lucide-react"

import { CardTitle, Gauge, KV, Metric, Pill, Progress, StCard, StTable, StatePill } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { usePoll } from "@/hooks/usePoll"
import { api } from "@/lib/api"
import { MODE, OUTCOME, REASON, ago, clock, gb, ms, nodeError, num, pct, phase, readFrac, tokens } from "@/lib/format"
import { t } from "@/lib/i18n"
import type { NodeDetail } from "@/lib/types"

function Body({ id }: { id: string }) {
  const { data: n, error } = usePoll(() => api<NodeDetail>(`nodes/${id}`), 2000, [id])
  if (!n) return <div className="py-20 text-center text-ink-muted">{error || t("加载中…", "Loading…")}</div>
  const m = n.metrics
  const hw = m?.hardware ?? {}
  const hist = m?.history ?? {}
  const eng = m?.engine ?? {}
  const live = n.live
  const active = n.state === "generating" || n.state === "reading"
  const ctx = Number(eng.max_context ?? n.info.context ?? 0)
  const used = live.prompt_tokens ?? (m?.requests?.[0]?.prompt_tokens ?? 0)
  const read = readFrac(n.state, live)

  return (
    <div className="space-y-5">
      <StCard>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold">
            {active ? t("当前请求", "Current request") : t("最近一次请求", "Last request")}
            {active && <Pill tone={n.state === "reading" ? "info" : "brand"} pulse>{phase(live.phase)}</Pill>}
          </div>
          <span className="tabular text-[13px] text-ink-muted">
            {active ? t(`已用 ${live.elapsed_s ?? 0} s`, `${live.elapsed_s ?? 0} s elapsed`) : n.up ? t(`最近心跳 ${ago(n.last_seen)}`, `Last seen ${ago(n.last_seen)}`) : nodeError(n.last_error)}
          </span>
        </div>
        <Progress
          value={read != null ? read * 100 : active && live.max_tokens ? ((live.generated ?? 0) / live.max_tokens) * 100 : 0}
          indeterminate={n.state === "reading" && read == null}
          tone={n.state === "reading" ? "info" : "brand"}
        />
        <div className="tabular mt-2 flex justify-between text-xs text-ink-muted">
          <span>
            {read != null
              ? `${t("读取", "Read")} ${num(live.prompt_read)} / ${num(live.prompt_total)} · ${pct(read)}`
              : `${t("提示", "Prompt")} ${num(live.prompt_tokens)} · ${t("生成", "Gen")} ${num(live.generated)}${active ? ` / ${num(live.max_tokens)}` : ""}`}
          </span>
          <span>{active && live.tokens_per_s ? `${live.tokens_per_s} t/s` : ""}</span>
        </div>
      </StCard>

      {m ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={<Zap />} label={t("速度", "Speed")} value={hw.tok_s ? hw.tok_s.toFixed(1) : "0"} unit="t/s" sub={`prefill ${num(hw.prefill_tok_s_mean)} t/s`} spark={hist.tok_s} />
            <Metric icon={<GaugeIcon />} label={t("GPU 负载", "GPU load")} value={num(hw.gpu_util)} unit="%" spark={hist.gpu_util} sparkMax={100} />
            <Metric icon={<Layers />} label={t("显存", "VRAM")} value={gb(hw.gpu_mem_used)} unit={`/ ${gb(hw.gpu_mem_total)} GB`} sub={t(`${num(Number(eng.expert_slots))} 个专家槽位`, `${num(Number(eng.expert_slots))} expert slots`)} spark={hist.gpu_mem_used} sparkMax={hw.gpu_mem_total} />
            <Metric icon={<Thermometer />} label={t("GPU 温度", "GPU temp")} value={num(hw.gpu_temp)} unit="°C" spark={hist.gpu_temp} tone="warn" sparkMax={100} />
            <Metric icon={<Plug />} label={t("功耗", "Power")} value={num(hw.gpu_power)} unit="W" sub={t(`上限 ${num(hw.gpu_power_limit)} W`, `Limit ${num(hw.gpu_power_limit)} W`)} spark={hist.gpu_power} sparkMax={hw.gpu_power_limit} />
            <Metric icon={<Cpu />} label="CPU" value={num(hw.cpu)} unit="%" sub={t(`${m.hardware_static.cores ?? "—"} 核 · ${m.hardware_static.threads ?? "—"} 线程`, `${m.hardware_static.cores ?? "—"} cores · ${m.hardware_static.threads ?? "—"} threads`)} spark={hist.cpu} sparkMax={100} tone="info" />
            <Metric icon={<MemoryStick />} label={t("内存", "RAM")} value={gb(hw.ram_used)} unit={`/ ${gb(hw.ram_total)} GB`} spark={hist.ram_used} sparkMax={hw.ram_total} tone="info" />
            <Metric icon={<HardDrive />} label="PCIe" value={`Gen${hw.gpu_pcie_gen ?? "—"}`} unit={`x${hw.gpu_pcie_width ?? "—"}`} sub={t(`到 GPU ${(hw.gpu_pcie_rx_mb ?? 0).toFixed(1)} MB/s`, `To GPU ${(hw.gpu_pcie_rx_mb ?? 0).toFixed(1)} MB/s`)} spark={hist.gpu_pcie_rx_mb} tone="info" />
          </div>

          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            <StCard className="flex flex-col items-center">
              <CardTitle className="self-start">{t("上下文占用", "Context usage")}</CardTitle>
              <Gauge value={ctx ? used / ctx : 0} label={pct(ctx ? used / ctx : 0)} sub={`${tokens(used)} / ${tokens(ctx)}`} />
            </StCard>
            <StCard>
              <CardTitle>{t("引擎", "Engine")}</CardTitle>
              <div className="grid gap-x-8 sm:grid-cols-2">
                <KV label={t("模型", "Model")} value={String(eng.model ?? n.info.model ?? "—")} />
                <KV label={t("版本", "Version")} value={String(eng.version ?? "—")} />
                <KV label={t("上下文", "Context")} value={tokens(ctx)} />
                <KV label={t("KV 缓存", "KV cache")} value={String(eng.kv ?? "—")} />
                <KV label={t("专家缓存", "Expert cache")} value={`${num(Number(eng.expert_slots))} ${t("槽", "slots")} · ${gb(Number(eng.expert_cache_mib) * 1024 ** 2)} GB`} />
                <KV label={t("会话缓存", "Conversation cache")} value={eng.conversation_cache_mib ? `${gb(Number(eng.conversation_cache_mib) * 1024 ** 2)} GB · ${eng.conversation_cache_slots} ${t("段", "slots")}` : t("关闭", "Off")} />
                <KV label="GPU" value={m.hardware_static.gpu_name ?? "—"} />
                <KV label="CPU" value={m.hardware_static.cpu_name ?? "—"} />
              </div>
            </StCard>
          </div>

          <StCard>
            <CardTitle actions={<span className="text-[13px] text-ink-muted">{t("节点自身记录", "Recorded by the node")}</span>}>{t("最近请求", "Recent requests")}</CardTitle>
            <StTable head={[{ label: t("时间", "Time") }, { label: t("提示", "Prompt"), num: true }, { label: t("复用", "Reused"), num: true }, { label: t("输出", "Output"), num: true }, { label: t("速度", "Speed"), num: true }, { label: t("命中率", "Hit rate"), num: true }, { label: t("耗时", "Duration"), num: true }]}>
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
        <StCard><div className="py-8 text-center text-sm text-ink-muted">{t("暂时无法获取节点指标", "Node metrics unavailable")}</div></StCard>
      )}

      <StCard>
        <CardTitle actions={<span className="text-[13px] text-ink-muted">{t("经入口分配", "Assigned by the router")}</span>}>{t("路由记录", "Routing history")}</CardTitle>
        <StTable head={[{ label: t("时间", "Time") }, { label: t("密钥", "Key") }, { label: t("路由", "Route") }, { label: t("内容", "Content") }, { label: t("输出", "Output"), num: true }, { label: t("耗时", "Duration"), num: true }, { label: t("状态", "Status") }]}>
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
          {n?.name ?? t("节点", "Node")}
          {n && <StatePill state={n.state} />}
          {n && n.mode !== "enabled" && <Pill tone={MODE[n.mode].tone}>{MODE[n.mode].label}</Pill>}
          {n && (
            <Button variant="outline" size="sm" className="ml-auto" render={<a href={n.url} target="_blank" rel="noreferrer" />}>
              {t("节点网页", "Node web UI")}<ExternalLink />
            </Button>
          )}
        </SheetTitle>
        {n && <div className="text-xs text-ink-muted">{n.url} · {n.info.model ?? "—"} · {t(`今日 ${num(n.today.requests)} 次`, `${num(n.today.requests)} today`)}</div>}
      </SheetHeader>
      <div className="p-6">
        <Body id={id} />
      </div>
    </>
  )
}

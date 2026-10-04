import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { CardTitle, PageHeader, Segmented, StCard } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api, session } from "@/lib/api"
import { STRATEGY } from "@/lib/format"
import type { Settings as SettingsData } from "@/lib/types"

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-ink-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function NumberInput({ value, onChange, unit, step = 1 }: { value: number; onChange: (v: number) => void; unit?: string; step?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="tabular h-9 w-28 text-right" />
      {unit && <span className="w-8 text-[13px] text-ink-muted">{unit}</span>}
    </div>
  )
}

function SaveBar({ dirty, onSave, busy }: { dirty: boolean; onSave: () => void; busy: boolean }) {
  return (
    <div className="mt-auto flex justify-end pt-5">
      <Button onClick={onSave} disabled={!dirty || busy}>{busy ? "保存中…" : "保存"}</Button>
    </div>
  )
}

export default function Settings() {
  const [saved, setSaved] = useState<SettingsData | null>(null)
  const [s, setS] = useState<SettingsData | null>(null)
  const [busy, setBusy] = useState("")
  const [pw, setPw] = useState({ old: "", next: "", confirm: "" })

  useEffect(() => {
    api<SettingsData>("settings").then((d) => {
      setSaved(d)
      setS(d)
    }).catch((e) => toast.error(e.message))
  }, [])

  if (!s || !saved) return <div className="py-20 text-center text-ink-muted">加载中…</div>

  const section = <K extends "routing" | "health" | "system">(k: K) => ({
    get: s[k],
    set: (patch: Partial<SettingsData[K]>) => setS({ ...s, [k]: { ...s[k], ...patch } }),
    dirty: JSON.stringify(s[k]) !== JSON.stringify(saved[k]),
  })
  const routing = section("routing")
  const health = section("health")
  const system = section("system")

  const save = async (name: string, body: Partial<SettingsData>) => {
    setBusy(name)
    try {
      const d = await api<SettingsData>("settings", { method: "PUT", body })
      setSaved(d)
      setS({ ...s, ...body })
      toast.success(d.restart_required ? "已保存，端口修改需重启服务后生效" : "已保存")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy("")
    }
  }

  return (
    <div>
      <PageHeader title="设置" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <StCard>
            <CardTitle>路由</CardTitle>
            <Row label="分配策略" hint={STRATEGY[routing.get.strategy]?.desc}>
              <Segmented size="sm" value={routing.get.strategy} onChange={(v) => routing.set({ strategy: v })}
                options={Object.entries(STRATEGY).map(([value, o]) => ({ value, label: o.label }))} />
            </Row>
            <Row label="会话粘性" hint="同一会话优先回到上次的节点，保住对话缓存">
              <Switch checked={routing.get.sticky} onCheckedChange={(v) => routing.set({ sticky: Boolean(v) })} />
            </Row>
            <Row label="换节点阈值" hint="原节点忙时，换到空闲节点需要重读的上下文不超过此值才换">
              <NumberInput value={routing.get.reroute_max_tokens} onChange={(v) => routing.set({ reroute_max_tokens: v })} unit="token" step={1000} />
            </Row>
            <Row label="剔除固定前缀" hint="目标节点处理过相同的系统提示与工具时，只按对话部分估算重读量">
              <Switch checked={routing.get.exclude_fixed} onCheckedChange={(v) => routing.set({ exclude_fixed: Boolean(v) })} />
            </Row>
            <Row label="失败重试" hint="节点连接失败时改发其他节点">
              <Switch checked={routing.get.retry} onCheckedChange={(v) => routing.set({ retry: Boolean(v) })} />
            </Row>
            <SaveBar dirty={routing.dirty} busy={busy === "routing"} onSave={() => save("routing", { routing: routing.get })} />
          </StCard>

          <StCard className="flex flex-1 flex-col">
            <CardTitle>健康检查</CardTitle>
            <Row label="检查间隔"><NumberInput value={health.get.interval_s} onChange={(v) => health.set({ interval_s: v })} unit="秒" step={0.5} /></Row>
            <Row label="超时"><NumberInput value={health.get.timeout_s} onChange={(v) => health.set({ timeout_s: v })} unit="秒" step={0.5} /></Row>
            <Row label="判定离线" hint="连续失败次数"><NumberInput value={health.get.fail_threshold} onChange={(v) => health.set({ fail_threshold: v })} unit="次" /></Row>
            <Row label="指标刷新" hint="硬件指标与曲线"><NumberInput value={health.get.metrics_interval_s} onChange={(v) => health.set({ metrics_interval_s: v })} unit="秒" /></Row>
            <SaveBar dirty={health.dirty} busy={busy === "health"} onSave={() => save("health", { health: health.get })} />
          </StCard>
        </div>

        <div className="flex flex-col gap-5">
          <StCard>
            <CardTitle>日志与登录</CardTitle>
            <Row label="请求日志保留"><NumberInput value={system.get.log_retention_days} onChange={(v) => system.set({ log_retention_days: v })} unit="天" /></Row>
            <Row label="登录有效期"><NumberInput value={system.get.session_hours} onChange={(v) => system.set({ session_hours: v })} unit="小时" /></Row>
            <Row label="立即清理" hint="删除超过保留天数的请求日志与事件">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const r = await api<{ deleted: number }>("logs/cleanup", { method: "POST", body: {} })
                    toast.success(`已清理 ${r.deleted} 条`)
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                清理
              </Button>
            </Row>
            <SaveBar dirty={system.dirty} busy={busy === "system"} onSave={() => save("system", { system: system.get })} />
          </StCard>

          <StCard>
            <CardTitle>服务</CardTitle>
            <Row label="入口端口" hint="修改后需重启服务">
              <NumberInput value={s.port} onChange={(v) => setS({ ...s, port: v })} />
            </Row>
            <SaveBar dirty={s.port !== saved.port} busy={busy === "port"} onSave={() => save("port", { port: s.port })} />
          </StCard>

          <StCard className="flex flex-1 flex-col">
            <CardTitle>管理员密码</CardTitle>
            <form
              className="flex flex-1 flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault()
                if (pw.next !== pw.confirm) return toast.error("两次输入的新密码不一致")
                setBusy("pw")
                try {
                  const r = await api<{ token: string }>("password", { method: "POST", body: { old: pw.old, new: pw.next } })
                  session.set(r.token)
                  setPw({ old: "", next: "", confirm: "" })
                  toast.success("密码已修改，其他设备需重新登录")
                } catch (err) {
                  toast.error((err as Error).message)
                } finally {
                  setBusy("")
                }
              }}
            >
              <div className="space-y-1.5"><Label>当前密码</Label><Input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} className="h-10" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>新密码</Label><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="至少 8 位" className="h-10" /></div>
                <div className="space-y-1.5"><Label>确认新密码</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className="h-10" /></div>
              </div>
              <div className="mt-auto flex justify-end pt-2">
                <Button type="submit" disabled={busy === "pw" || !pw.old || pw.next.length < 8}>修改密码</Button>
              </div>
            </form>
          </StCard>
        </div>
      </div>
    </div>
  )
}

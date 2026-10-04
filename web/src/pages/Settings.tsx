import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { CardTitle, PageHeader, Segmented, StCard } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api, session } from "@/lib/api"
import { STRATEGY } from "@/lib/format"
import { t } from "@/lib/i18n"
import type { Settings as SettingsData } from "@/lib/types"

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-56">
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
      <Button onClick={onSave} disabled={!dirty || busy}>{busy ? t("保存中…", "Saving…") : t("保存", "Save")}</Button>
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

  if (!s || !saved) return <div className="py-20 text-center text-ink-muted">{t("加载中…", "Loading…")}</div>

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
      toast.success(d.restart_required ? t("已保存，端口修改需重启服务后生效", "Saved. The port change takes effect after a restart") : t("已保存", "Saved"))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy("")
    }
  }

  return (
    <div>
      <PageHeader title={t("设置", "Settings")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <StCard>
            <CardTitle>{t("路由", "Routing")}</CardTitle>
            <Row label={t("分配策略", "Strategy")} hint={STRATEGY[routing.get.strategy]?.desc}>
              <Segmented size="sm" value={routing.get.strategy} onChange={(v) => routing.set({ strategy: v })}
                options={Object.entries(STRATEGY).map(([value, o]) => ({ value, label: o.label }))} />
            </Row>
            <Row label={t("会话粘性", "Sticky sessions")} hint={t("同一会话优先回到上次的节点，保住对话缓存", "Send a session back to its previous node to keep the conversation cache")}>
              <Switch checked={routing.get.sticky} onCheckedChange={(v) => routing.set({ sticky: Boolean(v) })} />
            </Row>
            <Row label={t("换节点阈值", "Move threshold")} hint={t("原节点忙时，换到空闲节点需要重读的上下文不超过此值才换", "When the home node is busy, move only if the context to re-read on an idle node is at most this")}>
              <NumberInput value={routing.get.reroute_max_tokens} onChange={(v) => routing.set({ reroute_max_tokens: v })} unit="token" step={1000} />
            </Row>
            <Row label={t("剔除固定前缀", "Exclude fixed prefix")} hint={t("目标节点处理过相同的系统提示与工具时，只按对话部分估算重读量", "If the target node has seen the same system prompt and tools, count only the conversation as re-read")}>
              <Switch checked={routing.get.exclude_fixed} onCheckedChange={(v) => routing.set({ exclude_fixed: Boolean(v) })} />
            </Row>
            <Row label={t("失败重试", "Retry on failure")} hint={t("节点连接失败时改发其他节点", "Send to another node when a connection fails")}>
              <Switch checked={routing.get.retry} onCheckedChange={(v) => routing.set({ retry: Boolean(v) })} />
            </Row>
            <SaveBar dirty={routing.dirty} busy={busy === "routing"} onSave={() => save("routing", { routing: routing.get })} />
          </StCard>

          <StCard className="flex flex-1 flex-col">
            <CardTitle>{t("健康检查", "Health check")}</CardTitle>
            <Row label={t("检查间隔", "Interval")}><NumberInput value={health.get.interval_s} onChange={(v) => health.set({ interval_s: v })} unit={t("秒", "s")} step={0.5} /></Row>
            <Row label={t("超时", "Timeout")}><NumberInput value={health.get.timeout_s} onChange={(v) => health.set({ timeout_s: v })} unit={t("秒", "s")} step={0.5} /></Row>
            <Row label={t("判定离线", "Offline after")} hint={t("连续失败次数", "Consecutive failures")}><NumberInput value={health.get.fail_threshold} onChange={(v) => health.set({ fail_threshold: v })} unit={t("次", "times")} /></Row>
            <Row label={t("指标刷新", "Metrics refresh")} hint={t("硬件指标与曲线", "Hardware metrics and charts")}><NumberInput value={health.get.metrics_interval_s} onChange={(v) => health.set({ metrics_interval_s: v })} unit={t("秒", "s")} /></Row>
            <SaveBar dirty={health.dirty} busy={busy === "health"} onSave={() => save("health", { health: health.get })} />
          </StCard>
        </div>

        <div className="flex flex-col gap-5">
          <StCard>
            <CardTitle>{t("日志与登录", "Logs and sign-in")}</CardTitle>
            <Row label={t("请求日志保留", "Keep request logs")}><NumberInput value={system.get.log_retention_days} onChange={(v) => system.set({ log_retention_days: v })} unit={t("天", "days")} /></Row>
            <Row label={t("登录有效期", "Sign-in lasts")}><NumberInput value={system.get.session_hours} onChange={(v) => system.set({ session_hours: v })} unit={t("小时", "hours")} /></Row>
            <Row label={t("立即清理", "Clean up now")} hint={t("删除超过保留天数的请求日志与事件", "Delete request logs and events older than the retention period")}>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const r = await api<{ deleted: number }>("logs/cleanup", { method: "POST", body: {} })
                    toast.success(t(`已清理 ${r.deleted} 条`, `Deleted ${r.deleted} records`))
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                {t("清理", "Clean up")}
              </Button>
            </Row>
            <SaveBar dirty={system.dirty} busy={busy === "system"} onSave={() => save("system", { system: system.get })} />
          </StCard>

          <StCard>
            <CardTitle>{t("服务", "Service")}</CardTitle>
            <Row label={t("入口端口", "Port")} hint={t("修改后需重启服务", "Takes effect after a restart")}>
              <NumberInput value={s.port} onChange={(v) => setS({ ...s, port: v })} />
            </Row>
            <SaveBar dirty={s.port !== saved.port} busy={busy === "port"} onSave={() => save("port", { port: s.port })} />
          </StCard>

          <StCard className="flex flex-1 flex-col">
            <CardTitle>{t("管理员密码", "Admin password")}</CardTitle>
            <form
              className="flex flex-1 flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault()
                if (pw.next !== pw.confirm) return toast.error(t("两次输入的新密码不一致", "The new passwords do not match"))
                setBusy("pw")
                try {
                  const r = await api<{ token: string }>("password", { method: "POST", body: { old: pw.old, new: pw.next } })
                  session.set(r.token)
                  setPw({ old: "", next: "", confirm: "" })
                  toast.success(t("密码已修改，其他设备需重新登录", "Password changed. Other devices must sign in again"))
                } catch (err) {
                  toast.error((err as Error).message)
                } finally {
                  setBusy("")
                }
              }}
            >
              <div className="space-y-1.5"><Label>{t("当前密码", "Current password")}</Label><Input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} className="h-10" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>{t("新密码", "New password")}</Label><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder={t("至少 8 位", "At least 8 characters")} className="h-10" /></div>
                <div className="space-y-1.5"><Label>{t("确认新密码", "Confirm new password")}</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className="h-10" /></div>
              </div>
              <div className="mt-auto flex justify-end pt-2">
                <Button type="submit" disabled={busy === "pw" || !pw.old || pw.next.length < 8}>{t("修改密码", "Change password")}</Button>
              </div>
            </form>
          </StCard>
        </div>
      </div>
    </div>
  )
}

import { useState } from "react"
import { CheckCircle2, CircleSlash, ExternalLink, MoreHorizontal, Pencil, PlayCircle, Plus, Server, Trash2, TriangleAlert, Waves } from "lucide-react"
import { toast } from "sonner"

import { NodeDetailSheet } from "@/pages/NodeDetail"
import { Empty, PageHeader, Pill, Progress, StCard, StTable, StatePill } from "@/components/st"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePoll } from "@/hooks/usePoll"
import { api } from "@/lib/api"
import { MODE, ago, nodeError, num, phase, readFrac, tokens } from "@/lib/format"
import { t } from "@/lib/i18n"
import type { NodeMode, NodeSummary, Probe } from "@/lib/types"

type Form = { url: string; api_key: string; name: string; weight: string; tags: string }

function NodeForm({ node, open, onClose, onSaved }: { node: NodeSummary | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const editing = node != null
  const [form, setForm] = useState<Form>(() => ({
    url: node?.url ?? "",
    api_key: "",
    name: node?.name ?? "",
    weight: String(node?.weight ?? 1),
    tags: node?.tags.join(", ") ?? "",
  }))
  const [probe, setProbe] = useState<{ ok: boolean; info?: Probe; error?: string } | null>(null)
  const [busy, setBusy] = useState<"" | "test" | "save">("")
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value })
    if (k === "url" || k === "api_key") setProbe(null)
  }

  const test = async () => {
    setBusy("test")
    try {
      setProbe({ ok: true, info: await api<Probe>("nodes/test", { method: "POST", body: { url: form.url.trim(), api_key: form.api_key } }) })
    } catch (e) {
      setProbe({ ok: false, error: (e as Error).message })
    } finally {
      setBusy("")
    }
  }

  const save = async () => {
    setBusy("save")
    const body = {
      name: form.name.trim(),
      weight: Number(form.weight) || 1,
      tags: form.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
      ...(form.api_key ? { api_key: form.api_key } : {}),
    }
    try {
      if (editing) await api(`nodes/${node.id}`, { method: "PATCH", body })
      else await api("nodes", { method: "POST", body: { ...body, url: form.url.trim(), api_key: form.api_key } })
      toast.success(editing ? t("已保存", "Saved") : t(`已添加 ${body.name || form.url}`, `Added ${body.name || form.url}`))
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy("")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-[20px] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-black">{editing ? t(`编辑 ${node.name}`, `Edit ${node.name}`) : t("添加节点", "Add node")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="n-url">{t("地址", "URL")}</Label>
            <Input id="n-url" placeholder="http://192.168.1.20:8080" value={form.url} onChange={set("url")} disabled={editing} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-key">{t("节点密钥", "Node key")}</Label>
            <Input id="n-key" type="password" placeholder={editing ? t(`${node.key_hint}（留空不修改）`, `${node.key_hint} (leave empty to keep)`) : ""} value={form.api_key} onChange={set("api_key")} className="h-10" />
          </div>
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="n-name">{t("名称", "Name")}</Label>
              <Input id="n-name" placeholder={t("可选", "Optional")} value={form.name} onChange={set("name")} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-weight">{t("权重", "Weight")}</Label>
              <Input id="n-weight" type="number" min={1} max={100} value={form.weight} onChange={set("weight")} className="h-10" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-tags">{t("标签", "Tags")}</Label>
            <Input id="n-tags" placeholder={t("用逗号分隔，可选", "Comma separated, optional")} value={form.tags} onChange={set("tags")} className="h-10" />
          </div>
          {probe && (
            <div className={`rounded-[14px] border p-3.5 text-sm ${probe.ok ? "border-transparent bg-brand-tint" : "border-transparent bg-danger-tint"}`}>
              {probe.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-bold text-brand-text"><CheckCircle2 className="size-4" />{t("连接成功", "Connected")}</div>
                  <div className="tabular text-ink-soft">
                    {probe.info?.model} · {t("上下文", "Context")} {tokens(probe.info?.context)} · {probe.info?.gpu ?? "—"} · {t("引擎", "Engine")} {probe.info?.version ?? "—"}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-bold text-danger-text"><TriangleAlert className="size-4" />{probe.error}</div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {(!editing || form.api_key) && (
            <Button variant="outline" onClick={test} disabled={busy !== "" || !form.url}>
              {busy === "test" ? t("测试中…", "Testing…") : t("测试连接", "Test connection")}
            </Button>
          )}
          <Button onClick={save} disabled={busy !== "" || !form.url}>
            {busy === "save" ? t("保存中…", "Saving…") : editing ? t("保存", "Save") : t("添加", "Add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const A = (mode: NodeMode, zh: string, en: string, icon: React.ReactNode, doneZh: string, doneEn: string) => ({
  mode, icon, get label() { return t(zh, en) }, get done() { return t(doneZh, doneEn) },
})

const MODE_ACTIONS: { mode: NodeMode; label: string; done: string; icon: React.ReactNode }[] = [
  A("enabled", "启用", "Enable", <PlayCircle />, "已启用", "enabled"),
  A("draining", "排空", "Drain", <Waves />, "开始排空", "draining"),
  A("disabled", "停用", "Disable", <CircleSlash />, "已停用", "disabled"),
]

export default function Nodes() {
  const { data, error, reload } = usePoll(() => api<NodeSummary[]>("nodes"), 2000)
  const [form, setForm] = useState<{ node: NodeSummary | null } | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [removing, setRemoving] = useState<NodeSummary | null>(null)

  const setMode = async (n: NodeSummary, mode: NodeMode) => {
    try {
      await api(`nodes/${n.id}`, { method: "PATCH", body: { mode } })
      const done = MODE_ACTIONS.find((a) => a.mode === mode)!.done
      toast.success(`${n.name} ${done}`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const nodes = data ?? []
  return (
    <div>
      <PageHeader
        title={t("节点", "Nodes")}
        actions={<Button onClick={() => setForm({ node: null })} className="h-10 rounded-[14px] px-4 font-bold"><Plus />{t("添加节点", "Add node")}</Button>}
      >
        {data && <Pill tone="muted">{nodes.filter((n) => n.up).length} / {nodes.length} {t("在线", "online")}</Pill>}
      </PageHeader>

      <StCard className="p-2">
        {!data ? (
          <div className="py-16 text-center text-ink-muted">{error || t("加载中…", "Loading…")}</div>
        ) : nodes.length === 0 ? (
          <Empty icon={<Server />} title={t("还没有节点", "No nodes yet")} action={<Button onClick={() => setForm({ node: null })}>{t("添加节点", "Add node")}</Button>} />
        ) : (
          <StTable
            head={[
              { label: t("节点", "Node") }, { label: t("状态", "Status") }, { label: t("管理", "Mode") }, { label: t("模型 / GPU", "Model / GPU") }, { label: t("当前", "Current"), className: "w-48" },
              { label: t("今日", "Today"), num: true }, { label: t("累计", "Total"), num: true }, { label: t("权重", "Weight"), num: true }, { label: t("心跳", "Heartbeat") }, { label: "" },
            ]}
          >
            {nodes.map((n) => {
              const active = n.state === "generating" || n.state === "reading"
              return (
                <tr key={n.id} className="cursor-pointer" onClick={() => setDetail(n.id)}>
                  <td>
                    <div className="font-bold text-ink">{n.name}</div>
                    <div className="text-xs text-ink-muted">{n.url}</div>
                    {n.tags.length > 0 && <div className="mt-1 flex gap-1">{n.tags.map((tag) => <span key={tag} className="rounded-md bg-surface-2 px-1.5 text-[11px] text-ink-muted">{tag}</span>)}</div>}
                  </td>
                  <td><StatePill state={n.state} /></td>
                  <td><Pill tone={MODE[n.mode].tone}>{MODE[n.mode].label}</Pill></td>
                  <td>
                    <div className="text-ink-soft">{n.info.model ?? "—"}</div>
                    <div className="text-xs text-ink-muted">{n.info.gpu ?? (n.up ? "" : nodeError(n.last_error))}</div>
                  </td>
                  <td>
                    {active ? (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs"><span>{phase(n.live.phase)}</span><span>{n.live.tokens_per_s ? `${n.live.tokens_per_s} t/s` : ""}</span></div>
                        <Progress value={readFrac(n.state, n.live) != null ? readFrac(n.state, n.live)! * 100 : n.live.max_tokens ? ((n.live.generated ?? 0) / n.live.max_tokens) * 100 : 0} indeterminate={n.state === "reading" && readFrac(n.state, n.live) == null} tone={n.state === "reading" ? "info" : "brand"} />
                      </div>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="text-right">{num(n.today.requests)}</td>
                  <td className="text-right">{num(n.total.requests)}</td>
                  <td className="text-right">{n.weight}</td>
                  <td className="whitespace-nowrap text-ink-muted">{n.up ? ago(n.last_seen) : <span className="text-danger-text">{t("离线", "Offline")}</span>}</td>
                  <td onClick={(e) => e.stopPropagation()} className="w-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("操作", "Actions")} />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem onClick={() => setForm({ node: n })}><Pencil />{t("编辑", "Edit")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(n.url, "_blank")}><ExternalLink />{t("节点网页", "Node web UI")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {MODE_ACTIONS.filter((a) => a.mode !== n.mode).map((a) => (
                          <DropdownMenuItem key={a.mode} onClick={() => setMode(n, a.mode)}>{a.icon}{a.label}</DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setRemoving(n)}><Trash2 />{t("删除", "Delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </StTable>
        )}
      </StCard>

      {form && <NodeForm key={form.node?.id ?? "new"} node={form.node} open onClose={() => setForm(null)} onSaved={reload} />}
      <NodeDetailSheet nodeId={detail} onClose={() => setDetail(null)} />

      <AlertDialog open={removing != null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`删除 ${removing?.name}？`, `Delete ${removing?.name}?`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.inflight
                ? t("该节点还有进行中的请求，删除后它们会继续完成。", "This node still has requests in progress; they will finish after deletion. ")
                : t("之后的请求不再分到这个节点。", "New requests will no longer go to this node. ")}
              {t("需要临时下线时，可以改用“排空”。", "To take it offline temporarily, use “Drain” instead.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const n = removing!
                setRemoving(null)
                try {
                  await api(`nodes/${n.id}`, { method: "DELETE" })
                  toast.success(t(`已删除 ${n.name}`, `Deleted ${n.name}`))
                  reload()
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
            >
              {t("删除", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

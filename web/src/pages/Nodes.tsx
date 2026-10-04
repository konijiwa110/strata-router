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
import { MODE, ago, num, phase, tokens } from "@/lib/format"
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
      tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      ...(form.api_key ? { api_key: form.api_key } : {}),
    }
    try {
      if (editing) await api(`nodes/${node.id}`, { method: "PATCH", body })
      else await api("nodes", { method: "POST", body: { ...body, url: form.url.trim(), api_key: form.api_key } })
      toast.success(editing ? "已保存" : `已添加 ${body.name || form.url}`)
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
          <DialogTitle className="text-lg font-black">{editing ? `编辑 ${node.name}` : "添加节点"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="n-url">地址</Label>
            <Input id="n-url" placeholder="http://100.64.0.20:8080" value={form.url} onChange={set("url")} disabled={editing} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-key">节点密钥</Label>
            <Input id="n-key" type="password" placeholder={editing ? `${node.key_hint}（留空不修改）` : ""} value={form.api_key} onChange={set("api_key")} className="h-10" />
          </div>
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="n-name">名称</Label>
              <Input id="n-name" placeholder="可选" value={form.name} onChange={set("name")} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-weight">权重</Label>
              <Input id="n-weight" type="number" min={1} max={100} value={form.weight} onChange={set("weight")} className="h-10" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-tags">标签</Label>
            <Input id="n-tags" placeholder="用逗号分隔，可选" value={form.tags} onChange={set("tags")} className="h-10" />
          </div>
          {probe && (
            <div className={`rounded-[14px] border p-3.5 text-sm ${probe.ok ? "border-transparent bg-brand-tint" : "border-transparent bg-danger-tint"}`}>
              {probe.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-bold text-brand-text"><CheckCircle2 className="size-4" />连接成功</div>
                  <div className="tabular text-ink-soft">
                    {probe.info?.model} · 上下文 {tokens(probe.info?.context)} · {probe.info?.gpu ?? "—"} · 引擎 {probe.info?.version ?? "—"}
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
              {busy === "test" ? "测试中…" : "测试连接"}
            </Button>
          )}
          <Button onClick={save} disabled={busy !== "" || !form.url}>
            {busy === "save" ? "保存中…" : editing ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const MODE_ACTIONS: { mode: NodeMode; label: string; icon: React.ReactNode }[] = [
  { mode: "enabled", label: "启用", icon: <PlayCircle /> },
  { mode: "draining", label: "排空", icon: <Waves /> },
  { mode: "disabled", label: "停用", icon: <CircleSlash /> },
]

export default function Nodes() {
  const { data, error, reload } = usePoll(() => api<NodeSummary[]>("nodes"), 2000)
  const [form, setForm] = useState<{ node: NodeSummary | null } | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [removing, setRemoving] = useState<NodeSummary | null>(null)

  const setMode = async (n: NodeSummary, mode: NodeMode) => {
    try {
      await api(`nodes/${n.id}`, { method: "PATCH", body: { mode } })
      toast.success(`${n.name} 已${MODE[mode].label === "排空中" ? "开始排空" : MODE[mode].label}`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const nodes = data ?? []
  return (
    <div>
      <PageHeader
        title="节点"
        actions={<Button onClick={() => setForm({ node: null })} className="h-10 rounded-[14px] px-4 font-bold"><Plus />添加节点</Button>}
      >
        {data && <Pill tone="muted">{nodes.filter((n) => n.up).length} / {nodes.length} 在线</Pill>}
      </PageHeader>

      <StCard className="p-2">
        {!data ? (
          <div className="py-16 text-center text-ink-muted">{error || "加载中…"}</div>
        ) : nodes.length === 0 ? (
          <Empty icon={<Server />} title="还没有节点" action={<Button onClick={() => setForm({ node: null })}>添加节点</Button>} />
        ) : (
          <StTable
            head={[
              { label: "节点" }, { label: "状态" }, { label: "管理" }, { label: "模型 / GPU" }, { label: "当前", className: "w-48" },
              { label: "今日", num: true }, { label: "累计", num: true }, { label: "权重", num: true }, { label: "心跳" }, { label: "" },
            ]}
          >
            {nodes.map((n) => {
              const active = n.state === "generating" || n.state === "reading"
              return (
                <tr key={n.id} className="cursor-pointer" onClick={() => setDetail(n.id)}>
                  <td>
                    <div className="font-bold text-ink">{n.name}</div>
                    <div className="text-xs text-ink-muted">{n.url}</div>
                    {n.tags.length > 0 && <div className="mt-1 flex gap-1">{n.tags.map((t) => <span key={t} className="rounded-md bg-surface-2 px-1.5 text-[11px] text-ink-muted">{t}</span>)}</div>}
                  </td>
                  <td><StatePill state={n.state} /></td>
                  <td><Pill tone={MODE[n.mode].tone}>{MODE[n.mode].label}</Pill></td>
                  <td>
                    <div className="text-ink-soft">{n.info.model ?? "—"}</div>
                    <div className="text-xs text-ink-muted">{n.info.gpu ?? (n.up ? "" : n.last_error)}</div>
                  </td>
                  <td>
                    {active ? (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs"><span>{phase(n.live.phase)}</span><span>{n.live.tokens_per_s ? `${n.live.tokens_per_s} t/s` : ""}</span></div>
                        <Progress value={n.live.max_tokens ? ((n.live.generated ?? 0) / n.live.max_tokens) * 100 : 0} indeterminate={n.state === "reading"} tone={n.state === "reading" ? "info" : "brand"} />
                      </div>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="text-right">{num(n.today.requests)}</td>
                  <td className="text-right">{num(n.total.requests)}</td>
                  <td className="text-right">{n.weight}</td>
                  <td className="whitespace-nowrap text-ink-muted">{n.up ? ago(n.last_seen) : <span className="text-danger-text">离线</span>}</td>
                  <td onClick={(e) => e.stopPropagation()} className="w-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="操作" />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem onClick={() => setForm({ node: n })}><Pencil />编辑</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(n.url, "_blank")}><ExternalLink />节点网页</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {MODE_ACTIONS.filter((a) => a.mode !== n.mode).map((a) => (
                          <DropdownMenuItem key={a.mode} onClick={() => setMode(n, a.mode)}>{a.icon}{a.label}</DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setRemoving(n)}><Trash2 />删除</DropdownMenuItem>
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
            <AlertDialogTitle>删除 {removing?.name}？</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.inflight ? "该节点还有进行中的请求，删除后它们会继续完成。" : "之后的请求不再分到这个节点。"}需要临时下线时，可以改用“排空”。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const n = removing!
                setRemoving(null)
                try {
                  await api(`nodes/${n.id}`, { method: "DELETE" })
                  toast.success(`已删除 ${n.name}`)
                  reload()
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

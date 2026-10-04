import { useState } from "react"
import { Check, Copy, KeyRound, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Empty, PageHeader, Pill, StCard, StTable } from "@/components/st"
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { usePoll } from "@/hooks/usePoll"
import { api } from "@/lib/api"
import { ago, dateTime, num, tokens } from "@/lib/format"
import type { AccessKey } from "@/lib/types"

function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-[14px] border border-line bg-surface-2 p-1.5 pl-3.5">
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{value}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {})
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }}
      >
        {done ? <Check /> : <Copy />}
        {done ? "已复制" : "复制"}
      </Button>
    </div>
  )
}

function KeyDialog({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: AccessKey | null }) {
  const [name, setName] = useState(editing?.name ?? "")
  const [custom, setCustom] = useState("")
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      if (editing) {
        await api(`keys/${editing.id}`, { method: "PATCH", body: { name } })
        toast.success("已保存")
        onSaved()
        onClose()
      } else {
        const k = await api<AccessKey>("keys", { method: "POST", body: { name, key: custom || undefined } })
        setCreated(k.key ?? "")
        onSaved()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-[20px] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-black">{created ? "密钥已创建" : editing ? "重命名" : "新建密钥"}</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="space-y-3">
            <CopyField value={created} />
            <p className="text-[13px] text-warn-text">完整密钥只显示这一次，请立即保存。</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="k-name">名称</Label>
              <Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：笔记本 Claude Code" className="h-10" autoFocus />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="k-key">密钥</Label>
                <Input id="k-key" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="留空自动生成" className="h-10 font-mono" />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={onClose}>完成</Button>
          ) : (
            <Button onClick={submit} disabled={busy || !name.trim()}>{busy ? "保存中…" : editing ? "保存" : "创建"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Keys() {
  const { data, error, reload } = usePoll(() => api<AccessKey[]>("keys"), 5000)
  const [dialog, setDialog] = useState<{ editing: AccessKey | null } | null>(null)
  const [removing, setRemoving] = useState<AccessKey | null>(null)

  const toggle = async (k: AccessKey, enabled: boolean) => {
    try {
      await api(`keys/${k.id}`, { method: "PATCH", body: { enabled } })
      toast.success(`${k.name} 已${enabled ? "启用" : "停用"}`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const keys = data ?? []
  return (
    <div>
      <PageHeader title="访问密钥" actions={<Button onClick={() => setDialog({ editing: null })} className="h-10 rounded-[14px] px-4 font-bold"><Plus />新建密钥</Button>}>
        {data && <Pill tone="muted">{keys.filter((k) => k.enabled).length} 个启用</Pill>}
      </PageHeader>

      <StCard className="p-2">
        {!data ? (
          <div className="py-16 text-center text-ink-muted">{error || "加载中…"}</div>
        ) : keys.length === 0 ? (
          <Empty icon={<KeyRound />} title="还没有访问密钥，客户端将无法调用" action={<Button onClick={() => setDialog({ editing: null })}>新建密钥</Button>} />
        ) : (
          <StTable head={[{ label: "名称" }, { label: "密钥" }, { label: "启用" }, { label: "今日请求", num: true }, { label: "今日输出", num: true }, { label: "累计请求", num: true }, { label: "累计输出", num: true }, { label: "最近使用" }, { label: "创建" }, { label: "" }]}>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="font-bold text-ink">{k.name}</td>
                <td className="font-mono text-[13px]">{k.hint}</td>
                <td><Switch checked={k.enabled} onCheckedChange={(v) => toggle(k, Boolean(v))} aria-label="启用" /></td>
                <td className="text-right">{num(k.today.requests)}</td>
                <td className="text-right">{tokens(k.today.output_tokens)}</td>
                <td className="text-right">{num(k.total.requests)}</td>
                <td className="text-right">{tokens(k.total.output_tokens)}</td>
                <td className="whitespace-nowrap text-ink-muted">{ago(k.total.last_ts)}</td>
                <td className="whitespace-nowrap text-ink-muted">{dateTime(k.created)}</td>
                <td className="w-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="操作" />}><MoreHorizontal /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-32">
                      <DropdownMenuItem onClick={() => setDialog({ editing: k })}><Pencil />重命名</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setRemoving(k)}><Trash2 />删除</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </StTable>
        )}
      </StCard>

      {dialog && <KeyDialog key={dialog.editing?.id ?? "new"} open editing={dialog.editing} onClose={() => setDialog(null)} onSaved={reload} />}

      <AlertDialog open={removing != null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {removing?.name}？</AlertDialogTitle>
            <AlertDialogDescription>使用这个密钥的客户端会立即无法调用，历史请求记录保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const k = removing!
                setRemoving(null)
                try {
                  await api(`keys/${k.id}`, { method: "DELETE" })
                  toast.success(`已删除 ${k.name}`)
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

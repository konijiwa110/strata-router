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
import { t } from "@/lib/i18n"
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
        {done ? t("已复制", "Copied") : t("复制", "Copy")}
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
        toast.success(t("已保存", "Saved"))
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
          <DialogTitle className="text-lg font-black">{created ? t("密钥已创建", "Key created") : editing ? t("重命名", "Rename") : t("新建密钥", "New key")}</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="space-y-3">
            <CopyField value={created} />
            <p className="text-[13px] text-warn-text">{t("完整密钥只显示这一次，请立即保存。", "The full key is shown only once. Save it now.")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="k-name">{t("名称", "Name")}</Label>
              <Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("例如：笔记本 Claude Code", "e.g. Laptop Claude Code")} className="h-10" autoFocus />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="k-key">{t("密钥", "Key")}</Label>
                <Input id="k-key" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("留空自动生成", "Leave empty to generate")} className="h-10 font-mono" />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={onClose}>{t("完成", "Done")}</Button>
          ) : (
            <Button onClick={submit} disabled={busy || !name.trim()}>{busy ? t("保存中…", "Saving…") : editing ? t("保存", "Save") : t("创建", "Create")}</Button>
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
      toast.success(enabled ? t(`${k.name} 已启用`, `${k.name} enabled`) : t(`${k.name} 已停用`, `${k.name} disabled`))
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const keys = data ?? []
  return (
    <div>
      <PageHeader title={t("访问密钥", "Access keys")} actions={<Button onClick={() => setDialog({ editing: null })} className="h-10 rounded-[14px] px-4 font-bold"><Plus />{t("新建密钥", "New key")}</Button>}>
        {data && <Pill tone="muted">{keys.filter((k) => k.enabled).length} {t("个启用", "enabled")}</Pill>}
      </PageHeader>

      <StCard className="p-2">
        {!data ? (
          <div className="py-16 text-center text-ink-muted">{error || t("加载中…", "Loading…")}</div>
        ) : keys.length === 0 ? (
          <Empty icon={<KeyRound />} title={t("还没有访问密钥，客户端将无法调用", "No access keys yet; clients cannot call the router")} action={<Button onClick={() => setDialog({ editing: null })}>{t("新建密钥", "New key")}</Button>} />
        ) : (
          <StTable head={[{ label: t("名称", "Name") }, { label: t("密钥", "Key") }, { label: t("启用", "Enabled") }, { label: t("今日请求", "Req today"), num: true }, { label: t("今日输出", "Out today"), num: true }, { label: t("累计请求", "Req total"), num: true }, { label: t("累计输出", "Out total"), num: true }, { label: t("最近使用", "Last used") }, { label: t("创建", "Created") }, { label: "" }]}>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="font-bold text-ink">{k.name}</td>
                <td className="font-mono text-[13px]">{k.hint}</td>
                <td><Switch checked={k.enabled} onCheckedChange={(v) => toggle(k, Boolean(v))} aria-label={t("启用", "Enabled")} /></td>
                <td className="text-right">{num(k.today.requests)}</td>
                <td className="text-right">{tokens(k.today.output_tokens)}</td>
                <td className="text-right">{num(k.total.requests)}</td>
                <td className="text-right">{tokens(k.total.output_tokens)}</td>
                <td className="whitespace-nowrap text-ink-muted">{ago(k.total.last_ts)}</td>
                <td className="whitespace-nowrap text-ink-muted">{dateTime(k.created)}</td>
                <td className="w-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("操作", "Actions")} />}><MoreHorizontal /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-32">
                      <DropdownMenuItem onClick={() => setDialog({ editing: k })}><Pencil />{t("重命名", "Rename")}</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setRemoving(k)}><Trash2 />{t("删除", "Delete")}</DropdownMenuItem>
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
            <AlertDialogTitle>{t(`删除 ${removing?.name}？`, `Delete ${removing?.name}?`)}</AlertDialogTitle>
            <AlertDialogDescription>{t("使用这个密钥的客户端会立即无法调用，历史请求记录保留。", "Clients using this key will be rejected immediately. Request history is kept.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const k = removing!
                setRemoving(null)
                try {
                  await api(`keys/${k.id}`, { method: "DELETE" })
                  toast.success(t(`已删除 ${k.name}`, `Deleted ${k.name}`))
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

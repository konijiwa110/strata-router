import { useState } from "react"
import { motion } from "framer-motion"
import { LockKeyhole } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LangToggle } from "@/components/Layout"
import { api, session } from "@/lib/api"
import { t } from "@/lib/i18n"

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4"><LangToggle /></div>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        className="w-full max-w-sm rounded-[24px] border border-line bg-surface p-8 shadow-bar"
      >
        <div className="mb-8 text-center">
          <div className="text-[28px] font-black tracking-tight">Strata Router</div>
        </div>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError("")
            try {
              const r = await api<{ token: string }>("login", { method: "POST", body: { password } })
              session.set(r.token)
              onLogin()
            } catch (err) {
              setError((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="relative">
            <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              type="password"
              placeholder={t("管理员密码", "Admin password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-[14px] pl-10 text-[15px]"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-danger-text">{error}</p>}
          <Button type="submit" disabled={busy || !password} className="h-11 w-full rounded-[14px] text-[15px] font-bold shadow-[0_6px_16px_rgba(16,185,129,.24)]">
            {busy ? t("登录中…", "Signing in…") : t("登录", "Sign in")}
          </Button>
        </form>
      </motion.div>
    </div>
  )
}

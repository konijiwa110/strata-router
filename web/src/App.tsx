import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { Layout, PAGES, type Page } from "@/components/Layout"
import { Pill } from "@/components/st"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { usePoll } from "@/hooks/usePoll"
import { useTheme } from "@/hooks/useTheme"
import { api, session, setUnauthorizedHandler } from "@/lib/api"
import type { NodeSummary } from "@/lib/types"
import Keys from "@/pages/Keys"
import Login from "@/pages/Login"
import Nodes from "@/pages/Nodes"
import Overview from "@/pages/Overview"
import Requests from "@/pages/Requests"
import Settings from "@/pages/Settings"

const readPage = (): Page => {
  const p = location.hash.replace(/^#\/?/, "") as Page
  return PAGES.some((x) => x.value === p) ? p : "overview"
}

function ClusterPill() {
  const { data } = usePoll(() => api<NodeSummary[]>("nodes"), 5000)
  if (!data) return null
  const online = data.filter((n) => n.up).length
  const working = data.filter((n) => n.state === "generating" || n.state === "reading").length
  const tone = online < data.length ? "danger" : working ? "brand" : "muted"
  return (
    <Pill tone={tone} pulse={working > 0} className="hidden h-[30px] px-3 text-[13px] sm:inline-flex">
      {online}/{data.length} 在线{working ? ` · ${working} 工作中` : ""}
    </Pill>
  )
}

export default function App() {
  const { pref, setPref, resolved } = useTheme()
  const [authed, setAuthed] = useState(() => Boolean(session.get()))
  const [page, setPage] = useState<Page>(readPage)

  const logout = useCallback(() => {
    session.clear()
    setAuthed(false)
  }, [])

  useEffect(() => setUnauthorizedHandler(logout), [logout])
  useEffect(() => {
    const on = () => setPage(readPage())
    addEventListener("hashchange", on)
    return () => removeEventListener("hashchange", on)
  }, [])

  const go = (p: Page) => {
    location.hash = `/${p}`
    setPage(p)
  }

  return (
    <TooltipProvider>
      {!authed ? (
        <Login onLogin={() => setAuthed(true)} />
      ) : (
        <Layout
          page={page}
          onPage={go}
          status={<ClusterPill />}
          theme={pref}
          onTheme={setPref}
          onLogout={async () => {
            await api("logout", { method: "POST" }).catch(() => {})
            logout()
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
            >
              {page === "overview" && <Overview onGo={go} />}
              {page === "nodes" && <Nodes />}
              {page === "requests" && <Requests />}
              {page === "keys" && <Keys />}
              {page === "settings" && <Settings theme={pref} onTheme={setPref} />}
            </motion.div>
          </AnimatePresence>
        </Layout>
      )}
      <Toaster position="bottom-right" theme={resolved} />
    </TooltipProvider>
  )
}

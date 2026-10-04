import type { ReactNode } from "react"
import { Activity, KeyRound, LayoutGrid, ListTree, LogOut, Moon, Server, Settings, Sun, SunMoon } from "lucide-react"

import { Segmented } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ThemePref } from "@/hooks/useTheme"

export type Page = "overview" | "nodes" | "requests" | "keys" | "settings"

export const PAGES: { value: Page; label: ReactNode }[] = [
  { value: "overview", label: <><LayoutGrid />总览</> },
  { value: "nodes", label: <><Server />节点</> },
  { value: "requests", label: <><ListTree />请求</> },
  { value: "keys", label: <><KeyRound />密钥</> },
  { value: "settings", label: <><Settings />设置</> },
]

const NEXT_THEME: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" }
const THEME_ICON = { light: <Sun />, dark: <Moon />, system: <SunMoon /> }
const THEME_LABEL = { light: "浅色", dark: "深色", system: "跟随系统" }

export function Layout({ page, onPage, status, theme, onTheme, onLogout, children }: {
  page: Page
  onPage: (p: Page) => void
  status: ReactNode
  theme: ThemePref
  onTheme: (t: ThemePref) => void
  onLogout: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-[60px] max-w-[1280px] items-center gap-4 px-6">
          <div className="flex items-center gap-2 text-lg font-black tracking-tight whitespace-nowrap">
            <Activity className="size-5 text-brand" />
            Strata Router
          </div>
          <nav className="ml-2 hidden md:block">
            <Segmented options={PAGES} value={page} onChange={onPage} />
          </nav>
          <div className="flex-1" />
          {status}
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => onTheme(NEXT_THEME[theme])} aria-label="切换主题" />}>
              {THEME_ICON[theme]}
            </TooltipTrigger>
            <TooltipContent>{THEME_LABEL[theme]}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={onLogout} aria-label="退出登录" />}>
              <LogOut />
            </TooltipTrigger>
            <TooltipContent>退出登录</TooltipContent>
          </Tooltip>
        </div>
        <nav className="overflow-x-auto px-4 pb-3 md:hidden">
          <Segmented options={PAGES} value={page} onChange={onPage} size="sm" />
        </nav>
      </header>
      <main className="mx-auto max-w-[1280px] px-6 py-8">{children}</main>
    </div>
  )
}

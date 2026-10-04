import type { ReactNode } from "react"
import { Activity, KeyRound, LayoutGrid, ListTree, LogOut, Moon, Server, Settings, Sun, SunMoon } from "lucide-react"

import { Segmented } from "@/components/st"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ThemePref } from "@/hooks/useTheme"
import { getLang, setLang, t } from "@/lib/i18n"

export type Page = "overview" | "nodes" | "requests" | "keys" | "settings"

const P = (value: Page, icon: ReactNode, zh: string, en: string) => ({ value, get label() { return <>{icon}{t(zh, en)}</> } })

export const PAGES: { value: Page; label: ReactNode }[] = [
  P("overview", <LayoutGrid />, "总览", "Overview"),
  P("nodes", <Server />, "节点", "Nodes"),
  P("requests", <ListTree />, "请求", "Requests"),
  P("keys", <KeyRound />, "密钥", "Keys"),
  P("settings", <Settings />, "设置", "Settings"),
]

const NEXT_THEME: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" }
const THEME_ICON = { light: <Sun />, dark: <Moon />, system: <SunMoon /> }
const THEME_LABEL = { light: ["浅色", "Light"], dark: ["深色", "Dark"], system: ["跟随系统", "System"] } as const

/** 语言切换：显示要切换到的语言 */
export function LangToggle() {
  const next = getLang() === "zh" ? "en" : "zh"
  return (
    <Button variant="ghost" size="sm" className="px-2 text-[13px] font-semibold" onClick={() => setLang(next)} aria-label={t("切换语言", "Switch language")}>
      {next === "en" ? "EN" : "中"}
    </Button>
  )
}

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
          <LangToggle />
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => onTheme(NEXT_THEME[theme])} aria-label={t("切换主题", "Toggle theme")} />}>
              {THEME_ICON[theme]}
            </TooltipTrigger>
            <TooltipContent>{t(THEME_LABEL[theme][0], THEME_LABEL[theme][1])}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={onLogout} aria-label={t("退出登录", "Log out")} />}>
              <LogOut />
            </TooltipTrigger>
            <TooltipContent>{t("退出登录", "Log out")}</TooltipContent>
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

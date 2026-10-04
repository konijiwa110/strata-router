import { useSyncExternalStore } from "react"

export type Lang = "zh" | "en"

const KEY = "strata-router-lang"
const listeners = new Set<() => void>()

let lang: Lang = (localStorage.getItem(KEY) as Lang | null) ?? (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en")
document.documentElement.lang = lang === "zh" ? "zh-CN" : "en"

export const getLang = () => lang

/** 按当前语言取文字：t("中文", "English") */
export const t = (zh: string, en: string) => (lang === "en" ? en : zh)

export function setLang(next: Lang) {
  lang = next
  localStorage.setItem(KEY, next)
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en"
  listeners.forEach((fn) => fn())
}

export function useLang() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => lang,
  )
}

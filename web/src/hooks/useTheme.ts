import { useEffect, useState } from "react"

export type ThemePref = "light" | "dark" | "system"
const KEY = "strata-cluster-theme"

function resolve(p: ThemePref) {
  return p === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : p
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref) || "system")
  const [resolved, setResolved] = useState(() => resolve(pref))

  useEffect(() => {
    const apply = () => {
      const r = resolve(pref)
      setResolved(r)
      document.documentElement.classList.toggle("dark", r === "dark")
    }
    apply()
    localStorage.setItem(KEY, pref)
    const mq = matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [pref])

  return { pref, setPref, resolved }
}

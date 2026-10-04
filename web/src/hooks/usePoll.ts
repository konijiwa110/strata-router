import { useCallback, useEffect, useRef, useState } from "react"

/** 定时拉取数据；页面不可见时暂停。 */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string>("")
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current())
      setError("")
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    setData(null)
    reload()
    const t = setInterval(() => document.visibilityState === "visible" && reload(), intervalMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, reload, ...deps])

  return { data, error, reload }
}

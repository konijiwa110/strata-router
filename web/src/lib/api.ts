const TOKEN = "strata-cluster-token"

export const session = {
  get: () => localStorage.getItem(TOKEN) ?? "",
  set: (t: string) => localStorage.setItem(TOKEN, t),
  clear: () => localStorage.removeItem(TOKEN),
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`/api/admin/${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${session.get()}`, "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = await r.json().catch(() => ({}))
  if (r.status === 401 && path !== "login") onUnauthorized()
  if (!r.ok) throw new ApiError(data?.error?.message ?? `请求失败（${r.status}）`, r.status)
  return data as T
}

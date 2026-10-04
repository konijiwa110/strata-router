/** Strata 风格基础组件：对应 Strata 网页 components.css 中的 pill / card / metric / progress / tabs / gauge。 */
import { motion } from "framer-motion"
import { useId, type ReactNode } from "react"

import { STATE, type Tone } from "@/lib/format"
import type { NodeState } from "@/lib/types"
import { cn } from "@/lib/utils"

const TONE: Record<Tone, { pill: string; dot: string; stroke: string; fill: string }> = {
  brand: { pill: "bg-brand-tint text-brand-text border-transparent", dot: "bg-brand", stroke: "var(--st-accent)", fill: "var(--st-accent-tint)" },
  info: { pill: "bg-info-tint text-info-text border-transparent", dot: "bg-info", stroke: "var(--st-info)", fill: "var(--st-info-tint)" },
  warn: { pill: "bg-warn-tint text-warn-text border-transparent", dot: "bg-warn", stroke: "var(--st-warn)", fill: "var(--st-warn-tint)" },
  danger: { pill: "bg-danger-tint text-danger-text border-transparent", dot: "bg-danger", stroke: "var(--st-danger)", fill: "var(--st-danger-tint)" },
  muted: { pill: "bg-surface-2 text-ink-muted border-line", dot: "bg-ink-muted", stroke: "var(--st-ink-muted)", fill: "var(--st-surface-2)" },
}

export function Pill({ tone = "muted", pulse, children, className }: { tone?: Tone; pulse?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold whitespace-nowrap", TONE[tone].pill, className)}>
      <span className="relative flex size-1.5">
        {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-70", TONE[tone].dot)} />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", TONE[tone].dot)} />
      </span>
      {children}
    </span>
  )
}

export function StatePill({ state }: { state: NodeState }) {
  const s = STATE[state]
  return <Pill tone={s.tone} pulse={state === "generating" || state === "reading"}>{s.label}</Pill>
}

export function StCard({ className, children, ...rest }: React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div
      className={cn("rounded-[20px] border border-line bg-surface p-5 shadow-card", className)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

export function CardTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3", className)}>
      <h3 className="text-base font-bold text-ink">{children}</h3>
      {actions}
    </div>
  )
}

export function Sparkline({ data, tone = "brand", height = 32, max }: { data: number[]; tone?: Tone; height?: number; max?: number }) {
  const pts = data.filter((v) => v != null && Number.isFinite(v))
  if (pts.length < 2) return <div style={{ height }} className="border-b border-line-soft" />
  const hi = max ?? Math.max(...pts, 1e-9)
  const w = 100
  const step = w / (pts.length - 1)
  const y = (v: number) => height - 2 - (Math.min(v, hi) / hi) * (height - 4)
  const line = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={TONE[tone].fill} opacity={0.8} />
      <path d={line} fill="none" stroke={TONE[tone].stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Metric({ icon, label, value, unit, sub, spark, tone = "brand", sparkMax, right }: {
  icon?: ReactNode
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  spark?: number[]
  tone?: Tone
  sparkMax?: number
  right?: ReactNode
}) {
  return (
    <StCard className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink-muted [&_svg]:size-4">
        {icon}
        {label}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="tabular text-[32px] leading-none font-black tracking-tight text-ink">
          {value}
          {unit && <span className="ml-1 text-sm font-medium text-ink-muted">{unit}</span>}
        </div>
        {right}
      </div>
      {sub && <div className="text-[13px] text-ink-muted">{sub}</div>}
      {spark && <div className="mt-auto pt-1"><Sparkline data={spark} tone={tone} max={sparkMax} /></div>}
    </StCard>
  )
}

export function Progress({ value, tone = "brand", indeterminate, className }: { value?: number; tone?: Tone; indeterminate?: boolean; className?: string }) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full border border-line-soft bg-surface-2", className)}>
      {indeterminate ? (
        <motion.div
          className="h-full w-1/3 rounded-full"
          style={{ background: TONE[tone].stroke }}
          animate={{ x: ["-100%", "300%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <motion.div
          className="h-full rounded-full"
          style={{ background: TONE[tone].stroke }}
          animate={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
        />
      )}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, size = "md" }: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  size?: "sm" | "md"
}) {
  const id = useId()
  return (
    <div className="inline-flex gap-1 rounded-[14px] border border-line bg-surface-2 p-1" role="tablist">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex items-center gap-2 rounded-[10px] px-3.5 font-medium whitespace-nowrap text-ink-muted transition-colors hover:text-ink [&_svg]:size-4",
              size === "md" ? "h-9 text-sm" : "h-7 px-3 text-[13px]",
              active && "font-bold text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={id}
                className="absolute inset-0 rounded-[10px] bg-surface shadow-card"
                transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
              />
            )}
            <span className="relative inline-flex items-center gap-2">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Gauge({ value, label, sub, tone = "brand", size = 140 }: { value: number; label: ReactNode; sub?: ReactNode; tone?: Tone; size?: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  const arc = c * 0.75
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-[225deg]">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--st-surface-2)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        <motion.circle
          cx="60" cy="60" r={r} fill="none" stroke={TONE[tone].stroke} strokeWidth="10" strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${c}` }}
          animate={{ strokeDasharray: `${arc * v} ${c}` }}
          transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="tabular text-2xl font-black text-ink">{label}</div>
        {sub && <div className="text-xs text-ink-muted">{sub}</div>}
      </div>
    </div>
  )
}

export function PageHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black tracking-tight text-ink">{title}</h1>
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ icon, title, action }: { icon?: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-ink-muted [&_svg]:size-8 [&_svg]:opacity-50">
      {icon}
      <div className="text-sm">{title}</div>
      {action}
    </div>
  )
}

export function KV({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-soft py-2.5 text-sm last:border-0">
      <span className="text-ink-muted">{label}</span>
      <span className={cn("tabular truncate text-right font-medium text-ink-soft", mono && "font-mono text-[13px]")}>{value}</span>
    </div>
  )
}

/** Strata 风格表格：表头小号大写灰字，行悬停浅底。 */
export function StTable({ head, children, className }: { head: { label: ReactNode; num?: boolean; className?: string }[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="tabular w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn("border-b border-line px-3 py-2.5 text-left text-xs font-medium tracking-wide whitespace-nowrap text-ink-muted", h.num && "text-right", h.className)}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:py-3 [&_td]:text-ink-soft [&_tr:last-child_td]:border-0 [&_tr:hover_td]:bg-surface-2">
          {children}
        </tbody>
      </table>
    </div>
  )
}

export const toneOf = (t: Tone) => TONE[t]

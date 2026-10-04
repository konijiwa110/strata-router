import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** 下拉选择：options 的 value 用 "all" 表示不限。 */
export function Choice({ value, onChange, options, className }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <Select items={options} value={value} onValueChange={(v) => onChange(String(v ?? "all"))}>
      <SelectTrigger className={cn("h-9 min-w-32 rounded-[10px] bg-surface", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

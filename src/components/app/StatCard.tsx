import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon, label, value, sub, tone = "default",
}: {
  icon: LucideIcon; label: string; value: string | number; sub?: string;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const toneCls = {
    default: "bg-accent text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-destructive/15 text-destructive",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className={cn("h-7 w-7 rounded-md grid place-items-center", toneCls)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

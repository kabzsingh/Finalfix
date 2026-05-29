import { Droplets, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

export function MeterCard({
  name,
  meterType,
  value,
  unit,
  capacity,
  lowThreshold,
  today,
  total,
}: {
  name: string;
  meterType: "wash" | "fresh_water" | "chemical";
  value: number;
  unit: string;
  capacity?: number | null;
  lowThreshold?: number | null;
  today?: number | null;
  total?: number | null;
}) {
  const Icon = meterType === "fresh_water" ? Droplets : Gauge;

  // Determine color based on meter type
  const typeColor =
    meterType === "wash"
      ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
      : meterType === "fresh_water"
        ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"
        : "bg-purple-500/15 text-purple-600 dark:text-purple-400";

  const typeBorder =
    meterType === "wash"
      ? "border-blue-200 dark:border-blue-800"
      : meterType === "fresh_water"
        ? "border-cyan-200 dark:border-cyan-800"
        : "border-purple-200 dark:border-purple-800";

  const typeLabel =
    meterType === "wash"
      ? "Wash"
      : meterType === "fresh_water"
        ? "Fresh Water"
        : "Chemical";

  const isWash = meterType === "wash";
  const fmt = (n: number) => (isWash ? Math.round(n).toLocaleString() : n.toFixed(1));
  const unitLabel = isWash ? "washes" : unit;

  // Calculate percentage if capacity exists
  const percentage =
    capacity && capacity > 0 ? (value / capacity) * 100 : null;

  // Check if value is low
  const isLow =
    lowThreshold !== null &&
    lowThreshold !== undefined &&
    value <= lowThreshold;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 shadow-card transition-all hover:shadow-glow",
        typeBorder
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            {typeLabel}
          </div>
          <div className="text-sm font-semibold truncate">{name}</div>
        </div>
        <div className={cn("h-8 w-8 rounded-md grid place-items-center", typeColor)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>

      {/* Value Display */}
      <div className="mb-3">
        <div className="text-2xl font-bold tabular-nums">
          {fmt(value)}
          <span className="text-xs text-muted-foreground ml-1">{unitLabel}</span>
        </div>
        {capacity && !isWash && (
          <div className="text-xs text-muted-foreground mt-1">
            Capacity: {capacity}
            {unit}
          </div>
        )}
      </div>

      {(today != null || total != null) && (
        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          {today != null && (
            <div className="rounded-md bg-secondary/60 px-2 py-1.5">
              <div className="text-muted-foreground">Today</div>
              <div className="font-semibold tabular-nums">{fmt(today)} {unitLabel}</div>
            </div>
          )}
          {total != null && (
            <div className="rounded-md bg-secondary/60 px-2 py-1.5">
              <div className="text-muted-foreground">Total</div>
              <div className="font-semibold tabular-nums">{fmt(total)} {unitLabel}</div>
            </div>
          )}
        </div>
      )}

      {/* Progress Bar (if capacity exists) */}
      {capacity && (
        <>
          <div className="h-2 rounded-full bg-secondary overflow-hidden mb-2">
            <div
              className={cn(
                "h-full transition-all",
                isLow ? "bg-destructive" : "bg-gradient-primary"
              )}
              style={{ width: `${Math.min(100, percentage || 0)}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {Math.round(percentage || 0)}% full
          </div>
        </>
      )}

      {/* Low Threshold Alert */}
      {isLow && (
        <div className="mt-3 px-2 py-1 bg-destructive/15 rounded text-xs font-medium text-destructive">
          ⚠ Low level alert
        </div>
      )}
    </div>
  );
}

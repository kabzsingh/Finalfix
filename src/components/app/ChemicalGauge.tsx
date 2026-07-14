export function ChemicalGauge({
  name, value, capacity, unit, threshold, isLowFlag, washesWhileLow,
}: {
  name: string;
  value: number;
  capacity?: number | null;
  unit: string;
  threshold?: number | null;
  isLowFlag?: boolean;        // true when the PLC flag register is ≥ 1
  washesWhileLow?: number;    // washes since chemical went low (undefined = not tracking)
}) {
  const pct =
    capacity && capacity > 0
      ? Math.max(0, Math.min(100, (value / capacity) * 100))
      : null;
  const lowPct = capacity && threshold ? (threshold / capacity) * 100 : 20;
  // isLowFlag takes priority (direct PLC signal); fall back to percentage check
  const isLow = isLowFlag ?? (pct !== null && pct <= lowPct);

  return (
    <div
      className={`rounded-lg border bg-card/60 p-3 ${
        isLow ? "border-destructive/50" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between text-sm gap-2">
        <span className="font-medium truncate">{name}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLow && (
            <span className="text-xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded">
              ⚠ CHEMICAL LOW
            </span>
          )}
          <span
            className={`tabular-nums text-xs ${
              isLow ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {value.toFixed(1)}
            {unit}
            {capacity ? ` / ${capacity}${unit}` : ""}
          </span>
        </div>
      </div>

      <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full transition-all ${
            isLow ? "bg-destructive" : "bg-gradient-primary"
          }`}
          style={{ width: `${pct ?? (isLow ? 0 : 100)}%` }}
        />
      </div>

      {/* Washes-since-low counter — only shown while chemical is low */}
      {isLow && washesWhileLow !== undefined && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive font-medium">
          <span>🚗</span>
          <span>
            Washes since empty:{" "}
            <span className="font-bold tabular-nums">{washesWhileLow}</span>
          </span>
        </div>
      )}
    </div>
  );
}

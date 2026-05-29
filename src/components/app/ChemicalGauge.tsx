export function ChemicalGauge({ name, value, capacity, unit, threshold }:
  { name: string; value: number; capacity?: number | null; unit: string; threshold?: number | null }) {
  const pct = capacity && capacity > 0 ? Math.max(0, Math.min(100, (value / capacity) * 100)) : null;
  const lowPct = capacity && threshold ? (threshold / capacity) * 100 : 20;
  const isLow = pct !== null && pct <= lowPct;
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium truncate">{name}</span>
        <span className={`tabular-nums text-xs ${isLow ? "text-destructive" : "text-muted-foreground"}`}>
          {value.toFixed(1)}{unit}{capacity ? ` / ${capacity}${unit}` : ""}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full transition-all ${isLow ? "bg-destructive" : "bg-gradient-primary"}`}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
    </div>
  );
}

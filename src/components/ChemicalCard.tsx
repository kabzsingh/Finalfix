import React from "react";

interface ChemicalCardProps {
  name: "MultiClean" | "Autowash" | "Wax";
  is_low: boolean;
  level_value: number;
  last_read_at?: string;
  recent_events?: Array<{
    went_low_at: string;
    washes_while_low: number;
  }>;
}

export function ChemicalCard({
  name,
  is_low,
  level_value,
  last_read_at,
  recent_events,
}: ChemicalCardProps) {
  const lastEvent = recent_events?.[0];

  return (
    <div
      className={`rounded-lg border-2 p-4 ${
        is_low
          ? "border-red-500 bg-red-50"
          : "border-green-500 bg-green-50"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-800">{name}</p>

          {is_low ? (
            <>
              <p className="mt-2 text-lg font-bold text-red-600">⚠️ LOW!</p>
              {lastEvent && (
                <div className="mt-2 text-sm text-gray-700">
                  <p className="text-xs text-gray-600">Went low at:</p>
                  <p className="font-mono text-xs">
                    {new Date(lastEvent.went_low_at).toLocaleString()}
                  </p>
                  <p className="mt-2 text-xs text-gray-600">
                    Last consumed:
                  </p>
                  <p className="text-lg font-bold text-orange-600">
                    {lastEvent.washes_while_low} washes
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mt-2 text-lg font-bold text-green-600">✓ OK</p>
              {lastEvent && (
                <div className="mt-2 text-xs text-gray-600">
                  Last low:{" "}
                  {new Date(lastEvent.went_low_at).toLocaleDateString()}
                </div>
              )}
            </>
          )}
        </div>
        <div className="text-4xl">
          {is_low ? "🔴" : "🟢"}
        </div>
      </div>

      {last_read_at && (
        <p className="mt-3 text-xs text-gray-500">
          Last read: {new Date(last_read_at).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

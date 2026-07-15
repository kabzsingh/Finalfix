import React from "react";

interface MeterCardProps {
  title: string;
  unit: string;
  total: number;
  today: number;
  icon?: React.ReactNode;
}

export function MeterCard({ title, unit, total, today, icon }: MeterCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <div className="mt-2 flex gap-6">
            <div>
              <p className="text-xs text-gray-500">Today</p>
              <p className="text-2xl font-bold text-blue-600">
                {today.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total</p>
              <p className="text-lg text-gray-800">
                {total.toLocaleString()}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">{unit}</p>
        </div>
        {icon && <div className="text-3xl text-gray-400">{icon}</div>}
      </div>
    </div>
  );
}

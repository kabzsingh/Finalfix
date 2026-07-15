import { MeterCard } from "@/components/MeterCard";
import { ChemicalCard } from "@/components/ChemicalCard";

export function Dashboard() {
  const [washCount, setWashCount] = useState({ total: 0, today: 0 });
  const [rinseWater, setRinseWater] = useState({ total: 0, today: 0 });
  const [recycled, setRecycled] = useState({ total: 0, today: 0 });
  const [chemicalStatus, setChemicalStatus] = useState({
    multiclean: { is_low: false, level_value: 1, last_read_at: null },
    autowash: { is_low: false, level_value: 1, last_read_at: null },
    wax: { is_low: false, level_value: 1, last_read_at: null },
  });
  const [chemicalEvents, setChemicalEvents] = useState([]);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Meters Section */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MeterCard
          title="Wash Count"
          unit="washes"
          today={washCount.today}
          total={washCount.total}
          icon="🚗"
        />
        <MeterCard
          title="Rinse Water"
          unit="liters"
          today={rinseWater.today}
          total={rinseWater.total}
          icon="💧"
        />
        <MeterCard
          title="Recycled"
          unit="liters"
          today={recycled.today}
          total={recycled.total}
          icon="♻️"
        />
      </div>

      {/* Chemicals Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Chemicals</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ChemicalCard
            name="MultiClean"
            is_low={chemicalStatus.multiclean.is_low}
            level_value={chemicalStatus.multiclean.level_value}
            last_read_at={chemicalStatus.multiclean.last_read_at}
            recent_events={chemicalEvents.filter(
              (e) => e.chemical_name === "MultiClean"
            )}
          />
          <ChemicalCard
            name="Autowash"
            is_low={chemicalStatus.autowash.is_low}
            level_value={chemicalStatus.autowash.level_value}
            last_read_at={chemicalStatus.autowash.last_read_at}
            recent_events={chemicalEvents.filter(
              (e) => e.chemical_name === "Autowash"
            )}
          />
          <ChemicalCard
            name="Wax"
            is_low={chemicalStatus.wax.is_low}
            level_value={chemicalStatus.wax.level_value}
            last_read_at={chemicalStatus.wax.last_read_at}
            recent_events={chemicalEvents.filter(
              (e) => e.chemical_name === "Wax"
            )}
          />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { closeAllGates, getOpenGates } from "../services/rtdbDataGate";

export default function DataGatePanel() {
  const [openGates, setOpenGates] = useState(getOpenGates());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setOpenGates(getOpenGates());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">RTDB Data Gate</div>
          <div className="text-xs text-slate-400">
            Default semua jalur tertutup. Data hanya diambil saat tombol Ambil Data ditekan.
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            closeAllGates();
            setOpenGates([]);
          }}
          className="rounded-lg border border-red-500/50 px-3 py-2 text-xs text-red-200 hover:bg-red-500/10"
        >
          Tutup Semua Jalur
        </button>
      </div>

      <div className="mt-3">
        {openGates.length === 0 ? (
          <div className="rounded-lg bg-slate-950/70 p-3 text-xs text-emerald-300">
            Semua jalur tertutup.
          </div>
        ) : (
          <div className="space-y-2">
            {openGates.map((gate) => (
              <div key={`${gate.key}-${gate.path}`} className="rounded-lg bg-slate-950/70 p-3 text-xs">
                <div className="font-medium text-amber-300">{gate.key}</div>
                <div className="mt-1 break-all text-slate-400">{gate.path}</div>
                <div className="mt-1 text-slate-500">
                  Mode: {gate.mode} • Dibuka: {new Date(gate.openedAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

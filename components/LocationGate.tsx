import type { ChangeEvent } from "react";

type LocationGateProps = {
  onShareLocation: () => void;
  manualLocationInput: string;
  onManualLocationChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSetManualLocation: () => void;
  errorMessage?: string | null;
};

export default function LocationGate({
  onShareLocation,
  manualLocationInput,
  onManualLocationChange,
  onSetManualLocation,
  errorMessage,
}: LocationGateProps) {
  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Share your location</h2>
          <p className="text-sm text-slate-500">
            FoodBuddy uses your location only to find nearby places.
          </p>
        </div>
        <button
          type="button"
          onClick={onShareLocation}
          className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          Use my current location
        </button>
      </div>
      <div className="mt-4 grid gap-3">
        <label className="text-xs font-semibold text-slate-500" htmlFor="manual-location">
          Enter neighborhood / landmark
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="manual-location"
            value={manualLocationInput}
            onChange={onManualLocationChange}
            placeholder="e.g., Downtown San Francisco"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          />
          <button
            type="button"
            onClick={onSetManualLocation}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            Set location
          </button>
        </div>
        {errorMessage && <p className="text-sm text-rose-600">{errorMessage}</p>}
      </div>
    </section>
  );
}

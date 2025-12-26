const DEFAULT_RADIUS_METERS = 1500;
const feedbackInactivityMinutes = Number(
  process.env.FEEDBACK_INACTIVITY_MINUTES ?? "30",
);

const formatBoolean = (value: string | undefined) =>
  value === "true" ? "Enabled" : "Disabled";

export default function AdminSettingsPage() {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">Settings</h2>
        <p className="text-sm text-slate-400">
          View current server configuration for the admin console.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-sm font-semibold text-slate-200">Active configuration</h3>
        <div className="mt-4 grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Google provider</p>
            <p className="mt-2">{process.env.GOOGLE_PROVIDER ?? "Not set"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Telegram</p>
            <p className="mt-2">{formatBoolean(process.env.ENABLE_TELEGRAM)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Feedback inactivity minutes
            </p>
            <p className="mt-2">
              {Number.isNaN(feedbackInactivityMinutes)
                ? "Not set"
                : feedbackInactivityMinutes}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Default radius
            </p>
            <p className="mt-2">{DEFAULT_RADIUS_METERS} meters</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm text-amber-100">
        Change these via Render environment variables and redeploy to apply updates.
      </div>
    </section>
  );
}

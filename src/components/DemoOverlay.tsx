import { useDemoStore } from "../lib/demo-runner";

export function DemoOverlay() {
  const { active, step, totalSteps, title, subtitle, progress } = useDemoStore();
  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-11 z-40 flex justify-center px-4">
      <div className="flex min-w-72 max-w-md flex-col gap-1.5 rounded-xl border border-white/12 bg-[#0f121c]/90 px-4 py-2.5 shadow-[0_14px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-all duration-300">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-300">
              {String(step).padStart(2, "0")}/{String(totalSteps).padStart(2, "0")}
            </span>
            <span className="text-xs font-semibold text-white">{title}</span>
          </div>
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
        </div>
        <p className="text-[11px] text-zinc-400">{subtitle}</p>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-linear-to-r from-violet-400 to-emerald-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
export default DemoOverlay;

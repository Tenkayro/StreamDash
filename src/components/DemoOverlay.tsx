import { useEffect } from "react";
import { useDemoStore } from "../lib/demo-runner";

export function DemoOverlay() {
  const { active, step, totalSteps, title, subtitle, progress, camera, cursor } =
    useDemoStore();

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>(".app-workspace");
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!workspace) return;

    if (!active) {
      workspace.style.transform = "";
      workspace.style.transformOrigin = "";
      workspace.style.transition = "";
      if (shell) shell.style.overflow = "";
      return;
    }

    if (shell) shell.style.overflow = "hidden";
    workspace.style.transition =
      "transform 750ms cubic-bezier(0.22, 1, 0.36, 1), transform-origin 750ms cubic-bezier(0.22, 1, 0.36, 1)";
    workspace.style.transformOrigin = `${camera.originX}% ${camera.originY}%`;
    workspace.style.transform = `scale(${camera.scale})`;

    return () => {
      workspace.style.transform = "";
      workspace.style.transformOrigin = "";
      workspace.style.transition = "";
      if (shell) shell.style.overflow = "";
    };
  }, [active, camera.originX, camera.originY, camera.scale]);

  if (!active) return null;

  return (
    <>
      {cursor.visible && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{
            transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0) scale(${cursor.clicking ? 0.86 : 1})`,
            transition:
              "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {cursor.rippleKey > 0 && (
            <span
              key={cursor.rippleKey}
              className="absolute -left-3 -top-3 size-7 animate-ping rounded-full border border-violet-400/70 bg-violet-400/20"
            />
          )}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="drop-shadow-[0_4px_10px_rgba(0,0,0,0.65)]"
          >
            <path
              d="M4.5 2.5L19.5 11.2L12.6 13.1L9.6 19.8L4.5 2.5Z"
              fill="#ffffff"
              stroke="#0f121c"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
        <div className="flex min-w-80 max-w-md flex-col gap-1.5 rounded-2xl border border-white/14 bg-[#0d1019]/92 px-4 py-2.5 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl transition-all duration-300">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-300">
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
    </>
  );
}
export default DemoOverlay;

import { useEffect } from "react";
import { useDemoStore } from "../lib/demo-runner";

export function DemoOverlay() {
  const { active, camera, cursor } = useDemoStore();

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
      "transform 820ms cubic-bezier(0.22, 1, 0.36, 1), transform-origin 820ms cubic-bezier(0.22, 1, 0.36, 1)";
    workspace.style.transformOrigin = `${camera.originX}% ${camera.originY}%`;
    workspace.style.transform = `scale(${camera.scale})`;

    return () => {
      workspace.style.transform = "";
      workspace.style.transformOrigin = "";
      workspace.style.transition = "";
      if (shell) shell.style.overflow = "";
    };
  }, [active, camera.originX, camera.originY, camera.scale]);

  if (!active || !cursor.visible) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{
        transform: `translate3d(${cursor.x - 5}px, ${cursor.y - 3}px, 0) scale(${cursor.clicking ? 0.84 : 1})`,
        transition: "transform 540ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {cursor.rippleKey > 0 && (
        <span
          key={cursor.rippleKey}
          className="pointer-events-none absolute -left-2 -top-2 size-7 rounded-full border-2 border-violet-400/90 bg-violet-400/25"
          style={{
            animation: "ping 420ms cubic-bezier(0, 0, 0.2, 1) 1 forwards",
          }}
        />
      )}
      <svg
        width="34"
        height="34"
        viewBox="0 0 28 28"
        fill="none"
        className="drop-shadow-[0_6px_14px_rgba(0,0,0,0.75)]"
      >
        <path
          d="M5 3L22.5 13.4L14.4 15.6L10.8 23.4L5 3Z"
          fill="#ffffff"
          stroke="#0b0d14"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
export default DemoOverlay;

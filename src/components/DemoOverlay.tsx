import { useDemoStore } from "../lib/demo-runner";

export function DemoOverlay() {
  const { active, cursor } = useDemoStore();
  if (!active || !cursor.visible) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{
        transform: `translate3d(${cursor.x - 5}px, ${cursor.y - 3}px, 0) scale(${cursor.clicking ? 0.84 : 1})`,
        transition: "transform 480ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {cursor.rippleKey > 0 && (
        <span
          key={cursor.rippleKey}
          className="pointer-events-none absolute -left-2.5 -top-2.5 size-8 rounded-full border-2 border-violet-400/90 bg-violet-400/25"
          style={{
            animation: "ping 420ms cubic-bezier(0, 0, 0.2, 1) 1 forwards",
          }}
        />
      )}
      <svg
        width="36"
        height="36"
        viewBox="0 0 28 28"
        fill="none"
        className="drop-shadow-[0_6px_16px_rgba(0,0,0,0.8)]"
      >
        <path
          d="M5 3L22.5 13.4L14.4 15.6L10.8 23.4L5 3Z"
          fill="#ffffff"
          stroke="#090b12"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
export default DemoOverlay;

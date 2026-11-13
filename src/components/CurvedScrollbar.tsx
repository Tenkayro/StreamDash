import { useEffect, useRef, useState, type RefObject } from "react";

const OFFSET = 6;
const EXTRA_INSET = 2;
const MIN_START_RATIO = 0.8;
const MIN_THUMB = 24;
const SEGMENTS = 50;

export function CurvedScrollbar({
  scrollerRef,
  radiusSourceRef,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  radiusSourceRef?: RefObject<HTMLElement | null>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const trackRef = useRef<SVGPathElement>(null);
  const thumbRef = useRef<SVGPathElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const svg = svgRef.current;
    const trackPath = trackRef.current;
    const thumbPath = thumbRef.current;
    if (!scroller || !svg || !trackPath || !thumbPath) return;

    scroller.classList.add("curved-scroll-host");

    let pathLength = 0;
    let thumbLength = 50;
    let dragging = false;
    let pointerId: number | null = null;

    const getRadius = (host: HTMLElement): number => {
      const explicit = radiusSourceRef?.current;
      const candidates = [explicit, host, host.parentElement, svg.parentElement];
      for (const el of candidates) {
        if (!el) continue;
        const r = parseFloat(getComputedStyle(el).borderRadius);
        if (Number.isFinite(r) && r > 0) return r;
      }
      return 14;
    };

    const updateThumb = () => {
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      if (maxScroll <= 2 || pathLength <= 0) {
        setScrollable(false);
        thumbPath.removeAttribute("d");
        return;
      }
      setScrollable(true);
      const scrollRatio = Math.max(0, Math.min(1, scroller.scrollTop / maxScroll));
      const startOffset = (pathLength - thumbLength) * scrollRatio;
      const endOffset = startOffset + thumbLength;

      const points: string[] = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = startOffset + ((endOffset - startOffset) / SEGMENTS) * i;
        const p = trackPath.getPointAtLength(t);
        points.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
      }
      thumbPath.setAttribute(
        "d",
        `M ${points[0]} ${points.slice(1).map((pt) => `L ${pt}`).join(" ")}`,
      );
    };

    const updatePath = () => {
      const host = svg.parentElement ?? scroller;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w <= OFFSET * 2 || h <= OFFSET * 2) return;

      const r = getRadius(host);
      const effectiveRadius = Math.max(Math.min(r - OFFSET, h / 2 - OFFSET, w / 2 - OFFSET), 0);
      const trackX = w - OFFSET;
      const topY = OFFSET;
      const bottomY = h - OFFSET;
      const cornerX = trackX - effectiveRadius;

      const minStartX = w * MIN_START_RATIO;
      let startX = trackX - effectiveRadius * EXTRA_INSET;
      if (startX < minStartX) startX = minStartX;
      if (startX > cornerX) startX = cornerX;

      const d = `
        M ${startX} ${topY}
        L ${cornerX} ${topY}
        A ${effectiveRadius} ${effectiveRadius} 0 0 1 ${trackX} ${topY + effectiveRadius}
        L ${trackX} ${bottomY - effectiveRadius}
        A ${effectiveRadius} ${effectiveRadius} 0 0 1 ${cornerX} ${bottomY}
        L ${startX} ${bottomY}
      `;
      trackPath.setAttribute("d", d);

      pathLength = trackPath.getTotalLength();
      const ratio = scroller.scrollHeight > 0 ? scroller.clientHeight / scroller.scrollHeight : 1;
      thumbLength = Math.max(MIN_THUMB, Math.min(pathLength, pathLength * ratio));

      updateThumb();
    };

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      pointerId = e.pointerId;
      thumbPath.setPointerCapture(pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const host = svg.parentElement ?? scroller;
      const rect = host.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
      scroller.scrollTop = ratio * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      updateThumb();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      try {
        thumbPath.releasePointerCapture(pointerId);
      } catch {
        // Ignore release errors
      }
      pointerId = null;
    };

    thumbPath.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    scroller.addEventListener("scroll", updateThumb, { passive: true });
    window.addEventListener("resize", updatePath);

    const resizeObs = new ResizeObserver(updatePath);
    resizeObs.observe(scroller);
    if (svg.parentElement && svg.parentElement !== scroller) {
      resizeObs.observe(svg.parentElement);
    }

    const mutObs = new MutationObserver(updatePath);
    mutObs.observe(scroller, { childList: true, subtree: true });

    updatePath();

    return () => {
      scroller.classList.remove("curved-scroll-host");
      thumbPath.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      scroller.removeEventListener("scroll", updateThumb);
      window.removeEventListener("resize", updatePath);
      resizeObs.disconnect();
      mutObs.disconnect();
    };
  }, [radiusSourceRef, scrollerRef]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      className={`curved-scrollbar-svg ${scrollable ? "opacity-100" : "opacity-0"}`}
    >
      <path ref={trackRef} className="curved-scrollbar-track" />
      <path ref={thumbRef} className="curved-scrollbar-thumb" />
    </svg>
  );
}

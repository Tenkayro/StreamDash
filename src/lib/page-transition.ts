import { flushSync } from "react-dom";

type ViewTransition = { finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransition;
};

/**
 * Applies a navigation update and cross-fades the old page into the new one
 * using the View Transitions API. Falls back to an instant switch when the
 * platform does not support it or when animations are turned off.
 */
export function withPageTransition(update: () => void, animated: boolean) {
  const doc = document as ViewTransitionDocument;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (!animated || reducedMotion || typeof doc.startViewTransition !== "function") {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

/**
 * Applies a navigation update instantly. No cross-fade, no blocking,
 * so rapid page switches feel snappy.
 */
export function withPageTransition(update: () => void, _animated: boolean) {
  update();
}

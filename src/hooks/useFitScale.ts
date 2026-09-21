import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Scales down a ref'd element (via CSS transform, not font-size) so its
 * natural content fits inside its parent container, without ever scaling
 * above 1. `transform` doesn't affect scrollWidth/scrollHeight, so the
 * unscaled content size stays measurable across re-renders.
 *
 * Uses a ResizeObserver on the content element rather than a one-shot
 * measurement: web fonts (e.g. Lato, loaded with `display=swap`) can finish
 * downloading and reflow the text to a different width *after* the initial
 * layout effect runs, and a plain effect keyed on `deps` would never
 * re-measure for that.
 */
export const useFitScale = <T extends HTMLElement>(
  deps: unknown[]
): { ref: React.RefObject<T>; scale: number } => {
  const ref = useRef<T>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (el === null || parent === null || parent === undefined) return;

    const measure = (): void => {
      const { scrollWidth, scrollHeight } = el;
      const { clientWidth, clientHeight } = parent;
      if (scrollWidth === 0 || scrollHeight === 0) return;
      setScale(
        Math.min(1, clientWidth / scrollWidth, clientHeight / scrollHeight)
      );
    };

    measure();

    // transform:scale() doesn't affect layout size, so this only fires on
    // genuine content-size changes (font swap, text changes), not our own
    // scale updates - no feedback loop. jsdom (used by the test suite)
    // doesn't implement ResizeObserver, so skip it there.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, deps);

  return { ref, scale };
};

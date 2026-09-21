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

    // jsdom (the test suite) doesn't implement ResizeObserver - measure
    // synchronously there instead, since nothing else will.
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return;
    }

    // Deliberately NOT calling measure() synchronously here: ResizeObserver
    // already delivers an initial measurement for every newly-observed
    // element, batched asynchronously across all observers in one pass by
    // the browser. A synchronous scrollWidth/clientWidth read forces the
    // browser to flush pending layout first - with many cards mounting at
    // once (e.g. a large self-cross), doing that once per card back-to-back
    // turns into a chain of forced synchronous reflows that blocks the main
    // thread before the first paint. Letting ResizeObserver's own async,
    // batched initial callback do the first measurement avoids that, at the
    // cost of one frame at scale 1 before content snaps to its fitted size.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, deps);

  return { ref, scale };
};

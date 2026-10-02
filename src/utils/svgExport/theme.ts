export interface ThemeColors {
  cardBackground: string; // bg-base-100
  lethalCardBackground: string; // cardBackground blended toward contentText by LETHAL_CARD_MIX (matches StrainCard's overlay)
  contentText: string; // text-base-content
  probabilityText: string; // text-accent
  selfNodeBackground: string; // bg-secondary
  xNodeBackground: string; // bg-primary
  middleNodeIcon: string; // text-primary-content
  canvasBackground: string; // bg-base-300 (the react-flow dot-pattern backdrop)
  edgeStroke: string; // opaque rgb(...), matches .react-flow__edge-path's hue
  edgeStrokeOpacity: number; // matches .react-flow__edge-path's hsla(var(--bc)/0.3) alpha
}

// getComputedStyle always returns rgb()/rgba() (never hex or named colors),
// so this only ever needs to handle those two forms.
const splitRgba = (color: string): { rgb: string; alpha: number } => {
  const match = /rgba?\(([^)]+)\)/.exec(color);
  if (match === null) return { rgb: color, alpha: 1 };
  const parts = match[1].split(',').map((p) => p.trim());
  const [r, g, b, a] = parts;
  return {
    rgb: `rgb(${r}, ${g}, ${b})`,
    alpha: a === undefined ? 1 : Number(a),
  };
};

// How far a lethal card's background is pulled from the card color toward the
// theme's text color. Must match the alpha of the overlay StrainCard.tsx
// paints (hsl(var(--bc)/0.2) over bg-base-100). Blending toward base-content
// rather than darkening: it darkens a light theme's card and lightens a dark
// theme's, so the card stays distinguishable in both (near-black dark cards
// have no room to get darker).
export const LETHAL_CARD_MIX = 0.2;

export const blendRgb = (from: string, to: string, amount: number): string => {
  const channels = (color: string): number[] =>
    (/rgba?\(([^)]+)\)/.exec(color)?.[1] ?? '0,0,0')
      .split(',')
      .slice(0, 3)
      .map(Number);
  const [fr, fg, fb] = channels(from);
  const [tr, tg, tb] = channels(to);
  const mix = (a: number, b: number): number =>
    Math.round(a * (1 - amount) + b * amount);
  return `rgb(${mix(fr, tr)}, ${mix(fg, tg)}, ${mix(fb, tb)})`;
};

// Reads real computed colors from the currently active daisyUI theme (one of
// 29 enabled themes - no per-theme palette to keep in sync) by creating tiny
// offscreen elements with the exact same Tailwind classes already used
// on-screen, reading their computed style, then discarding them. Same
// technique already used elsewhere in this app for sampling the canvas
// background color before this export existed.
export const sampleThemeColors = (): ThemeColors => {
  const probe = (
    className: string,
    prop: 'color' | 'backgroundColor'
  ): string => {
    const el = document.createElement('div');
    el.className = className;
    el.style.position = 'fixed';
    el.style.top = '-9999px';
    el.style.left = '-9999px';
    document.body.append(el);
    const value = getComputedStyle(el)[prop];
    el.remove();
    return value;
  };

  // Matches .react-flow__edge-path's hsla(var(--bc)/0.3) rule. Split into an
  // opaque rgb() plus a separate stroke-opacity, rather than emitting the
  // sampled rgba(...) string directly as `stroke` - Illustrator's SVG import
  // doesn't reliably parse the CSS rgba() function in a raw presentation
  // attribute and silently drops the whole edge (confirmed against a real
  // exported file: every edge was entirely absent when opened in
  // Illustrator, despite rendering fine in Chrome).
  const edge = splitRgba(probe('text-base-content/30', 'color'));

  const cardBackground = probe('bg-base-100', 'backgroundColor');
  const contentText = probe('text-base-content', 'color');

  return {
    cardBackground,
    lethalCardBackground: blendRgb(
      cardBackground,
      contentText,
      LETHAL_CARD_MIX
    ),
    contentText,
    probabilityText: probe('text-accent', 'color'),
    selfNodeBackground: probe('bg-secondary', 'backgroundColor'),
    xNodeBackground: probe('bg-primary', 'backgroundColor'),
    middleNodeIcon: probe('text-primary-content', 'color'),
    canvasBackground: probe('bg-base-300', 'backgroundColor'),
    edgeStroke: edge.rgb,
    edgeStrokeOpacity: edge.alpha,
  };
};

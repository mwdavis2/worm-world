import { parse, type Font } from 'opentype.js';
// The same self-hosted Lato files already bundled via @fontsource/lato
// (src/main.tsx) - reused here so the export needs no separate font asset.
// Using the plain .woff (zlib) files, not .woff2 (brotli) - opentype.js only
// decompresses WOFF1 natively; WOFF2 throws "require an external
// decompressor library" (confirmed via a real parse attempt, not assumed).
// `?url` gets Vite to resolve this to a real, build-safe asset URL (hashed
// and copied into dist/assets/ for the production Tauri build) rather than a
// raw node_modules path that would only work in dev.
import REGULAR_FONT_URL from '@fontsource/lato/files/lato-latin-400-normal.woff?url';
import BOLD_FONT_URL from '@fontsource/lato/files/lato-latin-700-normal.woff?url';

export type FontWeight = 'normal' | 'bold';

export interface TextRenderer {
  measureWidth: (
    text: string,
    fontSizePx: number,
    weight: FontWeight
  ) => number;
  // Returns ready-to-embed SVG markup (one <path> per character, each
  // positioned via its own transform) for `text` baseline-positioned at
  // (x, y) in the given color.
  glyphMarkup: (
    text: string,
    x: number,
    y: number,
    fontSizePx: number,
    weight: FontWeight,
    color: string
  ) => string;
}

const loadFont = async (url: string): Promise<Font> => {
  const buffer = await (await fetch(url)).arrayBuffer();
  return parse(buffer);
};

// Loads both Lato weights once up front - every subsequent call is
// synchronous, since opentype.js can compute glyph outlines directly from an
// already-parsed Font with no further I/O.
export const createTextRenderer = async (): Promise<TextRenderer> => {
  const [regular, bold] = await Promise.all([
    loadFont(REGULAR_FONT_URL),
    loadFont(BOLD_FONT_URL),
  ]);
  const fonts: Record<FontWeight, Font> = { normal: regular, bold };

  return {
    measureWidth: (text, fontSizePx, weight) =>
      fonts[weight].getAdvanceWidth(text, fontSizePx),
    glyphMarkup: (text, x, y, fontSizePx, weight, color) => {
      const font = fonts[weight];
      let cursorX = x;
      const parts: string[] = [];
      for (const ch of text) {
        // Always ask opentype.js for the glyph's path at the origin, then
        // position it via an SVG transform - passing certain non-zero
        // (x, y) values directly into getPath() triggers a floating-point
        // bug in opentype.js that occasionally emits NaN coordinates for
        // specific (glyph, position) combinations (reproduced directly
        // against this app's own allele/gene name strings). The origin is
        // always safe; the transform math is ours, not opentype.js's.
        const d = font.getPath(ch, 0, 0, fontSizePx).toPathData(2);
        parts.push(
          `<path d="${d}" fill="${color}" transform="translate(${cursorX}, ${y})" />`
        );
        cursorX += font.getAdvanceWidth(ch, fontSizePx);
      }
      return parts.join('');
    },
  };
};

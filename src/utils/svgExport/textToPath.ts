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

// 'text' emits real <text> elements (one per label, editable/selectable in a
// vector editor, but dependent on whatever font the viewer resolves - see the
// fallback stack in svgExport.ts's <style> block). 'textPath' emits one <path>
// glyph outline per character (today's original behavior) - pixel-perfect
// regardless of installed fonts, but not editable as text.
export type TextExportMode = 'text' | 'textPath';

export interface TextRenderer {
  measureWidth: (
    text: string,
    fontSizePx: number,
    weight: FontWeight
  ) => number;
  // Left-anchored: baseline starts at (x, y).
  glyphMarkup: (
    text: string,
    x: number,
    y: number,
    fontSizePx: number,
    weight: FontWeight,
    color: string
  ) => string;
  // Center-anchored: baseline centered at (centerX, y). In 'text' mode this
  // uses the SVG renderer's own text-anchor="middle" rather than subtracting
  // half of our own measured width, since a fallback font's metrics may not
  // match Lato's - letting the viewer center with its own metrics is correct
  // regardless of which font actually resolves.
  centeredGlyphMarkup: (
    text: string,
    centerX: number,
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

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const EXPORT_TEXT_CLASS = 'ww-export-text';

// Loads both Lato weights once up front - every subsequent call is
// synchronous, since opentype.js can compute glyph outlines directly from an
// already-parsed Font with no further I/O. Loaded regardless of mode, since
// layout math (column widths, shrink-to-fit scale) must stay font-metric
// driven either way - SVG layout can't be re-flowed after the fact based on
// whatever font a viewer's 'text' mode ends up actually rendering with.
export const createTextRenderer = async (
  mode: TextExportMode
): Promise<TextRenderer> => {
  const [regular, bold] = await Promise.all([
    loadFont(REGULAR_FONT_URL),
    loadFont(BOLD_FONT_URL),
  ]);
  const fonts: Record<FontWeight, Font> = { normal: regular, bold };

  const measureWidth = (
    text: string,
    fontSizePx: number,
    weight: FontWeight
  ): number => fonts[weight].getAdvanceWidth(text, fontSizePx);

  if (mode === 'text') {
    const fontWeightNumber = (weight: FontWeight): number =>
      weight === 'bold' ? 700 : 400;
    return {
      measureWidth,
      glyphMarkup: (text, x, y, fontSizePx, weight, color) =>
        `<text x="${x}" y="${y}" font-size="${fontSizePx}" font-weight="${fontWeightNumber(
          weight
        )}" fill="${color}" class="${EXPORT_TEXT_CLASS}">${escapeXml(
          text
        )}</text>`,
      centeredGlyphMarkup: (text, centerX, y, fontSizePx, weight, color) =>
        `<text x="${centerX}" y="${y}" text-anchor="middle" font-size="${fontSizePx}" font-weight="${fontWeightNumber(
          weight
        )}" fill="${color}" class="${EXPORT_TEXT_CLASS}">${escapeXml(
          text
        )}</text>`,
    };
  }

  const glyphMarkup = (
    text: string,
    x: number,
    y: number,
    fontSizePx: number,
    weight: FontWeight,
    color: string
  ): string => {
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
  };

  return {
    measureWidth,
    glyphMarkup,
    centeredGlyphMarkup: (text, centerX, y, fontSizePx, weight, color) => {
      const width = measureWidth(text, fontSizePx, weight);
      return glyphMarkup(
        text,
        centerX - width / 2,
        y,
        fontSizePx,
        weight,
        color
      );
    },
  };
};

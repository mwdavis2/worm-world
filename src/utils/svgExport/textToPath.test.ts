import { readFileSync } from 'fs';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { createTextRenderer } from './textToPath';

beforeAll(() => {
  const regular = readFileSync(
    'node_modules/@fontsource/lato/files/lato-latin-400-normal.woff'
  );
  const bold = readFileSync(
    'node_modules/@fontsource/lato/files/lato-latin-700-normal.woff'
  );
  const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      arrayBuffer: async () =>
        toArrayBuffer(url.includes('700') ? bold : regular),
    }))
  );
});

// How many numbers each SVG path command takes.
const ARGS: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };

// Reads path data the strict way a parser like Illustrator's does: a number
// ends at a space, a sign, or a second decimal point - it does NOT end
// between two digits. Returns the number of numbers each command received.
const argumentCounts = (d: string): number[] =>
  (d.match(/[MLQCZ][^MLQCZ]*/g) ?? []).map(
    (segment) => (segment.slice(1).match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).length
  );

describe('glyph outlines in textPath mode', () => {
  // Regression: opentype.js's toPathData() wrote "2.120" for the pair
  // (2.12, 0) in some glyphs, so Illustrator dropped "a", ";" and ",".
  test.each(['normal', 'bold'] as const)(
    'every printable character has well-formed path data (%s)',
    async (weight) => {
      const renderer = await createTextRenderer('textPath');
      const printable = Array.from({ length: 95 }, (_, i) =>
        String.fromCharCode(32 + i)
      );
      for (const ch of printable) {
        if (ch === ' ') continue;
        const markup = renderer.glyphMarkup(ch, 0, 0, 16, weight, '#000');
        const d = /d="([^"]*)"/.exec(markup)?.[1] ?? '';
        const commands = d.match(/[MLQCZ]/g) ?? [];
        const counts = argumentCounts(d);
        expect(counts.length, `${ch}: command count`).toBe(commands.length);
        counts.forEach((count, i) => {
          expect(count, `${ch}: arguments of command ${commands[i]}`).toBe(
            ARGS[commands[i]]
          );
        });
      }
    }
  );

  test('the glyphs that used to break come out with every number separated', async () => {
    const renderer = await createTextRenderer('textPath');
    for (const ch of ['a', ';', ',']) {
      const markup = renderer.glyphMarkup(ch, 0, 0, 16, 'normal', '#000');
      expect(markup).not.toContain('2.120');
      expect(markup).toMatch(/d="M/);
    }
  });
});

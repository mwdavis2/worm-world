import { readFileSync } from 'fs';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { simpleCrossDesign } from 'models/frontend/CrossDesign/CrossDesign.mock';
import { NodeType } from 'models/enums';
import { buildCrossDesignSvg } from './svgExport';

// opentype.js needs real font bytes - serve the actual bundled Lato files
// from disk regardless of the requested URL, sidestepping any Vite ?url
// asset-resolution quirks under vitest/jsdom.
beforeAll(() => {
  const regularBuffer = readFileSync(
    'node_modules/@fontsource/lato/files/lato-latin-400-normal.woff'
  );
  const boldBuffer = readFileSync(
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
        toArrayBuffer(url.includes('700') ? boldBuffer : regularBuffer),
    }))
  );
});

describe('buildCrossDesignSvg', () => {
  test('produces well-formed SVG for a simple cross design', async () => {
    const svgString = await buildCrossDesignSvg(
      simpleCrossDesign.nodes,
      simpleCrossDesign.edges,
      'default',
      true
    );

    expect(svgString.startsWith('<svg')).toBe(true);

    const parsed = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();

    // background rect + 3 strain cards
    expect(parsed.querySelectorAll('rect').length).toBeGreaterThanOrEqual(4);
    // the X middle node
    expect(parsed.querySelectorAll('circle').length).toBe(1);
    // icons, edges, and glyph outlines all render as <path>
    expect(parsed.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  test('produces an empty-but-valid SVG when there is nothing to export', async () => {
    const svgString = await buildCrossDesignSvg([], [], 'straight', true);

    expect(svgString.startsWith('<svg')).toBe(true);
    const parsed = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
  });

  // Regression test: opentype.js has a floating-point bug where passing
  // certain non-zero (x, y) coordinates directly into getPath() produces
  // NaN in the resulting path data for specific (glyph, position)
  // combinations - reproduced directly against real allele/gene name
  // strings from this app (e.g. "unc-119(ed3)"). textToPath.ts works around
  // this by always rendering glyphs at the origin and positioning via an
  // SVG transform instead - this test guards against that regressing.
  test('never emits NaN in any generated path data', async () => {
    const svgString = await buildCrossDesignSvg(
      simpleCrossDesign.nodes,
      simpleCrossDesign.edges,
      'default',
      true
    );
    expect(svgString).not.toContain('NaN');
  });

  // Regression test: a node with a parentNode stores `position` RELATIVE to
  // that parent (a real react-flow sub-flow feature this app relies on for
  // self-cross/mated-cross children) - confirmed directly against a real
  // saved design, where treating a child's position as already-absolute
  // placed it on top of an entirely unrelated, distant cluster. The fix
  // walks the parentNode chain and sums offsets; this pins the exact
  // expected pixel result for a two-level chain.
  test('resolves a parentNode chain to the correct absolute position', async () => {
    const parent = {
      id: 'parent',
      type: NodeType.Note,
      data: 'parent note',
      position: { x: 100, y: 200 },
    };
    const child = {
      id: 'child',
      type: NodeType.Note,
      data: 'child note',
      position: { x: 10, y: 20 },
      parentNode: 'parent',
    };
    const svgString = await buildCrossDesignSvg(
      [parent, child],
      [],
      'default',
      true
    );
    const parsed = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    const rects = [...parsed.querySelectorAll('rect')]
      .map((r) => ({
        x: Number(r.getAttribute('x')),
        y: Number(r.getAttribute('y')),
      }))
      .filter((r) => r.x !== undefined);

    // background rect + parent note (100,200) + child note, which should
    // resolve to (100+10, 200+20) = (110, 220), NOT the raw (10, 20).
    expect(rects).toContainEqual({ x: 100, y: 200 });
    expect(rects).toContainEqual({ x: 110, y: 220 });
  });
});

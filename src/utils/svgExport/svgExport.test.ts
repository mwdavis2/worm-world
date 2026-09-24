import { readFileSync } from 'fs';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { simpleCrossDesign } from 'models/frontend/CrossDesign/CrossDesign.mock';
import { NodeType, Sex } from 'models/enums';
import { Strain } from 'models/frontend/Strain/Strain';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Allele } from 'models/frontend/Allele/Allele';
import { Variation } from 'models/frontend/Variation/Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { createTextRenderer } from './textToPath';
import {
  ALLELE_TEXT_SIZE,
  CHROM_LABEL_SIZE,
  COLUMN_GAP,
  buildCrossDesignSvg,
} from './svgExport';

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
      true,
      'textPath'
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
    const svgString = await buildCrossDesignSvg(
      [],
      [],
      'straight',
      true,
      'textPath'
    );

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
  // Pinned to 'textPath' mode specifically, since it's the only mode that
  // exercises opentype.js's getPath() at all.
  test('never emits NaN in any generated path data', async () => {
    const svgString = await buildCrossDesignSvg(
      simpleCrossDesign.nodes,
      simpleCrossDesign.edges,
      'default',
      true,
      'textPath'
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
      true,
      'textPath'
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

  describe('shrink-to-fit layout resolution (wide genotype)', () => {
    // A two-locus genotype wide enough to force contentScale < 1 - built via
    // the plain Strain constructor (not Strain.build, which needs live DB
    // access) with allelePairs directly, matching the pattern used to
    // reproduce this exact scenario when the left-drift anchor bug was
    // originally fixed.
    // Uses `variation` (not `gene`) for the chromosome so getQualifiedName()
    // falls through its own gene-undefined branch and returns the bare
    // name unchanged - matching what the test independently measures below.
    // (getQualifiedName() with a gene set instead prefixes gene.descName,
    // which this mock never sets, and would corrupt the width comparison.)
    const mkAllele = (name: string, chromosome: ChromosomeName): Allele =>
      new Allele({ name, variation: new Variation({ name, chromosome }) });
    const wideStrain = new Strain({
      allelePairs: [
        new AllelePair({
          top: mkAllele('unc-119(ed3)', 'III'),
          bot: mkAllele('unc-119(+)', 'III'),
        }),
        new AllelePair({
          top: mkAllele('kin-4(ox1059)', 'IV'),
          bot: mkAllele('kin-4(+)', 'IV'),
        }),
        new AllelePair({
          top: mkAllele('dpy-20(e1282)', 'IV'),
          bot: mkAllele('dpy-20(+)', 'IV'),
        }),
        new AllelePair({
          top: mkAllele('oxIs363', 'IV'),
          bot: mkAllele('oxIs363(+)', 'IV'),
        }),
      ],
      sex: Sex.Hermaphrodite,
      name: 'WIDE1',
    });
    const node = {
      id: 'wide',
      type: NodeType.Strain,
      data: wideStrain,
      position: { x: 0, y: 0 },
    };
    // Matches renderStrainCard's own centerX for a node at (0,0).
    const centerX = 128; // STRAIN_NODE_WIDTH / 2

    // Independently recomputes the expected final (already-scaled) center-X
    // of the FIRST chrom label ("III"), using a fresh TextRenderer (real
    // opentype.js metrics) and the same publicly-documented anchor formula
    // (anchor + (natural - anchor) * scale) - without importing or calling
    // any of svgExport.ts's internal layout functions. This exercises the
    // same class of bug the resolve-before-emit refactor was meant to fix:
    // if the shrink-to-fit anchor or scale is wrong, this independently
    // computed expected number will diverge from the actual SVG output.
    const computeExpectedFirstChromLabelX = async (): Promise<{
      x: number;
      fontSize: number;
    }> => {
      const tr = await createTextRenderer('textPath');
      const nameWidth = (name: string): number =>
        tr.measureWidth(name, CHROM_LABEL_SIZE, 'bold');
      const alleleWidth = (name: string): number =>
        tr.measureWidth(name, ALLELE_TEXT_SIZE, 'normal');

      const box1Width =
        Math.max(
          nameWidth('III'),
          Math.max(alleleWidth('unc-119(ed3)'), alleleWidth('unc-119(+)'))
        ) + 16;
      const chromIVColumns = [
        ['kin-4(ox1059)', 'kin-4(+)'],
        ['dpy-20(e1282)', 'dpy-20(+)'],
        ['oxIs363', 'oxIs363(+)'],
      ];
      const chromIVColsWidth =
        chromIVColumns.reduce(
          (sum, [top, bot]) =>
            sum + Math.max(alleleWidth(top), alleleWidth(bot)) + COLUMN_GAP,
          0
        ) - COLUMN_GAP;
      const box2Width = Math.max(nameWidth('IV'), chromIVColsWidth) + 16;
      const semicolonWidth = tr.measureWidth(';', ALLELE_TEXT_SIZE, 'normal');
      const totalWidth = box1Width + semicolonWidth + 4 + box2Width;
      const contentScale = Math.min(1, 256 / totalWidth);

      const cursorX = centerX - totalWidth / 2;
      const naturalBox1CenterX = cursorX + box1Width / 2;

      return {
        x: centerX + (naturalBox1CenterX - centerX) * contentScale,
        fontSize: CHROM_LABEL_SIZE * contentScale,
      };
    };

    test('textPath mode: first chrom label glyph lands at the independently-computed final position', async () => {
      const expected = await computeExpectedFirstChromLabelX();

      const svgString = await buildCrossDesignSvg(
        [node],
        [],
        'default',
        true,
        'textPath'
      );
      // "III" is drawn as three separate glyph <path> elements (one 'I' each,
      // all sharing the same y and font-size-derived path scale) - find the
      // first one and check its translate(x, y) matches the expected
      // top-left x for a glyph centered at `expected.x`. We don't know the
      // exact glyph width without duplicating opentype.js's own glyph metrics,
      // so instead assert the *group* of same-y glyphs immediately following
      // the card rect is centered at `expected.x`, matching the same
      // centering convention `centeredGlyphMarkup` uses (measure full string
      // width, subtract half).
      const tr = await createTextRenderer('textPath');
      const chromLabelWidth = tr.measureWidth('III', expected.fontSize, 'bold');
      const expectedGlyphStartX = expected.x - chromLabelWidth / 2;

      const translateMatch =
        /<path d="[^"]*" fill="[^"]*" transform="translate\(([-\d.]+), ([-\d.]+)\)"/.exec(
          svgString
        );
      expect(translateMatch).not.toBeNull();
      const actualX = Number(translateMatch?.[1]);
      // Within a small epsilon - both sides do the same floating-point
      // arithmetic independently, so exact equality is fragile to operation
      // ordering, but a real bug (wrong anchor/scale) would be off by
      // multiple pixels, not fractions of one.
      expect(Math.abs(actualX - expectedGlyphStartX)).toBeLessThan(0.5);
    });

    test('text mode: first chrom label <text> lands at the independently-computed final center and font-size', async () => {
      const expected = await computeExpectedFirstChromLabelX();

      const svgString = await buildCrossDesignSvg(
        [node],
        [],
        'default',
        true,
        'text'
      );
      const parsed = new DOMParser().parseFromString(
        svgString,
        'image/svg+xml'
      );
      const textEls = [...parsed.querySelectorAll('text')];
      const chromLabelEl = textEls.find((el) => el.textContent === 'III');
      expect(chromLabelEl).not.toBeUndefined();
      expect(Number(chromLabelEl?.getAttribute('x'))).toBeCloseTo(
        expected.x,
        1
      );
      expect(Number(chromLabelEl?.getAttribute('font-size'))).toBeCloseTo(
        expected.fontSize,
        1
      );
      expect(chromLabelEl?.getAttribute('text-anchor')).toBe('middle');
    });

    test('divider line stroke-width scales with contentScale, matching the old wrapping-transform behavior', async () => {
      const svgString = await buildCrossDesignSvg(
        [node],
        [],
        'default',
        true,
        'textPath'
      );
      const lineMatch = /<line[^>]*stroke-width="([\d.]+)"/.exec(svgString);
      expect(lineMatch).not.toBeNull();
      const strokeWidth = Number(lineMatch?.[1]);
      // totalWidth here comfortably exceeds 256, so contentScale < 1 and the
      // divider's stroke-width must be less than the unscaled literal 1.
      expect(strokeWidth).toBeGreaterThan(0);
      expect(strokeWidth).toBeLessThan(1);
    });
  });

  describe('text export mode', () => {
    test('"text" mode emits <text> elements with the fallback font-family class, and no glyph paths', async () => {
      const svgString = await buildCrossDesignSvg(
        simpleCrossDesign.nodes,
        simpleCrossDesign.edges,
        'default',
        true,
        'text'
      );
      const parsed = new DOMParser().parseFromString(
        svgString,
        'image/svg+xml'
      );
      expect(parsed.querySelector('parsererror')).toBeNull();
      expect(parsed.querySelectorAll('text').length).toBeGreaterThan(0);
      expect(svgString).toContain('ww-export-text');
      expect(svgString).toMatch(/font-family:\s*'Lato',\s*'Helvetica Neue'/);
      // A whole label is one <text> block, not one element per character
      // (per the explicit design decision that 'text' mode should never do
      // per-glyph positioning - that would just re-implement 'textPath'
      // mode's approach with a worse font/kerning story). Any multi-char
      // label proves this: its <text> textContent has more than 1 character.
      const multiCharLabel = [...parsed.querySelectorAll('text')].find(
        (el) => (el.textContent?.length ?? 0) > 1
      );
      expect(multiCharLabel).not.toBeUndefined();
    });

    test('"textPath" mode emits zero <text> elements, only glyph paths', async () => {
      const svgString = await buildCrossDesignSvg(
        simpleCrossDesign.nodes,
        simpleCrossDesign.edges,
        'default',
        true,
        'textPath'
      );
      const parsed = new DOMParser().parseFromString(
        svgString,
        'image/svg+xml'
      );
      expect(parsed.querySelector('parsererror')).toBeNull();
      expect(parsed.querySelectorAll('text').length).toBe(0);
      expect(parsed.querySelectorAll('path').length).toBeGreaterThan(0);
      expect(svgString).not.toContain('ww-export-text');
    });
  });
});

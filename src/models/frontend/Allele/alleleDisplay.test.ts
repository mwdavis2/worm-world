import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterAll, describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { Gene } from 'models/frontend/Gene/Gene';
import { Variation } from 'models/frontend/Variation/Variation';
import {
  ALLELE_DISPLAY_MODES,
  DEFAULT_ALLELE_DISPLAY_MODE,
  MAX_CONTENTS_LENGTH,
  formatAlleleLabel,
  getAlleleDisplayMode,
  nextAlleleDisplayMode,
} from './alleleDisplay';

const gene = new Gene({ sysName: 'T14B4.7', descName: 'unc-5' });
// Contents text is shown exactly as stored: any brackets are part of it.
const geneAllele = new Allele({
  name: 'e1282',
  gene,
  contents: '[point mutation]',
});
// An extrachromosomal array with bracketed contents, as in real data.
const array = new Allele({
  name: 'oxEx2254',
  variation: new Variation({ name: 'oxEx2254', chromosome: 'Ex' }),
  contents: '[Psnt-1::Flp, Punc-122::GAP-43::mScarlet, cbr-unc-119(+), NeoR]',
});
const transgene = new Allele({
  name: 'oxIs363',
  variation: new Variation({ name: 'oxIs363' }),
  contents: '[Pmyo-3::GFP]',
});

describe('formatAlleleLabel', () => {
  test('each mode for an allele of a gene', () => {
    const label = (mode: string): string => formatAlleleLabel(geneAllele, mode);
    expect(label('name')).toBe('e1282');
    expect(label('gene-name')).toBe('unc-5(e1282)');
    expect(label('name-contents')).toBe('e1282 [point mutation]');
    expect(label('gene-name-contents')).toBe('unc-5(e1282 [point mutation])');
    expect(label('gene-sign')).toBe('unc-5(-)');
  });

  test('the wild-type copy shows + in the sign mode', () => {
    expect(formatAlleleLabel(geneAllele.toWild(), 'gene-sign')).toBe(
      'unc-5(+)'
    );
    expect(formatAlleleLabel(geneAllele.toWild(), 'gene-name')).toBe(
      'unc-5(+)'
    );
  });

  test('an allele with no gene shows just its name (plus contents when asked)', () => {
    expect(formatAlleleLabel(transgene, 'gene-name')).toBe('oxIs363');
    expect(formatAlleleLabel(transgene, 'gene-sign')).toBe('oxIs363');
    expect(formatAlleleLabel(transgene, 'gene-name-contents')).toBe(
      'oxIs363 [Pmyo-3::GFP]'
    );
  });

  test('missing or blank contents adds nothing', () => {
    const none = new Allele({ name: 'a1', gene });
    const blank = new Allele({ name: 'a1', gene, contents: '   ' });
    expect(formatAlleleLabel(none, 'gene-name-contents')).toBe('unc-5(a1)');
    expect(formatAlleleLabel(blank, 'name-contents')).toBe('a1');
  });

  test('long contents is cut with an ellipsis, unless the full text is asked for', () => {
    const long = 'x'.repeat(MAX_CONTENTS_LENGTH + 10);
    const allele = new Allele({ name: 'a1', gene, contents: long });
    const cut = formatAlleleLabel(allele, 'name-contents');
    expect(cut).toBe(`a1 ${'x'.repeat(MAX_CONTENTS_LENGTH - 1)}…`);
    expect(formatAlleleLabel(allele, 'name-contents', false)).toBe(
      `a1 ${long}`
    );
  });

  test('contents is shown exactly as stored - no brackets are added or removed', () => {
    const stored =
      '[Psnt-1::Flp, Punc-122::GAP-43::mScarlet, cbr-unc-119(+), NeoR]';
    expect(formatAlleleLabel(array, 'name-contents', false)).toBe(
      `oxEx2254 ${stored}`
    );
    // Cut at the limit with an ellipsis, so the closing bracket is lost.
    expect(formatAlleleLabel(array, 'name-contents')).toBe(
      `oxEx2254 ${stored.slice(0, MAX_CONTENTS_LENGTH - 1)}…`
    );
    expect(MAX_CONTENTS_LENGTH).toBe(40);

    const unbracketed = new Allele({ name: 'a1', gene, contents: 'GFP' });
    expect(formatAlleleLabel(unbracketed, 'name-contents')).toBe('a1 GFP');
  });

  test('an unknown mode falls back to the default one', () => {
    expect(formatAlleleLabel(geneAllele, 'nonsense')).toBe(
      formatAlleleLabel(geneAllele, DEFAULT_ALLELE_DISPLAY_MODE)
    );
  });
});

describe('modes', () => {
  test('the default mode is the original gene(name) label, and matches getQualifiedName', () => {
    expect(DEFAULT_ALLELE_DISPLAY_MODE).toBe('gene-name');
    for (const allele of [geneAllele, geneAllele.toWild(), transgene]) {
      expect(formatAlleleLabel(allele, DEFAULT_ALLELE_DISPLAY_MODE)).toBe(
        allele.getQualifiedName()
      );
    }
  });

  test('the toggle cycles through every mode and wraps around', () => {
    const seen = [ALLELE_DISPLAY_MODES[0].id];
    for (let i = 1; i < ALLELE_DISPLAY_MODES.length; i++) {
      seen.push(nextAlleleDisplayMode(seen[i - 1]));
    }
    expect(seen).toEqual(ALLELE_DISPLAY_MODES.map((mode) => mode.id));
    expect(nextAlleleDisplayMode(seen[seen.length - 1])).toBe(seen[0]);
    expect(getAlleleDisplayMode('gene-sign').label).toBe('Gene(-/+)');
  });
});

describe('Allele.build', () => {
  afterAll(() => {
    clearMocks();
  });

  // Regression: alleles loaded from the database used to lose their contents,
  // so no display mode could ever show it.
  test('keeps the contents text of an allele loaded from the database', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_variations')
        return [
          {
            alleleName: 'oxEx2254',
            chromosome: 'Ex',
            physLoc: null,
            geneticLoc: null,
            recombSuppressor: null,
            isLocationReference: false,
            percentLoss: 50,
          },
        ];
      return [];
    });
    const allele = await Allele.build({
      name: 'oxEx2254',
      variationName: 'oxEx2254',
      contents: '[Pmyo-3::GFP]',
    });
    expect(allele.contents).toBe('[Pmyo-3::GFP]');
    expect(formatAlleleLabel(allele, 'name-contents')).toBe(
      'oxEx2254 [Pmyo-3::GFP]'
    );
  });
});

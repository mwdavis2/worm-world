import { Dominance } from 'models/enums';
import {
  buildAlleleName,
  computeDominanceRows,
  computeFluorescentMarkerRows,
  computeRescuesGeneRows,
  computeResistantToDrugRows,
  defaultDominanceState,
  defaultFluorescentMarkerState,
  defaultResistantToDrugState,
  defaultRescuesGeneState,
  defaultVariationTabState,
  defaultZygosityBoxState,
  parseInitialAlleleName,
} from 'components/NewAlleleModal/newAlleleTypes';

describe('computeResistantToDrugRows', () => {
  test('contributes no rows when disabled', () => {
    expect(computeResistantToDrugRows(defaultResistantToDrugState())).toEqual(
      []
    );
  });

  test('contributes no rows when enabled but no drug picked', () => {
    expect(
      computeResistantToDrugRows({ enabled: true, drugName: undefined })
    ).toEqual([]);
  });

  test('synthesizes the 0-copies (sensitive) and 1or2-copies (resistant) rows', () => {
    const rows = computeResistantToDrugRows({
      enabled: true,
      drugName: 'Hyg',
    });
    expect(rows).toEqual([
      {
        id: 'resistantToDrug-0',
        copyNumber: '0',
        name: 'HygS',
        isWildType: false,
        isLethal: true,
        relationship: 'suppressedByPhenotype',
        relationshipText: 'HygR',
        derivedFrom: 'resistantToDrug',
      },
      {
        id: 'resistantToDrug-1or2',
        copyNumber: '1or2',
        name: 'HygR',
        isWildType: true,
        isLethal: false,
        relationship: 'requiresCondition',
        relationshipText: 'Hyg',
        derivedFrom: 'resistantToDrug',
      },
    ]);
  });
});

describe('computeRescuesGeneRows', () => {
  test('contributes no rows when disabled or blank', () => {
    expect(computeRescuesGeneRows(defaultRescuesGeneState())).toEqual([]);
    expect(computeRescuesGeneRows({ enabled: true, geneName: '' })).toEqual([]);
  });

  test('synthesizes a wild-type modifier row referencing the gene', () => {
    const rows = computeRescuesGeneRows({
      enabled: true,
      geneName: 'unc-119',
    });
    expect(rows).toEqual([
      {
        id: 'rescuesGene-0',
        copyNumber: '1or2',
        name: 'unc-119(+)',
        isWildType: true,
        isLethal: false,
        relationshipText: '',
        derivedFrom: 'rescuesGene',
      },
    ]);
  });
});

describe('computeFluorescentMarkerRows', () => {
  test('contributes no rows when disabled or blank', () => {
    expect(
      computeFluorescentMarkerRows(defaultFluorescentMarkerState())
    ).toEqual([]);
    expect(
      computeFluorescentMarkerRows({
        enabled: true,
        text: '',
        twoCopiesBrighter: false,
      })
    ).toEqual([]);
  });

  test('not brighter-at-2-copies: a single 1or2-copies row', () => {
    const rows = computeFluorescentMarkerRows({
      enabled: true,
      text: 'myo-2p::GFP',
      twoCopiesBrighter: false,
    });
    expect(rows).toEqual([
      {
        id: 'fluorescentMarker-0',
        copyNumber: '1or2',
        name: 'myo-2p::GFP',
        isWildType: false,
        isLethal: false,
        relationshipText: '',
        derivedFrom: 'fluorescentMarker',
      },
    ]);
  });

  test('brighter-at-2-copies: splits into a dim 1-copy row and a bright 2-copies row', () => {
    const rows = computeFluorescentMarkerRows({
      enabled: true,
      text: 'myo-2p::GFP',
      twoCopiesBrighter: true,
    });
    expect(rows).toEqual([
      {
        id: 'fluorescentMarker-dim',
        copyNumber: '1',
        name: 'myo-2p::GFP (dim)',
        isWildType: false,
        isLethal: false,
        relationshipText: '',
        derivedFrom: 'fluorescentMarker',
      },
      {
        id: 'fluorescentMarker-bright',
        copyNumber: '2',
        name: 'myo-2p::GFP',
        isWildType: false,
        isLethal: false,
        relationshipText: '',
        derivedFrom: 'fluorescentMarker',
      },
    ]);
  });
});

describe('computeDominanceRows', () => {
  test('contributes no rows when disabled', () => {
    expect(computeDominanceRows(defaultDominanceState(), 'unc-119')).toEqual(
      []
    );
  });

  test('Recessive: one row at 2 copies, suppressed-by-phenotype when rescued by WT', () => {
    const state = {
      enabled: true,
      mode: Dominance.Recessive,
      homozygous: { name: 'Unc', rescuedByWT: true },
      heterozygous: defaultZygosityBoxState(),
    };
    expect(computeDominanceRows(state, 'unc-119')).toEqual([
      {
        id: 'dominance-homo',
        copyNumber: '2',
        name: 'Unc',
        isWildType: false,
        isLethal: false,
        relationship: 'suppressedByPhenotype',
        relationshipText: 'unc-119(+)',
        derivedFrom: 'dominance',
      },
    ]);
  });

  test('Recessive: no relationship when rescued-by-WT is unchecked, but the row still exists', () => {
    const state = {
      enabled: true,
      mode: Dominance.Recessive,
      homozygous: { name: 'Unc', rescuedByWT: false },
      heterozygous: defaultZygosityBoxState(),
    };
    const rows = computeDominanceRows(state, 'unc-119');
    expect(rows).toHaveLength(1);
    expect(rows[0].relationship).toBeUndefined();
    expect(rows[0].name).toBe('Unc');
  });

  test('Dominant: one row at 1-or-2 copies', () => {
    const state = {
      enabled: true,
      mode: Dominance.Dominant,
      homozygous: { name: 'Unc', rescuedByWT: true },
      heterozygous: defaultZygosityBoxState(),
    };
    const rows = computeDominanceRows(state, 'unc-119');
    expect(rows).toHaveLength(1);
    expect(rows[0].copyNumber).toBe('1or2');
  });

  test('SemiDominant: two rows, one at 2 copies and one at 1 copy', () => {
    const state = {
      enabled: true,
      mode: Dominance.SemiDominant,
      homozygous: { name: 'UncSevere', rescuedByWT: true },
      heterozygous: { name: 'UncMild', rescuedByWT: false },
    };
    const rows = computeDominanceRows(state, 'unc-119');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.copyNumber === '2')?.name).toBe('UncSevere');
    expect(rows.find((r) => r.copyNumber === '1')?.name).toBe('UncMild');
  });

  test('SemiDominant with only one of the two zygosity boxes filled in only creates that one row', () => {
    const state = {
      enabled: true,
      mode: Dominance.SemiDominant,
      homozygous: { name: 'UncSevere', rescuedByWT: true },
      heterozygous: defaultZygosityBoxState(), // blank name
    };
    const rows = computeDominanceRows(state, 'unc-119');
    expect(rows).toHaveLength(1);
    expect(rows[0].copyNumber).toBe('2');
  });
});

describe('buildAlleleName', () => {
  test('Ti/Si/Is: concatenates prefix + chosen type + suffix with no separators', () => {
    const state = {
      ...defaultVariationTabState(),
      namePrefix: 'ox',
      namingPrefix: 'Si' as const,
      nameSuffix: '100000',
    };
    expect(buildAlleleName('tiSiIs', state)).toBe('oxSi100000');
  });

  test('Ex: concatenates prefix + fixed "Ex" + suffix', () => {
    const state = {
      ...defaultVariationTabState(),
      namePrefix: 'ox',
      nameSuffix: '2254',
    };
    expect(buildAlleleName('ex', state)).toBe('oxEx2254');
  });
});

describe('parseInitialAlleleName', () => {
  test('routes an Ex-style name to the Ex tab, split into prefix/suffix', () => {
    expect(parseInitialAlleleName('oxEx100')).toEqual({
      tab: 'ex',
      namePrefix: 'ox',
      nameSuffix: '100',
    });
  });

  test('routes a Ti/Si/Is-style name to the tiSiIs tab, split into prefix/type/suffix', () => {
    expect(parseInitialAlleleName('oxSi100000')).toEqual({
      tab: 'tiSiIs',
      namePrefix: 'ox',
      namingPrefix: 'Si',
      nameSuffix: '100000',
    });
    expect(parseInitialAlleleName('ttTi5605')).toEqual({
      tab: 'tiSiIs',
      namePrefix: 'tt',
      namingPrefix: 'Ti',
      nameSuffix: '5605',
    });
  });

  test('trims a leading/trailing space before matching', () => {
    // A user padding the search text with a space to dodge a substring
    // match against an existing allele (e.g. "oxIs1 " vs. existing
    // "oxIs12") shouldn't defeat routing.
    expect(parseInitialAlleleName('oxIs1 ')).toEqual({
      tab: 'tiSiIs',
      namePrefix: 'ox',
      namingPrefix: 'Is',
      nameSuffix: '1',
    });
    expect(parseInitialAlleleName(' oxEx100')).toEqual({
      tab: 'ex',
      namePrefix: 'ox',
      nameSuffix: '100',
    });
  });

  test('falls back to the Gene tab plain name when the shape does not match', () => {
    expect(parseInitialAlleleName('ed3')).toEqual({
      tab: 'gene',
      plainName: 'ed3',
    });
    expect(parseInitialAlleleName('')).toEqual({
      tab: 'gene',
      plainName: '',
    });
  });
});

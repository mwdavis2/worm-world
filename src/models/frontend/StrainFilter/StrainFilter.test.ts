import { expect, test, describe } from 'vitest';
import { ed3, n765 } from 'models/frontend/Allele/Allele.mock';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain } from 'models/frontend/Strain/Strain';
import {
  LETHAL,
  NON_LETHAL,
  StrainFilter,
} from 'models/frontend/StrainFilter/StrainFilter';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';

beforeEach(() => {
  mockIPC((cmd, _) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});

afterAll(() => {
  clearMocks();
});

describe('StrainFilter', () => {
  test('correctly instantiates', () => {
    const filter = new StrainFilter({
      alleleNames: new Set(['a', 'b', 'c']),
      exprPhenotypes: new Set(['1', '2']),
      reqConditions: new Set(['cond1']),
      supConditions: new Set(),
      hiddenNodes: new Set(),
    });
    expect(filter.alleleNames).toHaveLength(3);
    expect(filter.alleleNames.has('a')).toBe(true);
    expect(filter.exprPhenotypes).toHaveLength(2);
    expect(filter.exprPhenotypes.has('2')).toBe(true);
    expect(filter.reqConditions).toHaveLength(1);
    expect(filter.reqConditions.has('cond1')).toBe(true);
    expect(filter.supConditions).toHaveLength(0);
  });

  test('.clone() creates a identical copy', () => {
    const alleleNames = new Set(['a', 'b', 'c']);
    const exprPhenotypes = new Set(['1', '2']);
    const reqConditions = new Set(['cond1']);
    const supConditions = new Set<string>();
    const hiddenNodes = new Set<string>();
    const filter = new StrainFilter({
      alleleNames,
      exprPhenotypes,
      reqConditions,
      supConditions,
      hiddenNodes,
    });
    const clone = filter.clone();

    expect(clone).not.toBe(filter); // not same reference
    expect(clone.alleleNames).toEqual(alleleNames);
    expect(clone.exprPhenotypes).toEqual(exprPhenotypes);
    expect(clone.reqConditions).toEqual(reqConditions);
    expect(clone.supConditions).toEqual(supConditions);
  });

  test('.has() returns true if the filter contains the query', () => {
    const filter = new StrainFilter({
      alleleNames: new Set(['a', 'b', 'c']),
      exprPhenotypes: new Set(['1', '2']),
      reqConditions: new Set(['cond1']),
      supConditions: new Set(),
      hiddenNodes: new Set(),
    });
    expect(filter.alleleNames.has('a')).toBe(true);
    expect(filter.alleleNames.has('b')).toBe(true);
    expect(filter.alleleNames.has('c')).toBe(true);
    expect(filter.exprPhenotypes.has('1')).toBe(true);
    expect(filter.exprPhenotypes.has('2')).toBe(true);
    expect(filter.reqConditions.has('cond1')).toBe(true);
  });

  test('.has() returns false if the filter does not contain the query', () => {
    const filter = new StrainFilter({
      alleleNames: new Set(['a', 'b', 'c']),
      exprPhenotypes: new Set(['1', '2']),
      reqConditions: new Set(['cond1']),
      supConditions: new Set(),
      hiddenNodes: new Set(),
    });

    expect(filter.alleleNames.has('')).toBe(false);
    expect(filter.alleleNames.has('random')).toBe(false);
    expect(filter.alleleNames.has('not a value')).toBe(false);
    expect(filter.alleleNames.has('idk')).toBe(false);
  });

  test('.extractEditorFilterNames() to pull info from strain', async () => {
    const node = {
      data: await Strain.build({
        allelePairs: [n765.toTopHet(), ed3.toHomo()],
      }),
      id: '',
      position: { x: 0, y: 0 },
    };
    const options = StrainFilter.getFilterOptions([node]);

    expect(options.alleleNames).toEqual(
      new Set(['lin-15B(n765)', 'lin-15B(+)', 'unc-119(ed3)'])
    );
    // n765's own AlleleExpression requires the "25C" condition, which isn't
    // active here (no activeConditions passed), so lin-15B's mutant row is
    // blocked - since there's no wild-type row for lin-15B at all, the
    // wild-type-background default fills the gap. unc-119 (ed3, homozygous,
    // no condition requirement) expresses normally, as the mutant.
    expect(options.exprPhenotypes).toEqual(
      new Set(['unc-119', 'lin-15B (wild)'])
    );
    expect(options.reqConditions).toEqual(new Set(['25C']));
    expect(options.supConditions).toEqual(new Set<string>());
  });

  test('.condenseEditorFilterNames() pulls info from multiple strains', async () => {
    const node1 = {
      data: await Strain.build({
        allelePairs: [new AllelePair({ top: n765, bot: n765.toWild() })],
      }),
      id: '',
      position: { x: 0, y: 0 },
    };
    const node2 = {
      data: await Strain.build({
        allelePairs: [ed3.toHomo(), n765.toTopHet()],
      }),
      id: '',
      position: { x: 0, y: 0 },
    };
    const options = StrainFilter.getFilterOptions([node1, node2]);

    expect(options.alleleNames).toEqual(
      new Set(['lin-15B(n765)', 'lin-15B(+)', 'unc-119(ed3)'])
    );
    // lin-15B's mutant row is condition-blocked (25C inactive) with no
    // wild-type row of its own, so the wild-type-background default fills
    // it in alongside unc-119's normal mutant expression.
    expect(options.exprPhenotypes).toEqual(
      new Set(['unc-119', 'lin-15B (wild)'])
    );
    expect(options.reqConditions).toEqual(new Set(['25C']));
    expect(options.supConditions).toEqual(new Set<string>());
  });

  test('correctly (de)serializes', () => {
    const filter = new StrainFilter({
      alleleNames: new Set(['a', 'b', 'c']),
      exprPhenotypes: new Set(['1', '2']),
      reqConditions: new Set(['cond1']),
      supConditions: new Set(),
      hiddenNodes: new Set(),
    });
    const filterStr = filter.toJSON();
    const filterBack = StrainFilter.fromJSON(filterStr);
    expect(filterBack).toEqual(filter);
  });

  test('hides lethal genotypes by default (viability starts as Non-lethal)', () => {
    expect(new StrainFilter().viability).toEqual(new Set([NON_LETHAL]));
  });

  test('JSON saved before viability existed loads with no narrowing', () => {
    const legacy = {
      alleleNames: [],
      exprPhenotypes: [],
      reqConditions: [],
      supConditions: [],
      hiddenNodes: [],
      activeConditions: [],
    };
    expect(StrainFilter.fromJSON(JSON.stringify(legacy)).viability).toEqual(
      new Set()
    );
  });

  test('interim boolean flags migrate and are dropped', () => {
    const base = JSON.stringify({ alleleNames: [] });
    const withFlag = (flag: Record<string, boolean>): StrainFilter =>
      StrainFilter.fromJSON(JSON.stringify({ ...JSON.parse(base), ...flag }));

    expect(withFlag({ showLethal: false }).viability).toEqual(
      new Set([NON_LETHAL])
    );
    expect(withFlag({ showLethal: true }).viability).toEqual(new Set());
    expect(withFlag({ hideLethal: true }).viability).toEqual(
      new Set([NON_LETHAL])
    );
    expect(withFlag({ hideLethal: false }).viability).toEqual(new Set());
    const migrated = withFlag({ showLethal: false });
    expect(Object.keys(migrated)).not.toContain('showLethal');
    expect(Object.keys(withFlag({ hideLethal: true }))).not.toContain(
      'hideLethal'
    );
  });

  test('viability updates like the other set filters and round-trips', () => {
    const filter = new StrainFilter();
    filter.update({
      field: 'viability',
      action: 'add',
      name: LETHAL,
      filterId: '',
    });
    expect(filter.viability).toEqual(new Set([NON_LETHAL, LETHAL]));
    expect(StrainFilter.fromJSON(filter.toJSON()).viability).toEqual(
      new Set([NON_LETHAL, LETHAL])
    );
    filter.update({
      field: 'viability',
      action: 'clear',
      name: '',
      filterId: '',
    });
    expect(StrainFilter.fromJSON(filter.toJSON()).viability).toEqual(new Set());
  });

  test('isEmpty ignores the default viability but counts Lethal', () => {
    expect(new StrainFilter().isEmpty()).toBe(true);
    expect(new StrainFilter({ viability: new Set() }).isEmpty()).toBe(true);
    expect(new StrainFilter({ viability: new Set([LETHAL]) }).isEmpty()).toBe(
      false
    );
  });
});

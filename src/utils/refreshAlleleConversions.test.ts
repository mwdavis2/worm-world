import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, test } from 'vitest';
import { type Node } from 'reactflow';
import { NodeType } from 'models/enums';
import { Allele } from 'models/frontend/Allele/Allele';
import { AlleleConversion } from 'models/frontend/AlleleConversion/AlleleConversion';
import {
  restoreSnapshot,
  snapshotOf,
} from 'models/frontend/CrossDesign/undoHistory';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import {
  allelesInDesign,
  applyFreshConversions,
  loadFreshConversions,
} from 'utils/refreshAlleleExpressions';

const rule = (percent = 100): AlleleConversion =>
  new AlleleConversion({
    productName: 'excised',
    driverName: 'Cre',
    driverWild: true,
    percentConversion: percent,
  });

const floxed = (conversions?: AlleleConversion[]): Allele => {
  const allele = new Allele({
    name: 'floxed',
    variation: new Variation({ name: 'vFlox', chromosome: 'III' }),
  });
  if (conversions !== undefined) allele.conversions = conversions;
  return allele;
};

const design = (allele: Allele): Array<Node<any>> => [
  {
    id: 'a',
    type: NodeType.Strain,
    position: { x: 0, y: 0 },
    data: new Strain({ allelePairs: [allele.toHomo()] }),
  },
];

describe('AlleleConversion', () => {
  test('is built from a record, with the driver key phenotypes use', () => {
    const conversion = AlleleConversion.createFromRecord({
      sourceAllele: 'floxed',
      productAllele: 'excised',
      driverPhenotypeName: 'Cre',
      driverPhenotypeWild: true,
      percentConversion: 40,
      description: null,
    });
    expect(conversion.productName).toBe('excised');
    expect(conversion.getDriverKey()).toBe('Cre (wild)');
    expect(conversion.getProbability()).toBeCloseTo(0.4);
    expect(conversion.description).toBeUndefined();
    expect(
      new AlleleConversion({
        productName: 'p',
        driverName: 'Flp',
        driverWild: false,
        percentConversion: 100,
      }).getDriverKey()
    ).toBe('Flp');
  });
});

describe('loading conversions', () => {
  afterEach(() => {
    clearMocks();
  });

  test('an allele loads its rules from the data table', async () => {
    mockIPC((cmd) =>
      cmd === 'get_filtered_allele_conversions'
        ? [
            {
              sourceAllele: 'floxed',
              productAllele: 'excised',
              driverPhenotypeName: 'Cre',
              driverPhenotypeWild: true,
              percentConversion: 75,
              description: 'germline',
            },
          ]
        : []
    );
    const rules = await Allele.loadAlleleConversions('floxed');
    expect(rules).toHaveLength(1);
    expect(rules[0].percentConversion).toBe(75);
    expect(rules[0].description).toBe('germline');
  });

  test('a rule that cannot be loaded keeps the saved one', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_allele_conversions') throw new Error('nope');
      return [];
    });
    const fresh = await loadFreshConversions(['floxed'], async (name) => {
      return await Allele.loadAlleleConversions(name);
    });
    expect(fresh.has('floxed')).toBe(false);
  });
});

describe('applyFreshConversions', () => {
  test('replaces a stale copy and says so', () => {
    const nodes = design(floxed([rule(100)]));
    const result = applyFreshConversions(
      nodes,
      new Map([['floxed', [rule(25)]]])
    );
    expect(result.changed).toBe(true);
    const allele = (result.nodes[0].data as Strain).getAlleles()[0];
    expect(allele.conversions[0].percentConversion).toBe(25);
    // a new strain object, so memoized cards re-render
    expect(result.nodes[0].data).not.toBe(nodes[0].data);
  });

  test('leaves a design alone when its rules are current', () => {
    const nodes = design(floxed([rule(100)]));
    const result = applyFreshConversions(
      nodes,
      new Map([['floxed', [rule(100)]]])
    );
    expect(result.changed).toBe(false);
    expect(result.nodes).toBe(nodes);
  });

  test('an allele saved before conversions existed gets its rules', () => {
    const allele = floxed();
    // as an old saved design hands it over: no conversions field at all
    delete (allele as { conversions?: AlleleConversion[] }).conversions;
    const nodes = design(allele);
    const result = applyFreshConversions(
      nodes,
      new Map([['floxed', [rule(100)]]])
    );
    expect(result.changed).toBe(true);
    expect(
      (result.nodes[0].data as Strain).getAlleles()[0].conversions
    ).toHaveLength(1);
  });

  test('an allele the data tables no longer have keeps its saved rules', () => {
    const nodes = design(floxed([rule(100)]));
    const result = applyFreshConversions(nodes, new Map());
    expect(result.changed).toBe(false);
    expect(allelesInDesign(nodes)).toEqual(['floxed']);
  });
});

describe('saving a design', () => {
  test('rules on the alleles survive the undo snapshot round trip', () => {
    const nodes = design(floxed([rule(60)]));
    const restored = restoreSnapshot(snapshotOf(nodes, []));
    const allele = (restored.nodes[0].data as Strain).getAlleles()[0];
    expect(allele.conversions).toHaveLength(1);
    expect(allele.conversions[0]).toBeInstanceOf(AlleleConversion);
    expect(allele.conversions[0].getDriverKey()).toBe('Cre (wild)');
    expect(allele.conversions[0].percentConversion).toBe(60);
  });
});

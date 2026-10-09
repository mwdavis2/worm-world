// A child card's stored phenotype info (lethal flag, phenotype names) and a
// saved design's allele data must stay correct after every edit the app allows:
// toggling a child's sex, opening a design after an allele's data changed, and
// copying a card.
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { Variation } from 'models/frontend/Variation/Variation';
import { NodeType, Sex } from 'models/enums';
import { refreshAlleleContents } from 'utils/refreshAlleleContents';
import {
  allelesInDesign,
  applyFreshExpressions,
  loadFreshExpressions,
} from 'utils/refreshAlleleExpressions';
import {
  refreshCardInfoOfChild,
  refreshCardInfoOfChildren,
} from 'models/frontend/CrossDesign/refreshCardInfo';
import { type Edge, type Node } from 'reactflow';

// An X-linked allele whose phenotype ("unc", lethal) shows only when the
// strain has two copies - which a hemizygous male counts as
const lethalUnc = new Phenotype({
  name: 'unc',
  shortName: 'unc',
  wild: false,
  lethal: true,
});
const xAllele = (): Allele => {
  const allele = new Allele({
    name: 'x1',
    variation: new Variation({ name: 'x1', chromosome: 'X' }),
  });
  allele.alleleExpressions = [
    new AlleleExpression({
      alleleName: 'x1',
      expressingPhenotype: lethalUnc,
      requiredPhenotypes: [],
      suppressingPhenotypes: [],
      requiredConditions: [],
      suppressingConditions: [],
      dominance: '2',
    }),
  ];
  return allele;
};

describe('a card toggled between hermaphrodite and male', () => {
  test('a hermaphrodite carrying x1 over wild does not express it; the same card as a male does', () => {
    const herm = new Strain({ allelePairs: [xAllele().toTopHet()] });
    expect(herm.sex).toBe(Sex.Hermaphrodite);
    expect(herm.isLethal()).toBe(false);
    const male = herm.toggleSex();
    expect(male.sex).toBe(Sex.Male);
    expect(male.isLethal()).toBe(true);
  });

  test('a copied card keeps its stored card info, and a refresh brings it up to date', () => {
    const herm = new Strain({ allelePairs: [xAllele().toTopHet()] });
    herm.refreshCardInfo([], new Set());
    const copy = new Strain({ ...herm, isParent: true });
    expect(copy.lethal).toBe(false);
    expect(copy.exprPhenotypeNames).toEqual([]);
    expect(herm.clone().lethal).toBe(false);
  });
});

// parent P -> self-cross M -> child C
const crossOf = (child: Strain): { nodes: Array<Node<any>>; edges: Edge[] } => {
  const parent = new Strain({ allelePairs: [xAllele().toTopHet()] });
  return {
    nodes: [
      {
        id: 'p',
        type: NodeType.Strain,
        position: { x: 0, y: 0 },
        data: parent,
      },
      {
        id: 'm',
        type: NodeType.Self,
        position: { x: 0, y: 0 },
        data: new StrainFilter(),
      },
      {
        id: 'c',
        type: NodeType.Strain,
        position: { x: 0, y: 0 },
        parentNode: 'm',
        data: child,
      },
    ],
    edges: [{ id: 'e', source: 'p', target: 'm' }],
  };
};

describe('refreshing a child card against its cross', () => {
  test('toggling the child to a male, then refreshing, shows what it now expresses', () => {
    const child = new Strain({
      allelePairs: [xAllele().toTopHet()],
      isChild: true,
    });
    const { nodes, edges } = crossOf(child);
    refreshCardInfoOfChildren(nodes, edges);
    expect(child.lethal).toBe(false);
    expect(child.exprPhenotypeNames).toEqual([]);

    // what the editor's sex toggle does
    const toggled: Node<Strain> = { ...nodes[2], data: child.toggleSex() };
    refreshCardInfoOfChild(toggled, nodes, edges);
    expect(toggled.data.lethal).toBe(true);
    expect(toggled.data.exprPhenotypeNames).toEqual(['unc']);

    // and toggled again: whatever it is now, its stored info matches it
    // (note the toggle is not an undo: the male's single X becomes both of a
    // hermaphrodite's, so x1/+ -> x1/0 -> x1/x1)
    const again: Node<Strain> = { ...toggled, data: toggled.data.toggleSex() };
    refreshCardInfoOfChild(again, nodes, edges);
    expect(again.data.lethal).toBe(again.data.isLethal());
    expect(again.data.sex).toBe(Sex.Hermaphrodite);
    expect(again.data.toString()).not.toBe(child.toString());
  });

  test('a card that is not a child of a cross is left alone', () => {
    const founder: Node<Strain> = {
      id: 'f',
      type: NodeType.Strain,
      position: { x: 0, y: 0 },
      data: new Strain({ allelePairs: [xAllele().toHomo()] }),
    };
    refreshCardInfoOfChild(founder, [founder], []);
    expect(founder.data.lethal).toBeUndefined();
  });
});

describe('what a saved design keeps of an allele', () => {
  test("a strain's alleles keep their expression rows through a JSON save and load", () => {
    const strain = new Strain({ allelePairs: [xAllele().toHomo()] });
    const reloaded = Strain.fromJSON(strain.toJSON());
    const reloadedAllele = reloaded.getNonWildAlleles()[0];
    expect(reloadedAllele.alleleExpressions).toHaveLength(1);
    expect(reloadedAllele.alleleExpressions[0].dominance).toBe('2');
  });

  test("opening a design refreshes an allele's display text only - not its expression rows", () => {
    const strain = new Strain({ allelePairs: [xAllele().toHomo()] });
    const nodes = [{ id: 'n', type: NodeType.Strain, data: strain }] as any[];
    // the allele table now says something new about x1; the expression rows
    // of the saved copy stay as they were when the strain was added
    const refreshed = refreshAlleleContents(
      nodes,
      new Map([['x1', 'new contents']])
    );
    const allele = (refreshed[0].data as Strain).getNonWildAlleles()[0];
    expect(allele.contents).toBe('new contents');
    expect(allele.alleleExpressions[0].dominance).toBe('2'); // unchanged
  });
});

describe("refreshing a saved design's allele data when it opens", () => {
  const changedRows = (): AlleleExpression[] => [
    new AlleleExpression({
      alleleName: 'x1',
      expressingPhenotype: lethalUnc,
      requiredPhenotypes: [],
      suppressingPhenotypes: [],
      requiredConditions: [],
      suppressingConditions: [],
      dominance: '1or2', // was '2'
    }),
  ];

  test('lists the non-wild alleles in the design once', () => {
    const { nodes } = crossOf(
      new Strain({ allelePairs: [xAllele().toHomo()], isChild: true })
    );
    expect(allelesInDesign(nodes)).toEqual(['x1']);
  });

  test('an allele whose rows changed is updated, the cards re-render, and the phenotypes follow the new rows', () => {
    const child = new Strain({
      allelePairs: [xAllele().toTopHet()],
      isChild: true,
    });
    const { nodes, edges } = crossOf(child);
    refreshCardInfoOfChildren(nodes, edges);
    expect(child.lethal).toBe(false); // "2" needs two copies; this has one

    const result = applyFreshExpressions(
      nodes,
      new Map([['x1', changedRows()]])
    );
    expect(result.changed).toBe(true);
    expect(result.nodes[2]).not.toBe(nodes[2]); // a new node, so cards re-render
    refreshCardInfoOfChildren(result.nodes, edges);
    const refreshed = result.nodes[2].data as Strain;
    expect(refreshed.lethal).toBe(true); // "1or2" now shows with one copy
    expect(refreshed.exprPhenotypeNames).toEqual(['unc']);
  });

  test('rows that are already current change nothing', () => {
    const { nodes } = crossOf(
      new Strain({ allelePairs: [xAllele().toHomo()], isChild: true })
    );
    const result = applyFreshExpressions(
      nodes,
      new Map([['x1', xAllele().alleleExpressions]])
    );
    expect(result.changed).toBe(false);
    expect(result.nodes).toBe(nodes);
  });

  test('an allele that could not be loaded keeps its saved rows', async () => {
    const fresh = await loadFreshExpressions(['x1', 'gone'], async (name) => {
      if (name === 'gone') throw new Error('not found');
      return changedRows();
    });
    expect([...fresh.keys()]).toEqual(['x1']);
    const { nodes } = crossOf(
      new Strain({ allelePairs: [xAllele().toHomo()], isChild: true })
    );
    expect(applyFreshExpressions(nodes, fresh).changed).toBe(true);
    expect(applyFreshExpressions(nodes, new Map()).changed).toBe(false);
  });
});

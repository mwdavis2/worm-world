// Maternal-effect relations ask what the hermaphrodite mother of a card
// expresses; the mother is found from the design graph. The scenario mimics
// tra-3(e1107): homozygous animals show the mutant phenotype unless their
// mother expresses the wild-type phenotype, which a heterozygous mother does.
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { Variation } from 'models/frontend/Variation/Variation';
import { NodeType, Sex } from 'models/enums';
import {
  getAncestryMotherPhenotypes,
  getCardPhenotypes,
  getMotherPhenotypes,
  pickMother,
  type PhenotypeCache,
} from 'models/frontend/CrossDesign/motherPhenotypes';
import { refreshCardInfoOfChildren } from 'models/frontend/CrossDesign/refreshCardInfo';
import { type Edge, type Node } from 'reactflow';

const mutantPhen = new Phenotype({
  name: 'Tra',
  shortName: 'Tra',
  wild: false,
});
const wildPhen = new Phenotype({ name: 'tra', shortName: 'tra', wild: true });

const expr = (
  fields: Partial<ConstructorParameters<typeof AlleleExpression>[0]>
): AlleleExpression =>
  new AlleleExpression({
    alleleName: 't1',
    expressingPhenotype: mutantPhen,
    requiredPhenotypes: [],
    suppressingPhenotypes: [],
    requiredConditions: [],
    suppressingConditions: [],
    dominance: '2',
    ...fields,
  });

const traAllele = (): Allele => {
  const allele = new Allele({
    name: 't1',
    variation: new Variation({ name: 't1', chromosome: 'III' }),
  });
  allele.alleleExpressions = [
    // homozygous mutants are Tra unless their mother expresses wild-type tra
    expr({ maternalSuppressingPhenotypes: [wildPhen] }),
    // a heterozygous animal expresses the wild-type phenotype
    expr({ expressingPhenotype: wildPhen, dominance: '1' }),
  ];
  return allele;
};

const het = (sex = Sex.Hermaphrodite): Strain =>
  new Strain({ allelePairs: [traAllele().toTopHet()], sex });
const homo = (sex = Sex.Hermaphrodite): Strain =>
  new Strain({ allelePairs: [traAllele().toHomo()], sex });

const card = (id: string, data: Strain, parentNode?: string): Node<Strain> => ({
  id,
  type: NodeType.Strain,
  position: { x: 0, y: 0 },
  data,
  parentNode,
});
const selfNode = (id: string): Node<StrainFilter> => ({
  id,
  type: NodeType.Self,
  position: { x: 0, y: 0 },
  data: new StrainFilter(),
});
const crossNode = (id: string): Node<StrainFilter> => ({
  id,
  type: NodeType.X,
  position: { x: 0, y: 0 },
  data: new StrainFilter(),
});
const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
});

const MUTANT = mutantPhen.getUniqueName();
const WILD = wildPhen.getUniqueName();

describe('finding the mother', () => {
  test('a self-cross has one parent, her; a mated cross uses the hermaphrodite, not the male', () => {
    expect(pickMother([{ sex: Sex.Hermaphrodite }])).toBeDefined();
    const herm = { sex: Sex.Hermaphrodite, name: 'h' };
    const male = { sex: Sex.Male, name: 'm' };
    expect(pickMother([male, herm])?.name).toBe('h');
    expect(pickMother([herm, male])?.name).toBe('h');
    expect(pickMother([male, { ...male }])).toBeUndefined();
  });

  test('a card not made by a cross expresses on its own, and a cross with no parents has no mother', () => {
    const founder = card('f', homo());
    expect(getCardPhenotypes(founder, [founder], [])).toEqual(
      new Set([MUTANT])
    );
    expect(
      getMotherPhenotypes(selfNode('m'), [selfNode('m')], [])
    ).toBeUndefined();
  });
});

describe('a self-cross', () => {
  const selfCross = (
    mother: Strain
  ): { nodes: Array<Node<any>>; edges: Edge[] } => {
    const child = homo();
    child.isChild = true;
    return {
      nodes: [card('p', mother), selfNode('m'), card('c', child, 'm')],
      edges: [edge('p', 'm')],
    };
  };

  test('homozygous children of a heterozygous mother are rescued', () => {
    const { nodes, edges } = selfCross(het());
    expect(getMotherPhenotypes(nodes[1], nodes, edges)?.has(WILD)).toBe(true);
    refreshCardInfoOfChildren(nodes, edges);
    expect((nodes[2].data as Strain).exprPhenotypeNames).toEqual([]);
  });

  test('homozygous children of a homozygous mother show the phenotype', () => {
    const { nodes, edges } = selfCross(homo());
    refreshCardInfoOfChildren(nodes, edges);
    expect((nodes[2].data as Strain).exprPhenotypeNames).toEqual(['Tra']);
  });
});

describe('a mated cross', () => {
  const mated = (
    herm: Strain,
    male: Strain
  ): { nodes: Array<Node<any>>; edges: Edge[] } => {
    const child = homo();
    child.isChild = true;
    return {
      nodes: [
        card('h', herm),
        card('d', male),
        crossNode('x'),
        card('c', child, 'x'),
      ],
      edges: [edge('h', 'x'), edge('d', 'x')],
    };
  };

  test('only the hermaphrodite mother matters, whichever way the parents were drawn', () => {
    const rescued = mated(het(), homo(Sex.Male));
    refreshCardInfoOfChildren(rescued.nodes, rescued.edges);
    expect((rescued.nodes[3].data as Strain).exprPhenotypeNames).toEqual([]);

    const shown = mated(homo(), het(Sex.Male));
    refreshCardInfoOfChildren(shown.nodes, shown.edges);
    expect((shown.nodes[3].data as Strain).exprPhenotypeNames).toEqual(['Tra']);

    // the heterozygous male parent being listed first changes nothing
    const reordered = mated(homo(), het(Sex.Male));
    reordered.edges.reverse();
    refreshCardInfoOfChildren(reordered.nodes, reordered.edges);
    expect((reordered.nodes[3].data as Strain).exprPhenotypeNames).toEqual([
      'Tra',
    ]);
  });
});

describe('maternal effects through generations', () => {
  // grandmother G -> self-cross M1 -> mother P -> self-cross M2 -> child C
  const lineage = (
    grandmother: Strain
  ): { nodes: Array<Node<any>>; edges: Edge[] } => {
    const mother = homo();
    mother.isChild = true;
    const child = homo();
    child.isChild = true;
    return {
      nodes: [
        card('g', grandmother),
        selfNode('m1'),
        card('p', mother, 'm1'),
        selfNode('m2'),
        card('c', child, 'm2'),
      ],
      edges: [edge('g', 'm1'), edge('p', 'm2')],
    };
  };

  test('the mother is resolved with her own mother: a rescued mother does not show the mutant phenotype', () => {
    const { nodes, edges } = lineage(het());
    const cache: PhenotypeCache = new Map();
    expect(getCardPhenotypes(nodes[2], nodes, edges, cache).has(MUTANT)).toBe(
      false
    );

    const unrescued = lineage(homo());
    expect(
      getCardPhenotypes(
        unrescued.nodes[2],
        unrescued.nodes,
        unrescued.edges
      ).has(MUTANT)
    ).toBe(true);
    refreshCardInfoOfChildren(unrescued.nodes, unrescued.edges);
    expect((unrescued.nodes[4].data as Strain).exprPhenotypeNames).toEqual([
      'Tra',
    ]);
  });

  test('each ancestor is resolved once per pass', () => {
    const { nodes, edges } = lineage(het());
    const cache: PhenotypeCache = new Map();
    const first = getCardPhenotypes(nodes[2], nodes, edges, cache);
    expect(getCardPhenotypes(nodes[2], nodes, edges, cache)).toBe(first);
    expect([...cache.keys()].sort()).toEqual(['g', 'p']);
  });
});

describe('an ancestry tree (task scheduling)', () => {
  test('uses the hermaphrodite parent, recursively, and none for a founder', () => {
    const founder = { strain: homo(), parents: [] };
    expect(getAncestryMotherPhenotypes(founder)).toBeUndefined();

    const hetMother = { strain: het(), parents: [] };
    expect(
      getAncestryMotherPhenotypes({
        strain: homo(),
        parents: [hetMother],
      })?.has(WILD)
    ).toBe(true);

    const grandchild = {
      strain: homo(),
      parents: [{ strain: homo(), parents: [hetMother] }],
    };
    expect(getAncestryMotherPhenotypes(grandchild)?.has(MUTANT)).toBe(false);
  });
});

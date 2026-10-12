// kin-20 is on X, and its maternal rescue is entered as in the New Allele
// dialog (Kin rescued by the mother's and by its own wild-type kin-20; wild-type
// kin-20 expressed by "1 copy, other copy +"). Checks a mother balanced over
// tmC24, which covers kin-20, against an unbalanced homozygous mother and a
// mother who is ox423 over another kin-20 lof allele.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { Gene } from 'models/frontend/Gene/Gene';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { Variation } from 'models/frontend/Variation/Variation';
import { NodeType, Sex } from 'models/enums';
import { refreshCardInfoOfChildren } from 'models/frontend/CrossDesign/refreshCardInfo';
import { type Edge, type Node } from 'reactflow';

const kin = new Phenotype({ name: 'Kin', shortName: 'Kin', wild: false });
const wildKin20 = new Phenotype({
  name: 'kin-20',
  shortName: 'kin-20',
  wild: true,
});

const kinAllele = (name: string): Allele => {
  const allele = new Allele({
    name,
    gene: new Gene({
      sysName: 'F46F2.2',
      descName: 'kin-20',
      chromosome: 'X',
      physLoc: 15268602,
      geneticLoc: 22.3134,
    }),
  });
  const row = (
    expressingPhenotype: Phenotype,
    dominance: '5' | '1wt',
    extra: Partial<ConstructorParameters<typeof AlleleExpression>[0]> = {}
  ): AlleleExpression =>
    new AlleleExpression({
      alleleName: name,
      expressingPhenotype,
      requiredPhenotypes: [],
      suppressingPhenotypes: [],
      requiredConditions: [],
      suppressingConditions: [],
      dominance,
      ...extra,
    });
  // one expression per phenotype, as the New Allele dialog stores it: both
  // relationships hang on the single Kin row
  allele.alleleExpressions = [
    row(kin, '5', {
      suppressingPhenotypes: [wildKin20],
      maternalSuppressingPhenotypes: [wildKin20],
    }),
    row(wildKin20, '1wt'),
  ];
  return allele;
};

const tmC24 = new Allele({
  name: 'tmC24',
  variation: new Variation({
    name: 'tmC24',
    chromosome: 'X',
    physLoc: 12153666,
    geneticLoc: 7.01,
    recombination: [8465760, 15841572],
  }),
});

const ox423 = kinAllele('ox423');
const ox424 = kinAllele('ox424');

const strainOf = (pairs: AllelePair[], sex = Sex.Hermaphrodite): Strain =>
  new Strain({ allelePairs: pairs, sex });

// what the cross designer holds: mother -> self-cross -> every child
const selfCrossGraph = async (
  mother: Strain
): Promise<{ children: Strain[] }> => {
  const results = await mother.selfCross();
  const nodes: Array<Node<any>> = [
    { id: 'p', type: NodeType.Strain, position: { x: 0, y: 0 }, data: mother },
    {
      id: 'm',
      type: NodeType.Self,
      position: { x: 0, y: 0 },
      data: new StrainFilter(),
    },
    ...results.map((child, i) => ({
      id: `c${i}`,
      type: NodeType.Strain,
      position: { x: 0, y: 0 },
      parentNode: 'm',
      data: child,
    })),
  ];
  const edges: Edge[] = [{ id: 'e', source: 'p', target: 'm' }];
  refreshCardInfoOfChildren(nodes, edges);
  return { children: results };
};

const isOxHomozygote = (c: Strain, a: Allele): boolean =>
  c.getZygosity(a.name) === '2';

describe('maternal rescue of X-linked kin-20', () => {
  afterEach(() => {
    clearMocks();
  });
  const mock = (): void => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_strain_alleles') return [];
    });
  };

  test('a mother balanced over tmC24 rescues her ox423 homozygous children', async () => {
    mock();
    const mother = strainOf([
      new AllelePair({ top: ox423, bot: ox423.toWild() }),
      new AllelePair({ top: tmC24.toWild(), bot: tmC24 }),
    ]);
    const { children } = await selfCrossGraph(mother);
    const homozygotes = children.filter((c) => isOxHomozygote(c, ox423));
    expect(homozygotes.length).toBeGreaterThan(0);
    homozygotes.forEach((c) => {
      expect(c.exprPhenotypeNames).toEqual([]);
    });
    // no ox423 tmC24 recombinant chromosome is offered
    expect(children.some((c) => c.toString().includes('ox423 tmC24'))).toBe(
      false
    );
  });

  test('a homozygous mother does not rescue her children', async () => {
    mock();
    const mother = strainOf([new AllelePair({ top: ox423, bot: ox423 })]);
    const { children } = await selfCrossGraph(mother);
    children.forEach((c) => {
      expect(c.exprPhenotypeNames).toEqual(['Kin']);
    });
  });

  test('a mother who is ox423 over another kin-20 lof allele does not rescue', async () => {
    mock();
    const mother = strainOf([new AllelePair({ top: ox423, bot: ox424 })]);
    const { children } = await selfCrossGraph(mother);
    const kinChildren = children.filter(
      (c) =>
        c.getZygosity('ox423') !== '0' &&
        (c.getZygosity('ox423') === '2' ||
          c.getZygosity('ox424') === '2' ||
          (c.getZygosity('ox423') === '1' && c.getZygosity('ox424') === '1'))
    );
    kinChildren.forEach((c) => {
      expect(c.exprPhenotypeNames).toEqual(['Kin']);
    });
  });
});

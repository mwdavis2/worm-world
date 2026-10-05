import { type Edge, type Node } from 'reactflow';
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { Gene } from 'models/frontend/Gene/Gene';
import { Strain } from 'models/frontend/Strain/Strain';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { NotationGenotypeError } from './notationGenotype';
import { serializeNotation } from './notationText';
import {
  ancestryToNotation,
  walkAncestry,
  type AncestorNode,
} from './notationTree';

const geneAllele = (
  name: string,
  chromosome: ChromosomeName,
  geneticLoc: number
): Allele =>
  new Allele({
    name,
    gene: new Gene({
      sysName: `${name}-gene`,
      descName: `${name}-gene`,
      chromosome,
      physLoc: geneticLoc * 1000,
      geneticLoc,
    }),
  });

const dpy5 = geneAllele('dpy-5', 'I', 1);
const unc119 = geneAllele('unc-119', 'X', 2);

// The worked example from the design, built as strains: founder herm B
// (dpy-5/+), founder male A (unc-119/0), their child, self-crossed.
const hermB = new Strain({ allelePairs: [dpy5.toTopHet()] });
const maleA = new Strain({ allelePairs: [unc119.toTopHet()] }).toggleSex();
const crossChild = new Strain({
  allelePairs: [dpy5.toHomo(), unc119.toTopHet()],
});
const selfChild = new Strain({
  allelePairs: [dpy5.toHomo(), unc119.toHomo()],
});

const founder = (strain: Strain): AncestorNode => ({ strain, parents: [] });

describe('ancestryToNotation', () => {
  test('a founder is a flat list, with the X always present', () => {
    expect(serializeNotation(ancestryToNotation(founder(hermB)))).toBe(
      '{dpy-5/+ +/+}'
    );
    expect(serializeNotation(ancestryToNotation(founder(maleA)))).toBe(
      '{unc-119/0}'
    );
  });

  test('the design example: a cross, then a self-cross of one child', () => {
    const cross: AncestorNode = {
      strain: crossChild,
      parents: [founder(maleA), founder(hermB)], // either order
    };
    const self: AncestorNode = { strain: selfChild, parents: [cross] };
    expect(serializeNotation(ancestryToNotation(self))).toBe(
      '{{{dpy-5/+ +/+}{unc-119/0}{dpy-5/dpy-5 unc-119/+}}{}{dpy-5/dpy-5 unc-119/unc-119}}'
    );
  });

  test('the hermaphrodite parent goes first and the male second', () => {
    const cross: AncestorNode = {
      strain: crossChild,
      parents: [founder(maleA), founder(hermB)],
    };
    const text = serializeNotation(ancestryToNotation(cross));
    expect(text.indexOf('dpy-5/+')).toBeLessThan(text.indexOf('unc-119/0'));
  });

  test('a cross of two hermaphrodites is an error', () => {
    expect(() =>
      ancestryToNotation({
        strain: crossChild,
        parents: [founder(hermB), founder(hermB)],
      })
    ).toThrow(NotationGenotypeError);
  });

  test('more than two parents is an error', () => {
    expect(() =>
      ancestryToNotation({
        strain: crossChild,
        parents: [founder(hermB), founder(maleA), founder(hermB)],
      })
    ).toThrow(/3 parents/);
  });
});

describe('walkAncestry', () => {
  // herm B and male A -> cross node X1 -> child C -> self-cross node X2 -> D
  const node = (id: string, strain?: Strain): Node => ({
    id,
    position: { x: 0, y: 0 },
    data: strain,
  });
  const nodes = [
    node('B', hermB),
    node('A', maleA),
    node('X1'),
    node('C', crossChild),
    node('X2'),
    node('D', selfChild),
  ];
  const edge = (source: string, target: string): Edge => ({
    id: `${source}-${target}`,
    source,
    target,
  });
  const edges = [
    edge('B', 'X1'),
    edge('A', 'X1'),
    edge('X1', 'C'),
    edge('C', 'X2'),
    edge('X2', 'D'),
  ];

  test('follows the strain nodes up through the cross nodes', () => {
    const tree = walkAncestry(nodes[5] as Node<Strain>, nodes, edges);
    expect(tree.strain).toBe(selfChild);
    expect(tree.parents).toHaveLength(1);
    expect(tree.parents[0].strain).toBe(crossChild);
    expect(tree.parents[0].parents.map((parent) => parent.strain)).toEqual([
      hermB,
      maleA,
    ]);
  });

  test('a founder has no parents, and the notation matches the design example', () => {
    expect(
      walkAncestry(nodes[0] as Node<Strain>, nodes, edges).parents
    ).toEqual([]);
    expect(
      serializeNotation(
        ancestryToNotation(walkAncestry(nodes[5] as Node<Strain>, nodes, edges))
      )
    ).toBe(
      '{{{dpy-5/+ +/+}{unc-119/0}{dpy-5/dpy-5 unc-119/+}}{}{dpy-5/dpy-5 unc-119/unc-119}}'
    );
  });
});

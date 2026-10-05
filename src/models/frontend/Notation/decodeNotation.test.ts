import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { type Node } from 'reactflow';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { NodeType, Sex } from 'models/enums';
import { Allele } from 'models/frontend/Allele/Allele';
import { Gene } from 'models/frontend/Gene/Gene';
import { type Strain } from 'models/frontend/Strain/Strain';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import {
  decodeNotation,
  type CrossResult,
  type DecodeDeps,
} from './decodeNotation';
import { NotationGenotypeError } from './notationGenotype';
import { parseNotation } from './notationText';

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});
afterAll(() => {
  clearMocks();
});

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

const a1 = geneAllele('a1', 'IV', 1);
const a2 = geneAllele('a2', 'II', 2);
const x1 = geneAllele('x1', 'X', 3);
const alleles = new Map([a1, a2, x1].map((allele) => [allele.name, allele]));

// Fake canvas side: real crosses (so the offspring are real), recorded calls.
const makeDeps = (): {
  deps: DecodeDeps;
  calls: string[];
  revealed: number[];
} => {
  let id = 0;
  let roots = 0;
  const calls: string[] = [];
  const revealed: number[] = [];
  const childrenOf = (
    kids: Strain[],
    middleId: string
  ): CrossResult['childNodes'] =>
    kids.map((data) => ({
      id: `child${++id}`,
      data,
      position: { x: 0, y: 0 },
      parentNode: middleId,
      type: NodeType.Strain,
    }));
  const deps: DecodeDeps = {
    createId: () => `n${++id}`,
    placeRoot: (node) => {
      roots++;
      node.position = { x: 1000 * roots, y: 0 };
      calls.push(`placeRoot ${node.id}`);
    },
    selfCross: async (parent) => {
      calls.push(`selfCross ${parent.id}`);
      parent.data.isParent = true;
      const middle = { id: `x${++id}`, position: { x: 0, y: 0 }, data: {} };
      const childNodes = childrenOf(await parent.data.selfCross(), middle.id);
      return { nodes: [parent, middle, ...childNodes], edges: [], childNodes };
    },
    matedCross: async (herm, male, fromHerm) => {
      calls.push(`matedCross ${herm.id} ${male.id} ${String(fromHerm)}`);
      herm.data.isParent = true;
      male.data.isParent = true;
      const middle = { id: `x${++id}`, position: { x: 0, y: 0 }, data: {} };
      const childNodes = childrenOf(
        await male.data.crossWith(herm.data),
        middle.id
      );
      return {
        nodes: [herm, male, middle, ...childNodes],
        edges: [],
        childNodes,
      };
    },
    revealChild: (_result, index) => {
      revealed.push(index);
    },
  };
  return { deps, calls, revealed };
};

const decode = async (
  text: string,
  deps: DecodeDeps
): ReturnType<typeof decodeNotation> =>
  await decodeNotation(parseNotation(text), alleles, deps);

describe('decodeNotation', () => {
  test('a lone founder is one placed card', async () => {
    const { deps, calls } = makeDeps();
    const result = await decode('{a1/+ +/+}', deps);
    expect(result.nodes).toHaveLength(1);
    expect(result.card.data.sex).toBe(Sex.Hermaphrodite);
    expect(calls).toEqual([`placeRoot ${result.card.id}`]);
  });

  test('a cross: the founders are placed once and the recorded child is picked', async () => {
    const { deps, calls, revealed } = makeDeps();
    const result = await decode('{{a1/+ +/+}{x1/0}{a1/+ x1/+}}', deps);
    // herm founder placed as a root, male placed from it
    expect(calls[0]).toMatch(/^placeRoot /);
    expect(calls[1]).toMatch(/^matedCross .* true$/);
    expect(calls).toHaveLength(2);
    expect(result.card.data.sex).toBe(Sex.Hermaphrodite);
    expect(result.card.parentNode).toBeDefined();
    expect(revealed).toHaveLength(1);
    // parents, the middle node, then the offspring - all of them
    expect(result.nodes.length).toBeGreaterThan(4);
    expect(result.nodes.slice(0, 2).map((n: Node) => n.data.isParent)).toEqual([
      true,
      true,
    ]);
  });

  test('a male offspring is the matching child made a male', async () => {
    const { deps } = makeDeps();
    const result = await decode('{{a1/+ +/+}{x1/0}{a1/+ x1/0}}', deps);
    expect(result.card.data.sex).toBe(Sex.Male);
  });

  test('a self-cross of a cross child: one root, no second placement', async () => {
    const { deps, calls } = makeDeps();
    const result = await decode(
      '{{{a1/+ +/+}{x1/0}{a1/+ x1/+}}{}{a1/a1 x1/x1}}',
      deps
    );
    expect(calls.filter((call) => call.startsWith('placeRoot'))).toHaveLength(
      1
    );
    expect(calls[calls.length - 1]).toMatch(/^selfCross /);
    expect(result.card.data.sex).toBe(Sex.Hermaphrodite);
  });

  test('a new founder crossed with a placed male is positioned from him', async () => {
    const { deps, calls } = makeDeps();
    // The male parent is itself the male child of an earlier cross; the herm
    // parent is a new founder.
    const result = await decode(
      '{{a1/+ +/+}{{a2/+ +/+}{x1/0}{a2/+ x1/0}}{a1/+ a2/+ x1/+}}',
      deps
    );
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/^placeRoot /);
    expect(calls[1]).toMatch(/^matedCross .* true$/);
    // the outer cross places the new herm from the male: fromHerm is false
    expect(calls[2]).toMatch(/^matedCross .* false$/);
    expect(result.card.data.sex).toBe(Sex.Hermaphrodite);
  });

  test('no child fits: an error that names the genotype', async () => {
    const { deps } = makeDeps();
    await expect(decode('{{a1/+ +/+}{x1/0}{a2/a2 +/+}}', deps)).rejects.toThrow(
      /not one of the possible offspring/
    );
    await expect(decode('{{a1/+ +/+}{x1/0}{a2/a2 +/+}}', deps)).rejects.toThrow(
      NotationGenotypeError
    );
  });

  test('an unknown allele is an error', async () => {
    const { deps } = makeDeps();
    await expect(decode('{nope/+ +/+}', deps)).rejects.toThrow(
      /Unknown allele "nope"/
    );
  });
});

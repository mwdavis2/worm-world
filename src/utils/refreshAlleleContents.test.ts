import { describe, expect, test } from 'vitest';
import { type Node } from 'reactflow';
import { NodeType } from 'models/enums';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { refreshAlleleContents } from './refreshAlleleContents';

const arrayAllele = (contents?: string): Allele =>
  new Allele({
    name: 'oxEx2254',
    variation: new Variation({ name: 'oxEx2254', chromosome: 'Ex' }),
    contents,
  });

const strainNode = (id: string, allele: Allele): Node<Strain> => ({
  id,
  type: NodeType.Strain,
  position: { x: 0, y: 0 },
  data: new Strain({ allelePairs: [allele.toTopHet()] }),
});

describe('refreshAlleleContents', () => {
  test('fills in contents a saved strain is missing, with a fresh Strain so cards re-render', () => {
    const node = strainNode('a', arrayAllele(undefined));
    const before = node.data;

    const [after] = refreshAlleleContents(
      [node],
      new Map([['oxEx2254', '[Pmyo-3::GFP]']])
    );

    expect(after).not.toBe(node);
    expect(after.data).not.toBe(before);
    const array = (after.data as Strain)
      .getAlleles()
      .find((allele) => allele.name === 'oxEx2254');
    expect(array?.contents).toBe('[Pmyo-3::GFP]');
  });

  test('updates out-of-date text, and clears it when the table has none', () => {
    const [updated] = refreshAlleleContents(
      [strainNode('a', arrayAllele('old'))],
      new Map([['oxEx2254', 'new']])
    );
    expect(
      (updated.data as Strain).getAlleles().find((a) => a.name === 'oxEx2254')
        ?.contents
    ).toBe('new');

    const [cleared] = refreshAlleleContents(
      [strainNode('b', arrayAllele('old'))],
      new Map([['oxEx2254', undefined]])
    );
    expect(
      (cleared.data as Strain).getAlleles().find((a) => a.name === 'oxEx2254')
        ?.contents
    ).toBeUndefined();
  });

  test('leaves nodes alone when nothing changed, when the allele is unknown, and for non-strain nodes', () => {
    const upToDate = strainNode('a', arrayAllele('same'));
    const unknown = strainNode('b', arrayAllele('whatever'));
    const middle: Node = {
      id: 'm',
      type: NodeType.Self,
      position: { x: 0, y: 0 },
      data: {},
    };
    const result = refreshAlleleContents(
      [upToDate, unknown, middle],
      new Map([
        ['oxEx2254', 'same'],
        ['other', 'x'],
      ])
    );
    expect(result[0]).toBe(upToDate);
    expect(result[2]).toBe(middle);

    const unknownOnly = refreshAlleleContents([unknown], new Map());
    expect(unknownOnly[0]).toBe(unknown);
  });

  test('never touches the wild-type allele', () => {
    const node = strainNode('a', arrayAllele('x'));
    const [after] = refreshAlleleContents([node], new Map([['+', 'nope']]));
    expect(after).toBe(node);
  });
});

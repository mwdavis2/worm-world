import { describe, expect, test } from 'vitest';
import CrossDesign from 'models/frontend/CrossDesign/CrossDesign';
import { simpleCrossDesign } from 'models/frontend/CrossDesign/CrossDesign.mock';
import { fixNodeDeserialization } from 'models/frontend/CrossDesign/fixNodeDeserialization';
import { type Strain } from 'models/frontend/Strain/Strain';
import { NodeType } from 'models/enums';
import { ed3 } from 'models/frontend/Allele/Allele.mock';

// a design as the home page and the editor first get it: back from JSON
const readBack = (): CrossDesign =>
  CrossDesign.fromJSON(simpleCrossDesign.toJSON());

describe('fixNodeDeserialization', () => {
  test('a design read back from JSON cannot yet report its strains alleles', () => {
    expect(() => readBack().getDataNames()).toThrow();
  });

  test('after it runs, the strains are real again', () => {
    const design = readBack();
    fixNodeDeserialization(design);
    design.nodes
      .filter((node) => node.type === NodeType.Strain)
      .forEach((node) => {
        expect((node.data as Strain).chromPairMap).toBeInstanceOf(Map);
      });
    expect(design.getDataNames().alleleNames).toEqual([ed3.name]);
  });

  test('the middle nodes get their sets back', () => {
    const design = readBack();
    fixNodeDeserialization(design);
    const middle = design.nodes.find((node) => node.type === NodeType.X);
    expect(middle?.data.hiddenNodes).toBeInstanceOf(Set);
  });
});

import { NodeType } from 'models/enums';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { ChromosomePair } from 'models/frontend/ChromosomePair/ChromosomePair';
import type CrossDesign from 'models/frontend/CrossDesign/CrossDesign';
import { type Strain } from 'models/frontend/Strain/Strain';
import StrainFilter from 'models/frontend/StrainFilter/StrainFilter';
import { type Node } from 'reactflow';

/**
 * A cross design read back from JSON (`CrossDesign.fromJSON`) holds its strain
 * nodes with plain-object chromosome pairs and its filter nodes with plain
 * arrays. This rebuilds the real `Map`s, `Set`s and pair objects in place, which
 * the editor needs before it can open the design and which anything that reads
 * a strain's alleles needs too (for instance exporting a design with its data).
 */
export const fixNodeDeserialization = (crossDesign: CrossDesign): void => {
  for (const node of crossDesign.nodes) {
    if (node.type === NodeType.Strain) {
      const strainNode: Node<Strain> = node;
      const chromPairObj = strainNode.data.chromPairMap as unknown as Record<
        string,
        ChromosomePair
      >;
      const chromPairMap = new Map();
      for (const key in chromPairObj) {
        chromPairMap.set(
          key,
          new ChromosomePair(
            chromPairObj[key].allelePairs.map((pair: unknown) =>
              AllelePair.fromJSON(JSON.stringify(pair))
            )
          )
        );
      }
      strainNode.data.chromPairMap = chromPairMap;
    }
    if (node.type === NodeType.X || node.type === NodeType.Self) {
      const middleNode: Node<StrainFilter> = node;
      middleNode.data.alleleNames = new Set(middleNode.data.alleleNames);
      middleNode.data.reqConditions = new Set(middleNode.data.reqConditions);
      middleNode.data.supConditions = new Set(middleNode.data.supConditions);
      middleNode.data.exprPhenotypes = new Set(middleNode.data.exprPhenotypes);
      middleNode.data.hiddenNodes = new Set(middleNode.data.hiddenNodes);
      middleNode.data = new StrainFilter({ ...middleNode.data });
    }
  }
};

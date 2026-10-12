import { NodeType } from 'models/enums';
import {
  getMotherPhenotypes,
  type PhenotypeCache,
} from 'models/frontend/CrossDesign/motherPhenotypes';
import { type Strain } from 'models/frontend/Strain/Strain';
import { type StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { getIncomers, type Edge, type Node } from 'reactflow';

/**
 * A child card's stored phenotype info (`lethal`, `exprPhenotypeNames`) is only
 * as good as its last refresh, and what it expresses depends on the card's
 * genotype, on the alleles of the cross's parents and on the cross's active
 * conditions. Anything that changes one of those must call one of these.
 */

/**
 * A card that no cross made (added, pasted, or loaded from a saved strain) has
 * no parents, conditions or mother to resolve against: it shows what its own
 * genotype expresses.
 */
export const refreshFounderCardInfo = (nodes: Array<Node<any>>): void => {
  nodes
    .filter(
      (node) => node.type === NodeType.Strain && node.parentNode === undefined
    )
    .forEach((founder: Node<Strain>) => {
      founder.data.refreshCardInfo();
    });
};

/** Refreshes one card's stored info against the cross that made it, or on its own if no cross did; ignores anything that is not a strain card. */
export const refreshCardInfoOfChild = (
  child: Node<Strain>,
  nodes: Array<Node<any>>,
  edges: Edge[],
  cache: PhenotypeCache = new Map()
): void => {
  if (child.type !== NodeType.Strain) return;
  if (child.parentNode === undefined) {
    child.data.refreshCardInfo();
    return;
  }
  const middleNode = nodes.find((node) => node.id === child.parentNode) as
    | Node<StrainFilter>
    | undefined;
  if (
    middleNode === undefined ||
    (middleNode.type !== NodeType.Self && middleNode.type !== NodeType.X)
  )
    return;
  const parentAlleles = getIncomers(middleNode, nodes, edges).flatMap(
    (parent: Node<Strain>) => parent.data.getNonWildAlleles()
  );
  child.data.refreshCardInfo(
    parentAlleles,
    middleNode.data.activeConditions,
    getMotherPhenotypes(middleNode, nodes, edges, cache)
  );
};

/** Refreshes every child card in the design (used when a design opens or its allele data changes). */
export const refreshCardInfoOfChildren = (
  nodes: Array<Node<any>>,
  edges: Edge[]
): void => {
  const cache: PhenotypeCache = new Map();
  refreshFounderCardInfo(nodes);
  nodes
    .filter((node) => node.parentNode !== undefined)
    .forEach((child: Node<Strain>) => {
      refreshCardInfoOfChild(child, nodes, edges, cache);
    });
};

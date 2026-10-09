import { NodeType } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';
import { type StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { getIncomers, type Edge, type Node } from 'reactflow';

/**
 * A child card's stored phenotype info (`lethal`, `exprPhenotypeNames`) is only
 * as good as its last refresh, and what it expresses depends on the card's
 * genotype, on the alleles of the cross's parents and on the cross's active
 * conditions. Anything that changes one of those must call one of these.
 */

/** Refreshes one card's stored info; does nothing for a card that is not a child of a cross. */
export const refreshCardInfoOfChild = (
  child: Node<Strain>,
  nodes: Array<Node<any>>,
  edges: Edge[]
): void => {
  if (child.parentNode === undefined) return;
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
  child.data.refreshCardInfo(parentAlleles, middleNode.data.activeConditions);
};

/** Refreshes every child card in the design (used when a design opens or its allele data changes). */
export const refreshCardInfoOfChildren = (
  nodes: Array<Node<any>>,
  edges: Edge[]
): void => {
  nodes
    .filter((node) => node.parentNode !== undefined)
    .forEach((child: Node<Strain>) => {
      refreshCardInfoOfChild(child, nodes, edges);
    });
};

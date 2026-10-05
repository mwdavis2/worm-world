// A card's ancestry as notation (todo #5): the tree of its parents, walked from
// the live canvas by the caller, becomes a NotationNode.
import { getIncomers, type Edge, type Node } from 'reactflow';
import { Sex } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';
import { NotationGenotypeError, strainToLoci } from './notationGenotype';
import { type NotationNode } from './notationText';

export interface AncestorNode {
  strain: Strain;
  // None for a founder, one for a self-cross, two for a cross
  parents: AncestorNode[];
}

/**
 * The notation tree of a card and its ancestry. The hermaphrodite parent of a
 * cross goes in the first slot and the male in the second; a self-cross has one
 * parent and an empty second slot.
 */
export const ancestryToNotation = (card: AncestorNode): NotationNode => {
  const loci = strainToLoci(card.strain);
  const { parents } = card;
  if (parents.length === 0) return { kind: 'founder', loci };
  if (parents.length === 1)
    return {
      kind: 'cross',
      herm: ancestryToNotation(parents[0]),
      male: undefined,
      loci,
    };
  if (parents.length > 2)
    throw new NotationGenotypeError(
      `A strain cannot have ${parents.length} parents`
    );
  const herm = parents.find(
    (parent) => parent.strain.sex === Sex.Hermaphrodite
  );
  const male = parents.find((parent) => parent.strain.sex === Sex.Male);
  if (herm === undefined || male === undefined)
    throw new NotationGenotypeError(
      'A cross needs one hermaphrodite and one male parent'
    );
  return {
    kind: 'cross',
    herm: ancestryToNotation(herm),
    male: ancestryToNotation(male),
    loci,
  };
};

/**
 * Walks the live canvas from a strain node up through its crosses: a strain's
 * incoming edge comes from a cross (or self-cross) node, whose incoming edges
 * come from the parent strains.
 */
export const walkAncestry = (
  node: Node<Strain>,
  nodes: Node[],
  edges: Edge[]
): AncestorNode => ({
  strain: node.data,
  parents: getIncomers(node, nodes, edges)
    .flatMap((crossNode) => getIncomers(crossNode, nodes, edges))
    .map((parent) => walkAncestry(parent as Node<Strain>, nodes, edges)),
});

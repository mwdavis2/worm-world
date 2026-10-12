import { NodeType, Sex } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';
import { type StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { getIncomers, type Edge, type Node } from 'reactflow';

/**
 * Maternal-effect relations ask what the hermaphrodite MOTHER of a card
 * expresses, so a card's resolution needs her phenotypes. They are derived
 * from the design graph (nothing is stored on a card): the mother of a child
 * is the hermaphrodite parent of the cross that made it - the single parent of
 * a self-cross. A card that was not made by a cross has no mother.
 *
 * A mother's own phenotypes are resolved in her own context (her parents'
 * alleles, her cross's active conditions and her own mother, recursively), and
 * kept in a cache shared by a whole refresh pass so each ancestor is resolved
 * once.
 */

/** Unique names (`Phenotype.getUniqueName()`) of what a card expresses, by card id. */
export type PhenotypeCache = Map<string, ReadonlySet<string>>;

/** The hermaphrodite parent of a cross; the only parent of a self-cross. */
export const pickMother = <T extends { sex: Sex }>(
  parents: T[]
): T | undefined =>
  parents.length === 1
    ? parents[0]
    : parents.find((parent) => parent.sex === Sex.Hermaphrodite);

const isCrossNode = (node: Node | undefined): node is Node<StrainFilter> =>
  node !== undefined &&
  (node.type === NodeType.Self || node.type === NodeType.X);

/**
 * What the mother of the children of `middleNode` expresses, or undefined when
 * the cross has no mother to ask.
 */
export const getMotherPhenotypes = (
  middleNode: Node,
  nodes: Array<Node<any>>,
  edges: Edge[],
  cache: PhenotypeCache = new Map(),
  visiting: Set<string> = new Set()
): ReadonlySet<string> | undefined => {
  const parents = getIncomers(middleNode, nodes, edges) as Array<Node<Strain>>;
  const mother = pickMother(
    parents.map((parent) => ({ sex: parent.data.sex, parent }))
  )?.parent;
  if (mother === undefined) return undefined;
  return getCardPhenotypes(mother, nodes, edges, cache, visiting);
};

/** What a card expresses, resolved in the context of the cross that made it. */
export const getCardPhenotypes = (
  card: Node<Strain>,
  nodes: Array<Node<any>>,
  edges: Edge[],
  cache: PhenotypeCache = new Map(),
  visiting: Set<string> = new Set()
): ReadonlySet<string> => {
  const known = cache.get(card.id);
  if (known !== undefined) return known;
  // A cycle cannot be drawn in a design, but never loop if one is saved.
  if (visiting.has(card.id)) return new Set();
  visiting.add(card.id);

  const middleNode =
    card.parentNode === undefined
      ? undefined
      : nodes.find((node) => node.id === card.parentNode);
  let expressed;
  if (isCrossNode(middleNode)) {
    const parentAlleles = (
      getIncomers(middleNode, nodes, edges) as Array<Node<Strain>>
    ).flatMap((parent) => parent.data.getNonWildAlleles());
    expressed = card.data.getExprPhenotypes(
      parentAlleles,
      middleNode.data.activeConditions,
      getMotherPhenotypes(middleNode, nodes, edges, cache, visiting)
    );
  } else {
    expressed = card.data.getExprPhenotypes();
  }

  visiting.delete(card.id);
  const names = new Set(expressed.map((phen) => phen.getUniqueName()));
  cache.set(card.id, names);
  return names;
};

/** A strain and the strains it was made from (see `CrossDesign.getTaskTree`). */
export interface StrainAncestry {
  strain: Strain;
  parents: StrainAncestry[];
}

/** What the mother in an ancestry tree expresses (no conditions are applied), or undefined without one. */
export const getAncestryMotherPhenotypes = (
  tree: StrainAncestry
): ReadonlySet<string> | undefined => {
  const mother = pickMother(
    tree.parents.map((parent) => ({ sex: parent.strain.sex, parent }))
  )?.parent;
  if (mother === undefined) return undefined;
  return new Set(
    mother.strain
      .getExprPhenotypes(
        mother.parents.flatMap((p) => p.strain.getNonWildAlleles()),
        new Set<string>(),
        getAncestryMotherPhenotypes(mother)
      )
      .map((phen) => phen.getUniqueName())
  );
};

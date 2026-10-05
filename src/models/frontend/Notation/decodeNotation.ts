// Rebuilds a notation's crosses on the canvas (todo #5 decode): founders are
// made from the text, each cross is re-run, and the child the notation records
// becomes the next parent. The canvas side - how a cross is performed and how
// cards are placed - is injected, so this stays testable.
import { type Edge, type Node } from 'reactflow';
import { NodeType } from 'models/enums';
import { type Allele } from 'models/frontend/Allele/Allele';
import { type Strain } from 'models/frontend/Strain/Strain';
import {
  lociToStrain,
  matchChild,
  NotationGenotypeError,
} from './notationGenotype';
import { type NotationNode } from './notationText';

/** What performing one cross produced (nothing is committed to the canvas). */
export interface CrossResult {
  // Every node the cross creates or updates: its parents, then the middle node,
  // then the children - parents first, as the canvas needs
  nodes: Node[];
  edges: Edge[];
  // The children, in the order the cross listed them
  childNodes: Array<Node<Strain>>;
}

export interface DecodeDeps {
  createId: () => string;
  selfCross: (parent: Node<Strain>) => Promise<CrossResult>;
  matedCross: (
    herm: Node<Strain>,
    male: Node<Strain>,
    fromHerm: boolean
  ) => Promise<CrossResult>;
  // Gives a card that starts a lineage its own place on the canvas
  placeRoot: (node: Node<Strain>) => void;
  // Makes the chosen child visible even if the default filters hid it
  revealChild: (result: CrossResult, index: number) => void;
}

export interface DecodeResult {
  // The card the notation describes
  card: Node<Strain>;
  // Everything to add to the canvas, parents before children
  nodes: Node[];
  edges: Edge[];
}

interface Built {
  node: Node<Strain>;
  // Whether the canvas already gives this card a place (it is a child of a
  // cross built earlier), or it is a new founder waiting for one
  placed: boolean;
}

export const decodeNotation = async (
  tree: NotationNode,
  alleles: Map<string, Allele>,
  deps: DecodeDeps
): Promise<DecodeResult> => {
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];

  const build = async (notation: NotationNode): Promise<Built> => {
    const strain = lociToStrain(notation.loci, alleles);
    if (notation.kind === 'founder')
      return {
        node: {
          id: deps.createId(),
          data: strain,
          position: { x: 0, y: 0 },
          type: NodeType.Strain,
        },
        placed: false,
      };

    const herm = await build(notation.herm);
    const male =
      notation.male === undefined ? undefined : await build(notation.male);

    let result: CrossResult;
    if (male === undefined) {
      if (!herm.placed) deps.placeRoot(herm.node);
      result = await deps.selfCross(herm.node);
    } else {
      // A new founder is positioned from the card it is crossed with; two new
      // founders start a lineage at a fresh place.
      let fromHerm = true;
      if (!herm.placed && !male.placed) deps.placeRoot(herm.node);
      else if (!herm.placed) fromHerm = false;
      result = await deps.matedCross(herm.node, male.node, fromHerm);
    }
    result.nodes.forEach((node) => nodes.set(node.id, node));
    edges.push(...result.edges);

    const match = matchChild(
      result.childNodes.map((child) => child.data),
      strain
    );
    if (match === undefined)
      throw new NotationGenotypeError(
        `${strain.toString()} is not one of the possible offspring of that cross`
      );
    const child = result.childNodes[match.index];
    child.data = match.strain;
    deps.revealChild(result, match.index);
    return { node: child, placed: true };
  };

  const root = await build(tree);
  if (nodes.size === 0) {
    // Just a founder: no cross to carry it, so it is the whole result
    deps.placeRoot(root.node);
    nodes.set(root.node.id, root.node);
  }
  return { card: root.node, nodes: [...nodes.values()], edges };
};

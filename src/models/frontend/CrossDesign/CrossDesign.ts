import { NodeType, Sex } from 'models/enums';
import { Strain } from 'models/frontend/Strain/Strain';
import { type Node, type Edge, type XYPosition, getIncomers } from 'reactflow';
import { ulid } from 'ulid';
import {
  instanceToPlain,
  plainToInstance,
  Transform,
  Type,
} from 'class-transformer';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import moment from 'moment';
import { Task } from 'models/frontend/Task/Task';
import { getAncestryMotherPhenotypes } from 'models/frontend/CrossDesign/motherPhenotypes';
import {
  STRAIN_NODE_HEIGHT,
  STRAIN_NODE_WIDTH,
} from 'components/StrainNode/StrainNode';
import { type db_CrossDesign } from 'models/db/db_CrossDesign';

export const NODE_PADDING = 36;
// middle nodes (X or Self)
export const MIDDLE_NODE_SIZE = 64;

export interface ICrossDesign {
  name: string;
  nodes: Node[];
  edges: Edge[];
  lastSaved: Date;
  editable: boolean;
  id?: string;
}

export interface TaskTree {
  task: Task;
  parents: TaskTree[];
}

export const addToArray = <T extends { id: string }>(
  items: T[],
  ...newItems: T[]
): T[] => {
  items = [...items];
  newItems.forEach((newItem) => {
    const idx = items.findIndex((item) => item.id === newItem.id);
    if (idx !== -1) {
      items.splice(idx, 1, newItem);
    } else {
      items.push(newItem);
    }
  });
  return items;
};

/**
 * The nodes with any link to a parent that is not among them removed. The
 * canvas throws ("Parent node ... not found") and shows nothing at all when a
 * node names a missing parent, which can happen after a card others hang off
 * is deleted; the orphan then simply becomes a free-standing card. Returns the
 * same array when no node is orphaned.
 */
export const dropDanglingParents = <
  T extends { id: string; parentNode?: string }
>(
  nodes: T[]
): T[] => {
  const ids = new Set(nodes.map((node) => node.id));
  if (!nodes.some((n) => n.parentNode !== undefined && !ids.has(n.parentNode)))
    return nodes;
  return nodes.map((node) => {
    if (node.parentNode === undefined || ids.has(node.parentNode)) return node;
    const { parentNode: _missing, ...rest } = node;
    return rest as T;
  });
};

/**
 * The nodes with every parent ahead of its children (the order within each group
 * is kept). React-flow expects this: deleting a card removes only the children it
 * has already met, so a child stored before its parent (a male crossed into a new
 * hermaphrodite) was left behind when the parent was deleted. Returns the same
 * array when it is already in order.
 */
export const parentsFirst = <T extends { id: string; parentNode?: string }>(
  nodes: T[]
): T[] => {
  const position = new Map(nodes.map((node, index) => [node.id, index]));
  const inOrder = nodes.every(
    (node, index) =>
      node.parentNode === undefined ||
      (position.get(node.parentNode) ?? -1) < index
  );
  if (inOrder) return nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const placed = new Set<string>();
  const result: T[] = [];
  const place = (node: T, depth: number): void => {
    if (placed.has(node.id)) return;
    // a parent that is not there, or a loop, must not hang the sort
    const parent =
      node.parentNode === undefined ? undefined : byId.get(node.parentNode);
    if (parent !== undefined && depth < nodes.length) place(parent, depth + 1);
    // (in a loop the parent's own placing may have placed this node already)
    if (placed.has(node.id)) return;
    placed.add(node.id);
    result.push(node);
  };
  nodes.forEach((node) => {
    place(node, 0);
  });
  return result;
};

/**
 * The nodes with the named cards freed from a parent that is itself a card.
 * A mated cross hangs the male under the hermaphrodite so the pair sit side by
 * side, but that link means nothing once the cross is gone: left in place, deleting
 * the hermaphrodite deletes the male, moving her drags him, and crossing him to
 * someone else keeps him tied to her. A freed card keeps its place on the canvas
 * (its position is made absolute). Returns the same array when nothing is freed.
 */
export const detachFromCardParents = <
  T extends {
    id: string;
    type?: string;
    parentNode?: string;
    position: XYPosition;
  }
>(
  nodes: T[],
  ids: Set<string>
): T[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const isFreed = (node: T): boolean =>
    ids.has(node.id) &&
    node.parentNode !== undefined &&
    byId.get(node.parentNode)?.type === NodeType.Strain;
  if (!nodes.some(isFreed)) return nodes;
  const absolute = (node: T): XYPosition => {
    let x = node.position.x;
    let y = node.position.y;
    let parent = node.parentNode;
    for (let hops = 0; parent !== undefined && hops < nodes.length; hops++) {
      const up = byId.get(parent);
      if (up === undefined) break;
      x += up.position.x;
      y += up.position.y;
      parent = up.parentNode;
    }
    return { x, y };
  };
  return nodes.map((node) => {
    if (!isFreed(node)) return node;
    const freed = { ...node, position: absolute(node) };
    delete freed.parentNode;
    return freed;
  });
};

export default class CrossDesign {
  public readonly id: string;
  public name: string;
  public editable: boolean;
  @Type(() => Date)
  public lastSaved: Date;

  @Transform(
    (data: { obj: any }) => {
      const nodes: Node[] = data?.obj?.nodes ?? [];
      return nodes.map((node) => {
        if (node.type === NodeType.Strain) {
          node.data = new Strain((node as Node<Strain>).data);
        } else if (node.type === NodeType.Self || node.type === NodeType.X) {
          // Middle (Self/X) nodes carry a StrainFilter in `.data` - without
          // this, a loaded-from-disk node.data is a plain JSON object with
          // no Set methods (.has, .update, etc.), which crashes the first
          // time the filter modal touches it.
          node.data = StrainFilter.fromJSON(JSON.stringify(node.data));
        }
        return node;
      });
    },
    { toClassOnly: true }
  )
  public nodes: Node[];

  public edges: Edge[];

  constructor(params: ICrossDesign) {
    if (params === null || params === undefined) {
      params = {
        name: '',
        nodes: [],
        edges: [],
        lastSaved: new Date(),
        editable: false,
      };
    }
    this.id = params.id ?? ulid();
    this.name = params.name;
    this.lastSaved = params.lastSaved;
    this.edges = [...params.edges];
    this.nodes = [...params.nodes];
    this.editable = params.editable;
  }

  /**
   * @param refNode Strain node that is the direct parent of the self icon
   * @returns XY coordinates of where to place the self icon in the editor
   */
  public static getSelfNodePos(): XYPosition {
    return {
      x: STRAIN_NODE_WIDTH / 2 - MIDDLE_NODE_SIZE / 2,
      y: STRAIN_NODE_HEIGHT + NODE_PADDING,
    };
  }

  public static getXNodePos(
    hermNode: Node<Strain>,
    relative = true
  ): XYPosition {
    const x = STRAIN_NODE_WIDTH + 2 * NODE_PADDING;
    const y = STRAIN_NODE_HEIGHT / 2 - MIDDLE_NODE_SIZE / 2;
    return relative
      ? {
          x,
          y,
        }
      : { x: x + hermNode.position.x, y: y + hermNode.position.y };
  }

  public static getRelStrainPos(
    matedNode: Node<Strain>,
    relative = true
  ): XYPosition {
    const x =
      (STRAIN_NODE_WIDTH +
        2 * NODE_PADDING +
        MIDDLE_NODE_SIZE +
        2 * NODE_PADDING) *
      (matedNode.data.sex === Sex.Hermaphrodite ? 1 : -1);
    return { x, y: 0 };
  }

  /**
   * Links the two parents of a mated cross and places the one that is new.
   * The male becomes a child of the hermaphrodite (so his position is relative
   * to hers), unless he already has a parent from an earlier cross. A parent
   * with a parent already keeps its position; only a new one is placed:
   * - from the hermaphrodite: a new male goes to her right;
   * - from the male (`fromHerm` false): a new hermaphrodite goes to his left,
   *   and he, now her child, gets the matching position relative to her
   *   instead of keeping the canvas position he had (which the canvas would
   *   read as relative to her, throwing him far across the canvas).
   */
  public static placeMatedParents(
    hermNode: Node<Strain>,
    maleNode: Node<Strain>,
    fromHerm = true
  ): void {
    const maleAlreadyPlaced = maleNode.parentNode !== undefined;
    const hermAlreadyPlaced = hermNode.parentNode !== undefined;
    maleNode.parentNode = maleNode.parentNode ?? hermNode.id;

    if (fromHerm) {
      if (!maleAlreadyPlaced)
        maleNode.position = CrossDesign.getRelStrainPos(hermNode);
    } else if (!hermAlreadyPlaced) {
      const tempPos = CrossDesign.getRelStrainPos(maleNode);
      // where the male really is on the canvas (his own position is relative
      // to his parent when he has one)
      const maleAbsolute = maleNode.positionAbsolute ?? maleNode.position;
      hermNode.position = {
        x: maleAbsolute.x + tempPos.x,
        y: maleAbsolute.y + tempPos.y,
      };
      if (!maleAlreadyPlaced)
        maleNode.position = { x: -tempPos.x, y: -tempPos.y };
    }
  }

  public static getAbsolutePos(relPos: XYPosition, node: Node): XYPosition {
    return { x: relPos.x + node.position.x, y: relPos.y + node.position.y };
  }

  /** @returns List of XY coordinates (relative to middle node position) */
  public static calculateChildPositions(
    middleNodeType: NodeType.X | NodeType.Self,
    childCount: number
  ): XYPosition[] {
    const positions: XYPosition[] = [];
    const maxNodesInRow = 5;
    const xMidpoint = MIDDLE_NODE_SIZE / 2;
    const deltaX = STRAIN_NODE_WIDTH + NODE_PADDING;
    const deltaY = STRAIN_NODE_HEIGHT + NODE_PADDING;

    let y =
      middleNodeType === NodeType.X
        ? MIDDLE_NODE_SIZE / 2 + STRAIN_NODE_HEIGHT / 2 + 3 * NODE_PADDING
        : MIDDLE_NODE_SIZE + NODE_PADDING;
    for (let i = 0; i < childCount; i += maxNodesInRow) {
      const nodesInRow = Math.min(maxNodesInRow, childCount - i);
      const rowWidth = deltaX * nodesInRow - NODE_PADDING;
      let x = xMidpoint - rowWidth / 2;
      for (let j = 0; j < nodesInRow; j++) {
        positions.push({ x, y });
        x += deltaX;
      }
      y += deltaY;
    }

    return positions;
  }

  /**
   * backlog #14: sets each visible sibling's share of just the currently
   * visible set (renormalized so the visible set's shares sum to 100%),
   * instead of its share of the whole unfiltered cross. Mutates
   * `node.data.filteredProbability` in place on every node in `childNodes` -
   * left `undefined` whenever nothing in the group is hidden, since it would
   * otherwise just duplicate `probability` on every card.
   */
  public static applyFilteredProbabilities(
    childNodes: Array<Node<Strain>>
  ): void {
    const visibleNodes = childNodes.filter((node) => !(node.hidden ?? false));
    const anyHidden = visibleNodes.length < childNodes.length;
    if (!anyHidden) {
      childNodes.forEach((node) => {
        node.data.filteredProbability = undefined;
      });
      return;
    }
    const visibleTotal = visibleNodes.reduce(
      (sum, node) => sum + (node.data.probability ?? 0),
      0
    );
    childNodes.forEach((node) => {
      node.data.filteredProbability =
        node.hidden ?? false
          ? undefined
          : visibleTotal > 0
          ? (node.data.probability ?? 0) / visibleTotal
          : undefined;
    });
  }

  /**
   * `applyFilteredProbabilities`, then gives every child a fresh copy of its
   * strain. The figures are written into the strain in place, and a card that is
   * drawn from the same strain object does not redraw, so a card that stayed
   * visible kept showing the "x% shown" of the previous filter (the shown
   * figures added up to more than 100%).
   */
  public static refreshShownProbabilities(
    childNodes: Array<Node<Strain>>
  ): void {
    CrossDesign.applyFilteredProbabilities(childNodes);
    childNodes.forEach((node) => {
      node.data = node.data.clone();
    });
  }

  static fromJSON(json: string): CrossDesign {
    return plainToInstance(
      CrossDesign,
      JSON.parse(json) as Record<string, unknown>
    );
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  /**
   * The names of the saved data this design may rely on: its strains' names
   * and the names of the (non-wild) alleles they carry. An exported bundle looks
   * these up in the data tables to bring along the rows the design needs.
   */
  public getDataNames(): { strainNames: string[]; alleleNames: string[] } {
    const strainNames = new Set<string>();
    const alleleNames = new Set<string>();
    this.nodes
      .filter((node) => node.type === NodeType.Strain)
      .forEach((node) => {
        const strain = node.data as Strain;
        if (strain.name !== undefined && strain.name !== '')
          strainNames.add(strain.name);
        strain.getNonWildAlleles().forEach((allele) => {
          alleleNames.add(allele.name);
        });
      });
    return {
      strainNames: [...strainNames].sort(),
      alleleNames: [...alleleNames].sort(),
    };
  }

  public createId(): string {
    return ulid();
  }

  public clone(newId = false): CrossDesign {
    return new CrossDesign({
      ...this,
      id: newId ? this.createId() : this.id,
      nodes: [...this.nodes],
      edges: [...this.edges],
      lastSaved: new Date(),
    });
  }

  // Helper to help validate node order for subflows
  public static nodesAreValid(nodes: Node[]): boolean {
    return nodes.every(
      (node, idx) =>
        !nodes
          .slice(idx)
          .map((followingNode) => followingNode.id)
          .includes(node.parentNode ?? '')
    );
  }

  /** @returns db record of this tree */
  public generateRecord(): db_CrossDesign {
    return {
      name: this.name,
      editable: this.editable,
      id: this.id,
      data: this.toJSON(),
      lastEdited: this.lastSaved.toString(),
    };
  }

  /** @returns list of all tasks for a given node */
  public getTasks(node: Node<Strain>): Task[] {
    const ancestorTree = this.getAncestorTree(node);
    const taskTree = this.getTaskTree(ancestorTree);
    if (taskTree === undefined) {
      return [];
    }
    const tasks: Task[] = [];
    this.makeTreeIntoArray(taskTree, tasks);
    return tasks;
  }

  private makeTreeIntoArray(tree: TaskTree, tasks: Task[]): void {
    tasks.push(tree.task);
    tree.parents.forEach((parent) => {
      this.makeTreeIntoArray(parent, tasks);
    });
  }

  private getTaskTree(
    ancestorTree: AncestorTree,
    childTaskId?: string
  ): TaskTree | undefined {
    if (ancestorTree.parents.length === 0) return undefined;

    const [hermStrain, maleStrain] = ancestorTree.parents.map((parent) =>
      parent.strain.toJSON()
    );

    const task = new Task({
      id: ulid(),
      dueDate: null,
      action: ancestorTree.parents.length === 1 ? 'SelfCross' : 'Cross',
      hermStrain,
      maleStrain: maleStrain ?? null,
      resultStrain: ancestorTree.strain.toJSON(),
      notes: null,
      completed: false,
      crossDesignId: this.id,
      childTaskId: childTaskId ?? null,
      updatedAt: null,
      completedAt: null,
    });

    const parents = ancestorTree.parents.flatMap(
      (parent: AncestorTree) => this.getTaskTree(parent, task.id) ?? []
    );

    const directParentAlleles = ancestorTree.parents.flatMap((parent) =>
      parent.strain.getNonWildAlleles()
    );
    task.dueDate =
      parents[0] === undefined
        ? new Date()
        : moment(parents[0]?.task.dueDate)
            .add(
              ancestorTree.strain.getMaturationDays(
                directParentAlleles,
                undefined,
                getAncestryMotherPhenotypes(ancestorTree)
              ),
              'days'
            )
            .toDate();

    return {
      task,
      parents,
    };
  }

  public getParentStrains(strain: Node<Strain>): Array<Node<Strain>> {
    const middleNodes = getIncomers(strain, this.nodes, this.edges);
    return middleNodes.flatMap((middleNode) =>
      getIncomers(middleNode, this.nodes, this.edges)
    );
  }

  /**
   * Recursively generates a hierarchy of ancestors for a given node
   */
  private getAncestorTree(child: Node): AncestorTree {
    return {
      strain: child.data,
      parents: this.getParentStrains(child).map((parent) =>
        this.getAncestorTree(parent)
      ),
    };
  }
}

interface AncestorTree {
  strain: Strain;
  parents: AncestorTree[];
}

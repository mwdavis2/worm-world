import { type Node, type XYPosition } from 'reactflow';
import { NodeType } from 'models/enums';
import {
  MIDDLE_NODE_SIZE,
  NODE_PADDING,
} from 'models/frontend/CrossDesign/CrossDesign';
import {
  STRAIN_NODE_HEIGHT,
  STRAIN_NODE_WIDTH,
} from 'components/StrainNode/StrainNode';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const sizeOf = (node: Node): { width: number; height: number } => {
  if (node.width != null && node.height != null)
    return { width: node.width, height: node.height };
  if (node.type === NodeType.Strain)
    return { width: STRAIN_NODE_WIDTH, height: STRAIN_NODE_HEIGHT };
  if (node.type === NodeType.X || node.type === NodeType.Self)
    return { width: MIDDLE_NODE_SIZE, height: MIDDLE_NODE_SIZE };
  // notes and anything else: a card-sized guess
  return { width: STRAIN_NODE_WIDTH, height: STRAIN_NODE_HEIGHT };
};

/**
 * The on-canvas box of each visible node. Positions of nodes with a parent are
 * relative to it, so the parent chain is walked (looking parents up in
 * `lookup`, which may hold more nodes than `nodes`).
 */
export const nodeRects = (nodes: Node[], lookup: Node[] = nodes): Rect[] => {
  const byId = new Map(lookup.map((node) => [node.id, node]));
  const absolute = (node: Node): XYPosition => {
    let x = node.position.x;
    let y = node.position.y;
    let parent = node.parentNode;
    // bounded so a malformed parent loop cannot hang the paste
    for (let hops = 0; parent !== undefined && hops < 100; hops++) {
      const parentNode = byId.get(parent);
      if (parentNode === undefined) break;
      x += parentNode.position.x;
      y += parentNode.position.y;
      parent = parentNode.parentNode;
    }
    return { x, y };
  };
  return nodes
    .filter((node) => node.hidden !== true)
    .map((node) => ({ ...absolute(node), ...sizeOf(node) }));
};

const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/**
 * How far to move pasted nodes so they do not sit on the cards already on the
 * canvas. Nothing moves when the paste is already clear; otherwise it goes
 * straight right, to just past everything that is there.
 */
export const pasteShift = (
  pasted: Rect[],
  existing: Rect[],
  gap: number = NODE_PADDING
): XYPosition => {
  if (pasted.length === 0 || existing.length === 0) return { x: 0, y: 0 };
  const hits = pasted.some((p) => existing.some((e) => overlaps(p, e, gap)));
  if (!hits) return { x: 0, y: 0 };
  const left = Math.min(...pasted.map((p) => p.x));
  const right = Math.max(...existing.map((e) => e.x + e.width));
  return { x: right + gap - left, y: 0 };
};

import { type Edge, type Node } from 'reactflow';
import { NodeType } from 'models/enums';
import { NODE_PADDING } from 'models/frontend/CrossDesign/CrossDesign';
import { nodeRects, type Rect } from 'models/frontend/Notation/pastePlacement';

const MAX_STEPS = 1000;

/** The ids of each tree: nodes joined by an edge or a parent link, one group per tree. Lone cards and notes are groups of one. */
const groupTrees = (nodes: Node[], edges: Edge[]): string[][] => {
  const root = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  const find = (id: string): string => {
    let top = id;
    while (root.get(top) !== top) top = root.get(top) ?? top;
    root.set(id, top);
    return top;
  };
  const join = (a: string, b: string): void => {
    if (!root.has(a) || !root.has(b)) return;
    root.set(find(a), find(b));
  };
  edges.forEach((edge) => {
    join(edge.source, edge.target);
  });
  nodes.forEach((node) => {
    if (node.parentNode !== undefined) join(node.id, node.parentNode);
  });
  const groups = new Map<string, string[]>();
  nodes.forEach((node) => {
    const top = find(node.id);
    groups.set(top, [...(groups.get(top) ?? []), node.id]);
  });
  return [...groups.values()];
};

const clash = (a: Rect, b: Rect, gap: number): boolean =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/**
 * Slides whole trees to the right until no card of one tree touches a card of
 * another. A tree is never reshaped: only its top-level cards (those without a
 * parent card) move, and every other card is placed relative to them. Trees are
 * taken in reading order (top to bottom, then left to right); the first stays
 * put, and each later one moves only if it overlaps one already settled.
 *
 * Notes are not trees and are never checked for overlap: a note on a tree is
 * most likely about it, so it stays put unless that tree moves, and then the
 * notes that overlap the tree travel with it (each note moves at most once).
 * A note on no tree is an obstacle: a tree sliding right goes around it.
 *
 * Returns the nodes with their new positions (the same objects when nothing
 * moved), and how many trees moved.
 */
export const tidyTrees = (
  nodes: Node[],
  edges: Edge[],
  gap: number = NODE_PADDING
): { nodes: Node[]; moved: number } => {
  const notes = nodes.filter((n) => n.type === NodeType.Note);
  const treeNodes = nodes.filter((n) => n.type !== NodeType.Note);
  const byId = new Map(treeNodes.map((n) => [n.id, n]));
  const trees = groupTrees(treeNodes, edges)
    .map((ids) => {
      const members = ids.map((id) => byId.get(id) as Node);
      return { members, rects: nodeRects(members, treeNodes) };
    })
    .filter((tree) => tree.rects.length > 0);
  const edge = (rects: Rect[]): { x: number; y: number } => ({
    x: Math.min(...rects.map((r) => r.x)),
    y: Math.min(...rects.map((r) => r.y)),
  });
  trees.sort((a, b) => {
    const pa = edge(a.rects);
    const pb = edge(b.rects);
    return pa.y !== pb.y ? pa.y - pb.y : pa.x - pb.x;
  });

  // A loose note lies on no tree. It stays where it is and a tree sliding
  // right goes around it (a note on a tree is that tree's own, and travels
  // with it instead).
  const looseNotes = notes
    .flatMap((note) => nodeRects([note], nodes))
    .filter((rect) =>
      trees.every((tree) => tree.rects.every((r) => !clash(rect, r, 0)))
    );

  const shifts = new Map<Node[], number>();
  const settled: Rect[][] = [];
  trees.forEach((tree) => {
    let dx = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      let push = 0;
      tree.rects.forEach((mine) => {
        const here = { ...mine, x: mine.x + dx };
        settled.forEach((other) => {
          other.forEach((theirs) => {
            if (clash(here, theirs, gap))
              push = Math.max(push, theirs.x + theirs.width + gap - here.x);
          });
        });
      });
      tree.rects.forEach((mine) => {
        const here = { ...mine, x: mine.x + dx };
        looseNotes.forEach((note) => {
          if (clash(here, note, 0))
            push = Math.max(push, note.x + note.width + gap - here.x);
        });
      });
      if (push <= 0) break;
      dx += push;
    }
    if (dx > 0) shifts.set(tree.members, dx);
    settled.push(tree.rects.map((r) => ({ ...r, x: r.x + dx })));
  });

  if (shifts.size === 0) return { nodes, moved: 0 };
  const moveBy = new Map<string, number>();
  const noteRects = notes.map((note) => ({
    note,
    rect: nodeRects([note], nodes)[0] as Rect | undefined,
  }));
  trees.forEach((tree) => {
    const dx = shifts.get(tree.members);
    if (dx === undefined) return;
    tree.members.forEach((m) => {
      if (m.parentNode === undefined) moveBy.set(m.id, dx);
    });
    // notes lying on the tree (where it was) go with it
    noteRects.forEach(({ note, rect }) => {
      if (
        rect !== undefined &&
        note.parentNode === undefined &&
        !moveBy.has(note.id) &&
        tree.rects.some((r) => clash(rect, r, 0))
      )
        moveBy.set(note.id, dx);
    });
  });
  return {
    nodes: nodes.map((n) => {
      const dx = moveBy.get(n.id);
      return dx === undefined
        ? n
        : { ...n, position: { x: n.position.x + dx, y: n.position.y } };
    }),
    moved: shifts.size,
  };
};

import { type Edge, type Node } from 'reactflow';
import { describe, expect, test } from 'vitest';
import { NodeType } from 'models/enums';
import { nodeRects } from 'models/frontend/Notation/pastePlacement';
import { tidyTrees } from './tidyTrees';

const card = (
  id: string,
  x: number,
  y: number,
  extra: Partial<Node> = {}
): Node => ({
  id,
  type: NodeType.Strain,
  position: { x, y },
  data: {},
  ...extra,
});
const link = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
});

// A small tree: a herm, a cross node next to it, and a child under that.
const tree = (prefix: string, x: number, y: number): [Node[], Edge[]] => [
  [
    card(`${prefix}h`, x, y),
    card(`${prefix}x`, 300, 40, { type: NodeType.X, parentNode: `${prefix}h` }),
    card(`${prefix}c`, 0, 200, { parentNode: `${prefix}x` }),
  ],
  [link(`${prefix}h`, `${prefix}x`), link(`${prefix}x`, `${prefix}c`)],
];

const anyOverlap = (nodes: Node[], edges: Edge[]): boolean => {
  const owner = new Map<string, number>();
  let next = 0;
  nodes.forEach((n) => {
    if (!owner.has(n.id)) owner.set(n.id, next++);
  });
  // compare cards of different trees: group by tree prefix (first char)
  const groups = new Map<string, Node[]>();
  nodes.forEach((n) => {
    groups.set(n.id[0], [...(groups.get(n.id[0]) ?? []), n]);
  });
  const rectsOf = [...groups.values()].map((g) => nodeRects(g, nodes));
  for (let i = 0; i < rectsOf.length; i++)
    for (let j = i + 1; j < rectsOf.length; j++)
      for (const a of rectsOf[i])
        for (const b of rectsOf[j])
          if (
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height
          )
            return true;
  void edges;
  return false;
};

describe('tidyTrees', () => {
  test('trees that do not overlap stay exactly where they are', () => {
    const [n1, e1] = tree('a', 0, 0);
    const [n2, e2] = tree('b', 0, 2000);
    const result = tidyTrees([...n1, ...n2], [...e1, ...e2]);
    expect(result.moved).toBe(0);
    expect(result.nodes).toEqual([...n1, ...n2]);
  });

  test('overlapping trees are slid apart, and a tree keeps its own shape', () => {
    const [n1, e1] = tree('a', 0, 0);
    const [n2, e2] = tree('b', 100, 50);
    const before = [...n1, ...n2];
    expect(anyOverlap(before, [...e1, ...e2])).toBe(true);
    const result = tidyTrees(before, [...e1, ...e2]);
    expect(result.moved).toBe(1);
    expect(anyOverlap(result.nodes, [...e1, ...e2])).toBe(false);
    // only the top-level card of the second tree moved, and only sideways
    const moved = result.nodes.filter((n, i) => n !== before[i]);
    expect(moved.map((n) => n.id)).toEqual(['bh']);
    expect(moved[0].position.y).toBe(50);
    expect(moved[0].position.x).toBeGreaterThan(100);
  });

  test('three trees on top of each other all end up apart', () => {
    const all = ['a', 'b', 'c'].map((p, i) => tree(p, i * 10, i * 10));
    const nodes = all.flatMap(([n]) => n);
    const edges = all.flatMap(([, e]) => e);
    const result = tidyTrees(nodes, edges);
    expect(result.moved).toBe(2);
    expect(anyOverlap(result.nodes, edges)).toBe(false);
  });

  test('a note on a tree is left alone, and notes are never checked against each other', () => {
    const [n1, e1] = tree('a', 0, 0);
    const notes = [
      card('n1', 20, 20, { type: NodeType.Note }),
      card('n2', 30, 30, { type: NodeType.Note }),
    ];
    const result = tidyTrees([...n1, ...notes], e1);
    expect(result.moved).toBe(0);
    expect(result.nodes).toEqual([...n1, ...notes]);
  });

  test('when a tree moves, the notes lying on it go with it, once', () => {
    const [n1, e1] = tree('a', 0, 0);
    const [n2, e2] = tree('b', 100, 50);
    const onB = card('n1', 120, 60, { type: NodeType.Note });
    const away = card('n2', 5000, 5000, { type: NodeType.Note });
    // lies on both trees: goes with the first one that moves, not twice
    const onBoth = card('n3', 110, 60, { type: NodeType.Note });
    const result = tidyTrees([...n1, ...n2, onB, away, onBoth], [...e1, ...e2]);
    const at = (id: string): Node =>
      result.nodes.find((n) => n.id === id) as Node;
    const dx = at('bh').position.x - 100;
    expect(dx).toBeGreaterThan(0);
    expect(at('n1').position).toEqual({ x: 120 + dx, y: 60 });
    expect(at('n3').position).toEqual({ x: 110 + dx, y: 60 });
    expect(at('n2').position).toEqual({ x: 5000, y: 5000 });
  });

  test('a tree sliding right goes around a loose note, not over it', () => {
    const [n1, e1] = tree('a', 0, 0);
    const [n2, e2] = tree('b', 100, 50);
    const base = tidyTrees([...n1, ...n2], [...e1, ...e2]);
    const clearX = (base.nodes.find((n) => n.id === 'bh') as Node).position.x;
    // a note just past where tree b would have landed, on no tree
    const loose = card('n1', clearX + 100, 50, { type: NodeType.Note });
    const result = tidyTrees([...n1, ...n2, loose], [...e1, ...e2]);
    const bh = result.nodes.find((n) => n.id === 'bh') as Node;
    expect(bh.position.x).toBeGreaterThan(clearX + 100 + 256);
    expect(result.nodes.find((n) => n.id === 'n1')?.position).toEqual(
      loose.position
    );
    // and a note that is on a tree does not stop the others
    const onA = card('n2', 20, 20, { type: NodeType.Note });
    const withOnA = tidyTrees([...n1, ...n2, onA], [...e1, ...e2]);
    expect(withOnA.nodes.find((n) => n.id === 'bh')?.position.x).toBe(clearX);
  });

  test('hidden cards do not count, and a tree whose cards all hide is left alone', () => {
    const [n1, e1] = tree('a', 0, 0);
    const hiddenNote = card('n1', 20, 20, {
      type: NodeType.Note,
      hidden: true,
    });
    expect(tidyTrees([...n1, hiddenNote], e1).moved).toBe(0);
  });
});

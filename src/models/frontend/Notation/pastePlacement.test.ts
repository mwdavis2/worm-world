import { type Node } from 'reactflow';
import { describe, expect, test } from 'vitest';
import { NodeType } from 'models/enums';
import { nodeRects, pasteShift, type Rect } from './pastePlacement';

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

describe('nodeRects', () => {
  test('a child is placed relative to its parent, and hidden nodes are left out', () => {
    const parent = card('p', 100, 200);
    const child = card('c', 10, 20, { parentNode: 'p' });
    const hidden = card('h', 0, 0, { hidden: true });
    const rects = nodeRects([parent, child, hidden]);
    expect(rects).toHaveLength(2);
    expect(rects[1]).toMatchObject({ x: 110, y: 220 });
  });

  test('a parent outside the list is found through the lookup', () => {
    const parent = card('p', 100, 200);
    const child = card('c', 10, 20, { parentNode: 'p' });
    expect(nodeRects([child], [parent, child])[0]).toMatchObject({
      x: 110,
      y: 220,
    });
  });
});

describe('pasteShift', () => {
  const box = (x: number, y: number): Rect => ({
    x,
    y,
    width: 256,
    height: 144,
  });

  test('a paste on an empty canvas or clear of every card does not move', () => {
    expect(pasteShift([box(0, 0)], [])).toEqual({ x: 0, y: 0 });
    expect(pasteShift([box(0, 0)], [box(1000, 0)])).toEqual({ x: 0, y: 0 });
  });

  test('a paste on a card goes to the right of everything already there', () => {
    const existing = [box(0, 0), box(500, 300)];
    const shift = pasteShift([box(100, 50)], existing, 36);
    // existing right edge is 500 + 256 = 756; pasted left is 100
    expect(shift).toEqual({ x: 756 + 36 - 100, y: 0 });
    expect(pasteShift([box(100 + shift.x, 50)], existing, 36)).toEqual({
      x: 0,
      y: 0,
    });
  });

  test('a paste that only touches within the gap still moves', () => {
    expect(pasteShift([box(0, 150)], [box(0, 0)], 36).x).not.toBe(0);
  });
});

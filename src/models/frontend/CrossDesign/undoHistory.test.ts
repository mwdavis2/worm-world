import { describe, expect, test } from 'vitest';
import { NodeType, Sex } from 'models/enums';
import * as alleles from 'models/frontend/Allele/Allele.mock';
import {
  MAX_STEPS,
  restoreSnapshot,
  snapshotOf,
  UndoHistory,
} from 'models/frontend/CrossDesign/undoHistory';
import { Strain } from 'models/frontend/Strain/Strain';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { type Edge, type Node } from 'reactflow';

describe('UndoHistory', () => {
  test('steps back and forward through the recorded states', () => {
    const history = new UndoHistory();
    history.push('a');
    history.push('b');
    history.push('c');
    expect(history.current).toBe('c');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    expect(history.undo()).toBe('b');
    expect(history.undo()).toBe('a');
    expect(history.undo()).toBeUndefined();
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe('b');
    expect(history.redo()).toBe('c');
    expect(history.redo()).toBeUndefined();
  });

  test('a repeat of the current state is not a step', () => {
    const history = new UndoHistory();
    history.push('a');
    history.push('a');
    expect(history.canUndo).toBe(false);
  });

  test('a new change after an undo drops the redo tail', () => {
    const history = new UndoHistory();
    ['a', 'b', 'c'].forEach((s) => {
      history.push(s);
    });
    history.undo();
    history.push('d');
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe('b');
    expect(history.undo()).toBe('a');
    expect(history.redo()).toBe('b');
    expect(history.redo()).toBe('d');
  });

  test('rebase replaces the current state without adding a step', () => {
    const history = new UndoHistory();
    history.push('a');
    history.push('b');
    history.rebase('b2');
    expect(history.current).toBe('b2');
    expect(history.undo()).toBe('a');
    expect(history.redo()).toBe('b2');

    const empty = new UndoHistory();
    empty.rebase('x');
    expect(empty.current).toBe('x');
  });

  test('keeps at most MAX_STEPS states, dropping the oldest', () => {
    const history = new UndoHistory();
    for (let i = 0; i < MAX_STEPS + 20; i++) history.push(`s${i}`);
    let steps = 0;
    while (history.undo() !== undefined) steps++;
    expect(steps).toBe(MAX_STEPS - 1);
    expect(history.current).toBe('s20');
  });
});

const founder = (id: string, strain: Strain): Node<Strain> => ({
  id,
  type: NodeType.Strain,
  position: { x: 0, y: 0 },
  data: strain,
});

describe('snapshotOf', () => {
  const nodes = [
    founder('a', new Strain({ allelePairs: [alleles.ed3.toTopHet()] })),
  ];

  test('ignores selection, dragging and measured size', () => {
    const base = snapshotOf(nodes, []);
    const viewOnly = snapshotOf(
      [
        {
          ...nodes[0],
          selected: true,
          dragging: true,
          width: 100,
          height: 50,
          positionAbsolute: { x: 0, y: 0 },
        },
      ],
      []
    );
    expect(viewOnly).toBe(base);
  });

  test('changes when something real changes', () => {
    const base = snapshotOf(nodes, []);
    expect(
      snapshotOf([{ ...nodes[0], position: { x: 5, y: 0 } }], [])
    ).not.toBe(base);
    expect(snapshotOf([{ ...nodes[0], hidden: true }], [])).not.toBe(base);
    expect(snapshotOf([], [])).not.toBe(base);
  });

  test('is not affected by later in-place edits of the live nodes', () => {
    const live = [
      founder('a', new Strain({ allelePairs: [alleles.ed3.toTopHet()] })),
    ];
    const snapshot = snapshotOf(live, []);
    live[0].position.x = 999;
    live[0].hidden = true;
    expect(restoreSnapshot(snapshot).nodes[0].position.x).toBe(0);
    expect(restoreSnapshot(snapshot).nodes[0].hidden).toBeUndefined();
  });
});

describe('restoreSnapshot', () => {
  test('brings back strains, filters and edges as working objects', () => {
    const herm = new Strain({ allelePairs: [alleles.ed3.toTopHet()] });
    const male = herm.toggleSex();
    const filter = new StrainFilter();
    filter.hiddenNodes.add('c1');
    filter.sex.add('Male');
    const nodes: Node[] = [
      founder('herm', herm),
      { ...founder('male', male) },
      {
        id: 'mid',
        type: NodeType.Self,
        position: { x: 0, y: 0 },
        data: filter,
      },
    ];
    const edges: Edge[] = [{ id: 'e', source: 'herm', target: 'mid' }];

    const restored = restoreSnapshot(snapshotOf(nodes, edges));
    expect(restored.edges).toEqual(edges);
    const [r1, r2, r3] = restored.nodes;
    expect(r1.data).toBeInstanceOf(Strain);
    expect(r1.data.chromPairMap).toBeInstanceOf(Map);
    expect(r1.data.toString()).toBe(herm.toString());
    expect(r2.data.sex).toBe(Sex.Male);
    expect(r2.data.toString()).toBe(male.toString());
    // the X pair a toggled male remembers survives, so toggling back works
    expect(r2.data.toggleSex().toString()).toBe(herm.toString());
    expect(r3.data).toBeInstanceOf(StrainFilter);
    expect(r3.data.hiddenNodes.has('c1')).toBe(true);
    expect(r3.data.sex.has('Male')).toBe(true);
  });
});

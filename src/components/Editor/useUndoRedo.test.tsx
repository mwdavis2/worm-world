import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { type Edge, type Node } from 'reactflow';
import { NodeType } from 'models/enums';
import * as alleles from 'models/frontend/Allele/Allele.mock';
import { Strain } from 'models/frontend/Strain/Strain';
import {
  OPEN_QUIET_MS,
  SETTLE_MS,
  useUndoRedo,
  type UndoRedo,
} from 'components/Editor/useUndoRedo';

const card = (id: string): Node<Strain> => ({
  id,
  type: NodeType.Strain,
  position: { x: 0, y: 0 },
  data: new Strain({ allelePairs: [alleles.ed3.toTopHet()] }),
});

interface Harness extends UndoRedo {
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  edges: Edge[];
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}

const setup = (editable = true): RenderHookResult<Harness, unknown> =>
  renderHook<Harness, unknown>(() => {
    const [nodes, setNodes] = useState<Node[]>([card('a')]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const undoRedo = useUndoRedo({
      nodes,
      edges,
      editable,
      setNodes,
      setEdges,
    });
    return { nodes, setNodes, edges, setEdges, ...undoRedo };
  });

const settle = (ms = SETTLE_MS + 50): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('useUndoRedo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('undoes and redoes adding a card', () => {
    const { result } = setup();
    settle(OPEN_QUIET_MS + 100); // the design has opened
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.setNodes((nodes) => [...nodes, card('b')]);
    });
    settle();
    expect(result.current.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.nodes.map((n) => n.id)).toEqual(['a']);
    expect(result.current.canRedo).toBe(true);
    // the undo itself is not a new step
    settle(OPEN_QUIET_MS);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.current.canRedo).toBe(false);
  });

  test('a change made just before undoing is recorded first, so it can be undone', () => {
    const { result } = setup();
    settle(OPEN_QUIET_MS + 100);
    act(() => {
      result.current.setNodes((nodes) => [...nodes, card('b')]);
    });
    // no waiting for the change to settle
    act(() => {
      result.current.undo();
    });
    expect(result.current.nodes.map((n) => n.id)).toEqual(['a']);
  });

  test('a burst of changes is one step', () => {
    const { result } = setup();
    settle(OPEN_QUIET_MS + 100);
    for (const id of ['b', 'c', 'd']) {
      act(() => {
        result.current.setNodes((nodes) => [...nodes, card(id)]);
      });
      settle(50);
    }
    settle();
    act(() => {
      result.current.undo();
    });
    expect(result.current.nodes.map((n) => n.id)).toEqual(['a']);
    expect(result.current.canUndo).toBe(false);
  });

  test('a moved card is a step; selecting it is not', () => {
    const { result } = setup();
    settle(OPEN_QUIET_MS + 100);
    act(() => {
      result.current.setNodes((nodes) =>
        nodes.map((n) => ({ ...n, selected: true, width: 90, height: 40 }))
      );
    });
    settle();
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.setNodes((nodes) =>
        nodes.map((n) => ({ ...n, position: { x: 40, y: 10 } }))
      );
    });
    settle();
    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.undo();
    });
    expect(result.current.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  test('changes while the design is opening are not steps', () => {
    const { result } = setup();
    // e.g. the allele data reloading right after the design opens
    act(() => {
      result.current.setNodes((nodes) =>
        nodes.map((n) => ({ ...n, position: { x: 7, y: 7 } }))
      );
    });
    settle();
    expect(result.current.canUndo).toBe(false);
  });

  test('a design that cannot be edited has no undo', () => {
    const { result } = setup(false);
    settle(OPEN_QUIET_MS + 100);
    act(() => {
      result.current.setNodes((nodes) => [...nodes, card('b')]);
    });
    settle();
    expect(result.current.canUndo).toBe(false);
    let did = true;
    act(() => {
      did = result.current.undo();
    });
    expect(did).toBe(false);
    expect(result.current.nodes).toHaveLength(2);
  });
});

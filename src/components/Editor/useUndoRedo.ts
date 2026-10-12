import { refreshCardInfoOfChildren } from 'models/frontend/CrossDesign/refreshCardInfo';
import {
  restoreSnapshot,
  snapshotOf,
  UndoHistory,
} from 'models/frontend/CrossDesign/undoHistory';
import { useEffect, useRef, useState } from 'react';
import { type Edge, type Node } from 'reactflow';

/** A burst of related changes (a cross, a drag) is one step once it has been quiet this long */
export const SETTLE_MS = 400;
/** Changes in this long after the design opens, or after an undo or redo, are the app's own (reloading data), not the user's, so they do not become steps */
export const OPEN_QUIET_MS = 1500;
export const RESTORE_QUIET_MS = 800;

export interface UndoRedo {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Undo and redo for the design held in `nodes` and `edges`. Whenever they
 * settle in a new state a snapshot is recorded (see `undoHistory.ts`); undo and
 * redo put a snapshot back with `setNodes` / `setEdges`, so the editor's own
 * autosave then saves the restored design.
 */
export const useUndoRedo = (params: {
  nodes: Node[];
  edges: Edge[];
  editable: boolean;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
}): UndoRedo => {
  const history = useRef(new UndoHistory());
  const latest = useRef({ nodes: params.nodes, edges: params.edges });
  latest.current = { nodes: params.nodes, edges: params.edges };
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const quietUntil = useRef(Date.now() + OPEN_QUIET_MS);
  const [, setVersion] = useState(0);

  const record = (): void => {
    const snapshot = snapshotOf(latest.current.nodes, latest.current.edges);
    if (Date.now() < quietUntil.current) history.current.rebase(snapshot);
    else history.current.push(snapshot);
    setVersion((version) => version + 1);
  };

  // The state the design opens in is the first entry
  useEffect(() => {
    if (!params.editable) return;
    history.current.push(
      snapshotOf(latest.current.nodes, latest.current.edges)
    );
    setVersion((version) => version + 1);
    return () => {
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!params.editable) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      record();
    }, SETTLE_MS);
  }, [params.nodes, params.edges]);

  /** Records a change that is still waiting to settle, so it can be undone */
  const flushPending = (): void => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    record();
  };

  const show = (snapshot: string): void => {
    const restored = restoreSnapshot(snapshot);
    refreshCardInfoOfChildren(restored.nodes, restored.edges);
    quietUntil.current = Date.now() + RESTORE_QUIET_MS;
    clearTimeout(timer.current);
    timer.current = undefined;
    params.setNodes(restored.nodes);
    params.setEdges(restored.edges);
    setVersion((version) => version + 1);
  };

  const undo = (): boolean => {
    if (!params.editable) return false;
    flushPending();
    const snapshot = history.current.undo();
    if (snapshot === undefined) return false;
    show(snapshot);
    return true;
  };

  const redo = (): boolean => {
    if (!params.editable) return false;
    flushPending();
    const snapshot = history.current.redo();
    if (snapshot === undefined) return false;
    show(snapshot);
    return true;
  };

  return {
    undo,
    redo,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
  };
};

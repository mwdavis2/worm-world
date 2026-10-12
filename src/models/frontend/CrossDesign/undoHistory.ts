import CrossDesign from 'models/frontend/CrossDesign/CrossDesign';
import { fixNodeDeserialization } from 'models/frontend/CrossDesign/fixNodeDeserialization';
import { type Edge, type Node } from 'reactflow';

/**
 * Undo and redo for the cross workspace keep whole-design snapshots rather
 * than patches. A design is already written out as JSON every second by the
 * autosave and read back by `CrossDesign.fromJSON` + `fixNodeDeserialization`
 * when it opens, so a snapshot is a deep copy that later in-place edits of
 * the live nodes cannot touch.
 */

/** Fields that describe what is on screen, not the design; left out so selecting or measuring a card is not a step */
const VIEW_ONLY_FIELDS = [
  'selected',
  'dragging',
  'width',
  'height',
  'positionAbsolute',
] as const;

const withoutViewFields = <T extends Node | Edge>(item: T): T => {
  const copy: T = { ...item };
  VIEW_ONLY_FIELDS.forEach((field) => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (copy as Partial<T>)[field as keyof T];
  });
  return copy;
};

/** The design's nodes and edges as a JSON string; equal strings mean nothing that matters changed */
export const snapshotOf = (nodes: Node[], edges: Edge[]): string =>
  new CrossDesign({
    // a fixed id, or every snapshot would differ from the last
    id: 'undo-history',
    name: '',
    nodes: nodes.map(withoutViewFields),
    edges: edges.map(withoutViewFields),
    lastSaved: new Date(0),
    editable: true,
  }).toJSON();

/** A snapshot read back into live nodes and edges, the way a saved design is opened */
export const restoreSnapshot = (
  snapshot: string
): { nodes: Node[]; edges: Edge[] } => {
  const design = CrossDesign.fromJSON(snapshot);
  fixNodeDeserialization(design);
  return { nodes: design.nodes, edges: design.edges };
};

/** Steps kept; older ones are dropped */
export const MAX_STEPS = 50;
/** Total snapshot text kept (characters) before the oldest steps are dropped */
export const MAX_CHARS = 20_000_000;

/**
 * A linear history of snapshots with a position in it. Index 0 is the oldest
 * kept state; `current` is the state on screen.
 */
export class UndoHistory {
  private entries: string[] = [];
  private index = -1;

  /** The state on screen, if any has been recorded */
  public get current(): string | undefined {
    return this.entries[this.index];
  }

  public get canUndo(): boolean {
    return this.index > 0;
  }

  public get canRedo(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  /** Records a new state after the current one; a repeat of the current state is ignored, and any redo tail is dropped */
  public push(snapshot: string): void {
    if (snapshot === this.current) return;
    this.entries.length = this.index + 1;
    this.entries.push(snapshot);
    this.index = this.entries.length - 1;
    this.trim();
  }

  /** Replaces the current state without adding a step (for changes that are not the user's own, such as reloading data) */
  public rebase(snapshot: string): void {
    if (this.index < 0) this.push(snapshot);
    else this.entries[this.index] = snapshot;
  }

  /** Steps back and returns the state to show, or undefined if there is nothing to undo */
  public undo(): string | undefined {
    if (!this.canUndo) return undefined;
    this.index--;
    return this.entries[this.index];
  }

  /** Steps forward and returns the state to show, or undefined if there is nothing to redo */
  public redo(): string | undefined {
    if (!this.canRedo) return undefined;
    this.index++;
    return this.entries[this.index];
  }

  private trim(): void {
    let chars = this.entries.reduce((sum, entry) => sum + entry.length, 0);
    while (
      this.entries.length > 1 &&
      (this.entries.length > MAX_STEPS || chars > MAX_CHARS)
    ) {
      chars -= this.entries[0].length;
      this.entries.shift();
      this.index--;
    }
  }
}

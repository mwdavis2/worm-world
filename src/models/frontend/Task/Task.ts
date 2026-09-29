import { type Action } from 'models/db/task/db_Action';
import { type db_Task } from 'models/db/task/db_Task';
import { Type, plainToInstance, instanceToPlain } from 'class-transformer';
import { Strain } from 'models/frontend/Strain/Strain';

export interface ITask {
  id: string;
  dueDate?: Date;
  action: Action;

  hermStrain: Strain;
  maleStrain?: Strain;
  result?: Strain;

  notes?: string;
  completed: boolean;
  crossDesignId: string;
  childTaskId?: string;
  updatedAt?: Date;
  completedAt?: Date;
}

export class Task {
  id: string;
  @Type(() => Date)
  dueDate: Date;

  action: Action;

  @Type(() => Strain)
  hermStrain: Strain;

  @Type(() => Strain)
  maleStrain?: Strain;

  @Type(() => Strain)
  resultStrain?: Strain;

  notes?: string;
  completed: boolean;
  crossDesignId: string;
  childTaskId?: string;
  @Type(() => Date)
  updatedAt?: Date;

  @Type(() => Date)
  completedAt?: Date;

  constructor(task?: db_Task) {
    if (task === null || task === undefined) {
      this.id = '';
      this.action = 'SelfCross';
      this.hermStrain = new Strain();
      this.completed = false;
      this.crossDesignId = '';
      this.dueDate = new Date();
    } else {
      this.id = task.id;
      this.dueDate =
        task.dueDate === null ? new Date() : new Date(task.dueDate);
      this.action = task.action;
      this.hermStrain = Strain.fromJSON(task.hermStrain);
      this.maleStrain =
        task.maleStrain !== null ? Strain.fromJSON(task.maleStrain) : undefined;
      this.resultStrain =
        task.resultStrain !== null
          ? Strain.fromJSON(task.resultStrain)
          : undefined;
      this.notes = task.notes ?? undefined;
      this.completed = task.completed;
      this.crossDesignId = task.crossDesignId;
      this.childTaskId = task.childTaskId ?? undefined;
      this.updatedAt =
        task.updatedAt === null ? undefined : new Date(task.updatedAt);
      this.completedAt =
        task.completedAt === null ? undefined : new Date(task.completedAt);
    }
  }

  /**
   * Stamps updatedAt/completedAt based on the current completed value before
   * serializing - the single choke point both insertTask and updateTask flows
   * pass through, so callers don't need to track completion transitions
   * themselves (see backlog #8's two-way task sync, which needs updatedAt for
   * conflict detection and completedAt for a completion record).
   */
  public generateRecord(): db_Task {
    const now = new Date();
    if (this.completed && this.completedAt === undefined) {
      this.completedAt = now;
    } else if (!this.completed) {
      this.completedAt = undefined;
    }
    this.updatedAt = now;

    return {
      id: this.id,
      // toISOString() (RFC3339), not toString() - the Google Tasks sync
      // engine (google_tasks.rs's to_google_due_date) parses this on the
      // Rust side, and toString()'s verbose locale-dependent format
      // ("Thu Oct 01 2026 08:30:20 GMT-0600 (Mountain Daylight Time)")
      // isn't reliably parseable there.
      dueDate: this.dueDate?.toISOString() ?? null,
      action: this.action,
      hermStrain: this.hermStrain.toJSON(),
      maleStrain: this.maleStrain?.toJSON() ?? null,
      resultStrain: this.resultStrain?.toJSON() ?? null,
      notes: this.notes ?? null,
      completed: this.completed,
      crossDesignId: this.crossDesignId,
      childTaskId: this.childTaskId ?? null,
      updatedAt: this.updatedAt.toString(),
      completedAt: this.completedAt?.toString() ?? null,
    };
  }

  public equals(other: Task): boolean {
    return (
      this.action === other.action &&
      this.hermStrain.equals(other.hermStrain) &&
      (this.maleStrain === other.maleStrain ||
        (this.maleStrain !== undefined &&
          other.maleStrain !== undefined &&
          this.maleStrain.equals(other.maleStrain)))
    );
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  static fromJSON(json: string): Task {
    return plainToInstance(Task, JSON.parse(json) as Record<string, unknown>);
  }

  public getDescendents(tasks: Task[]): Task[] {
    const descendents: Task[] = [this];
    while (descendents.at(-1)?.childTaskId !== undefined) {
      const next = tasks.find(
        (task) => task.id === descendents.at(-1)?.childTaskId
      );
      if (next === undefined) {
        console.error('Unable to find all descendents');
        break;
      } else descendents.push(next);
    }
    return descendents;
  }

  /** @returns the task that consumes this task's result strain, if any. */
  public getChildTask(tasks: Task[]): Task | undefined {
    return tasks.find((task) => task.id === this.childTaskId);
  }
}

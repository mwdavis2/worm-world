import { expect, test, describe } from 'vitest';
import { buildScheduleText } from 'components/ToDoView/PrintableSchedule';
import { Task } from 'models/frontend/Task/Task';
import { Strain } from 'models/frontend/Strain/Strain';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const makeTask = (overrides: Partial<Task> = {}): Task => {
  const task = new Task();
  task.id = overrides.id ?? 'task-1';
  task.crossDesignId = overrides.crossDesignId ?? 'design-1';
  task.dueDate = overrides.dueDate ?? new Date();
  task.completed = overrides.completed ?? false;
  task.completedAt = overrides.completedAt;
  task.notes = overrides.notes;
  return task;
};

describe('buildScheduleText()', () => {
  test('reports no tasks when the list is empty', () => {
    const text = buildScheduleText([], new Map());
    expect(text).toContain('No tasks to show.');
  });

  test('groups an overdue task under an Overdue section', () => {
    const task = makeTask({ dueDate: new Date(Date.now() - 2 * MS_PER_DAY) });
    const text = buildScheduleText([task], new Map());
    expect(text).toContain('Overdue (1)');
    expect(text).toContain('days overdue');
  });

  test('groups an upcoming task under its due date, not Overdue', () => {
    const task = makeTask({ dueDate: new Date(Date.now() + MS_PER_DAY) });
    const text = buildScheduleText([task], new Map());
    expect(text).not.toContain('Overdue');
    expect(text).toContain(task.dueDate.toDateString());
  });

  test('includes the cross design name when known', () => {
    const task = makeTask({ crossDesignId: 'design-1' });
    const text = buildScheduleText(
      [task],
      new Map([['design-1', 'My Cross Design']])
    );
    expect(text).toContain('(My Cross Design)');
  });

  test('shows a completion date for completed tasks', () => {
    const completedAt = new Date(Date.now() - 2 * MS_PER_DAY);
    const task = makeTask({ completed: true, completedAt });
    const text = buildScheduleText([task], new Map());
    expect(text).toContain(`completed ${completedAt.toLocaleDateString()}`);
  });

  test('includes notes on their own indented line', () => {
    const task = makeTask({ notes: 'Watched the plates twice.' });
    const text = buildScheduleText([task], new Map());
    expect(text).toContain('Notes: Watched the plates twice.');
  });

  test('labels the hermaphrodite/male sides of a Cross task', () => {
    const task = makeTask();
    task.action = 'Cross';
    task.maleStrain = new Strain();
    const text = buildScheduleText([task], new Map());
    expect(text).toContain('(hermaphrodite)');
    expect(text).toContain('(male)');
  });
});

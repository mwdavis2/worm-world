import { expect, test, describe } from 'vitest';
import {
  isOverdue,
  getDaysUntilChildTaskDue,
} from 'components/TaskList/TaskList';
import { Task } from 'models/frontend/Task/Task';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('isOverdue()', () => {
  test('true for an incomplete task due yesterday', () => {
    const task = new Task();
    task.dueDate = new Date(Date.now() - MS_PER_DAY);
    task.completed = false;
    expect(isOverdue(task)).toBe(true);
  });

  test('false for an incomplete task due today', () => {
    const task = new Task();
    task.dueDate = new Date();
    task.completed = false;
    expect(isOverdue(task)).toBe(false);
  });

  test('false for an incomplete task due in the future', () => {
    const task = new Task();
    task.dueDate = new Date(Date.now() + MS_PER_DAY);
    task.completed = false;
    expect(isOverdue(task)).toBe(false);
  });

  test('false for a completed task past its due date', () => {
    const task = new Task();
    task.dueDate = new Date(Date.now() - MS_PER_DAY);
    task.completed = true;
    expect(isOverdue(task)).toBe(false);
  });
});

describe('getDaysUntilChildTaskDue()', () => {
  const makeTask = (id: string, completed: boolean): Task => {
    const task = new Task();
    task.id = id;
    task.completed = completed;
    return task;
  };

  test('undefined when the task itself is not completed', () => {
    const task = makeTask('1', false);
    task.childTaskId = '2';
    const child = makeTask('2', false);
    child.dueDate = new Date(Date.now() + MS_PER_DAY);
    expect(getDaysUntilChildTaskDue(task, [task, child])).toBeUndefined();
  });

  test('undefined when the task has no child', () => {
    const task = makeTask('1', true);
    expect(getDaysUntilChildTaskDue(task, [task])).toBeUndefined();
  });

  test('undefined when the child task is already completed', () => {
    const task = makeTask('1', true);
    task.childTaskId = '2';
    const child = makeTask('2', true);
    child.dueDate = new Date(Date.now() + MS_PER_DAY);
    expect(getDaysUntilChildTaskDue(task, [task, child])).toBeUndefined();
  });

  test('positive days when the child task is due in the future', () => {
    const task = makeTask('1', true);
    task.childTaskId = '2';
    const child = makeTask('2', false);
    child.dueDate = new Date(Date.now() + 3 * MS_PER_DAY);
    expect(getDaysUntilChildTaskDue(task, [task, child])).toBe(3);
  });

  test('negative days when the child task is already overdue', () => {
    const task = makeTask('1', true);
    task.childTaskId = '2';
    const child = makeTask('2', false);
    child.dueDate = new Date(Date.now() - 2 * MS_PER_DAY);
    expect(getDaysUntilChildTaskDue(task, [task, child])).toBe(-2);
  });

  test('zero when the child task is due today', () => {
    const task = makeTask('1', true);
    task.childTaskId = '2';
    const child = makeTask('2', false);
    child.dueDate = new Date();
    expect(getDaysUntilChildTaskDue(task, [task, child])).toBe(0);
  });
});

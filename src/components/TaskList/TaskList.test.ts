import { expect, test, describe } from 'vitest';
import { isOverdue } from 'components/TaskList/TaskList';
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

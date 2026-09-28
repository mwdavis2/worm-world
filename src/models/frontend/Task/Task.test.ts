import { expect, test, describe } from 'vitest';
import { Task } from 'models/frontend/Task/Task';
import { TaskCondition } from 'models/frontend/Task/TaskCondition';
import { TaskDependency } from 'models/frontend/Task/TaskDependency';
import * as strains from 'models/frontend/Strain/Strain.mock';

describe('Task', () => {
  test('(De)serializes', () => {
    const task = new Task({
      id: '0',
      dueDate: null,
      action: 'SelfCross',
      hermStrain: strains.wildManyPairs.toMale().toJSON(),
      maleStrain: null,
      resultStrain: null,
      notes: null,
      completed: false,
      crossDesignId: '3',
      childTaskId: null,
      updatedAt: null,
      completedAt: null,
    });
    const str = task.toJSON();
    const taskBack = Task.fromJSON(str);
    expect(taskBack).toEqual(task);
    expect(taskBack.toJSON).toBeDefined();
  });

  test('generateRecord() stamps completedAt when a task is newly checked off', () => {
    const task = new Task();
    task.completed = true;
    const record = task.generateRecord();
    expect(record.completedAt).not.toBeNull();
    expect(task.completedAt).toBeDefined();
  });

  test('generateRecord() clears completedAt when a task is unchecked', () => {
    const task = new Task();
    task.completed = true;
    task.generateRecord();
    expect(task.completedAt).toBeDefined();

    task.completed = false;
    const record = task.generateRecord();
    expect(record.completedAt).toBeNull();
    expect(task.completedAt).toBeUndefined();
  });

  test('generateRecord() preserves an already-set completedAt on unrelated updates', () => {
    const task = new Task();
    task.completed = true;
    task.generateRecord();
    const firstCompletedAt = task.completedAt;

    task.notes = 'a note';
    task.generateRecord();
    expect(task.completedAt).toEqual(firstCompletedAt);
  });

  test('generateRecord() always stamps updatedAt', () => {
    const task = new Task();
    const record = task.generateRecord();
    expect(record.updatedAt).not.toBeNull();
    expect(task.updatedAt).toBeDefined();
  });
});

describe('TaskDependency', () => {
  test('should be able to serialize and deserialize', () => {
    const taskDep = new TaskDependency({
      parentId: '0',
      childId: '1',
    });
    const str = taskDep.toJSON();
    const taskDepBack = TaskDependency.fromJSON(str);
    expect(taskDepBack).toEqual(taskDep);
  });
});

describe('TaskCondition', () => {
  test('should be able to serialize and deserialize', () => {
    const taskCond = new TaskCondition({
      parentId: '0',
      name: '1',
    });
    const str = taskCond.toJSON();
    const taskCondBack = TaskCondition.fromJSON(str);
    expect(taskCondBack).toEqual(taskCond);
  });
});

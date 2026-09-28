import { expect, test, describe } from 'vitest';
import { getTaskStatementText } from 'components/TaskItem/TaskItem';
import { Task } from 'models/frontend/Task/Task';
import * as strains from 'models/frontend/Strain/Strain.mock';

describe('getTaskStatementText()', () => {
  test('Cross', () => {
    const task = new Task();
    task.action = 'Cross';
    task.hermStrain = strains.TN64;
    task.maleStrain = strains.wildManyPairs;
    task.resultStrain = strains.TN64;
    expect(getTaskStatementText(task)).toBe(
      `Cross ${strains.TN64.genotype} with ${strains.wildManyPairs.genotype} to yield ${strains.TN64.genotype}`
    );
  });

  test('SelfCross', () => {
    const task = new Task();
    task.action = 'SelfCross';
    task.hermStrain = strains.TN64;
    task.resultStrain = strains.TN64;
    expect(getTaskStatementText(task)).toBe(
      `Self-cross ${strains.TN64.genotype} to yield ${strains.TN64.genotype}`
    );
  });

  test('Freeze', () => {
    const task = new Task();
    task.action = 'Freeze';
    task.hermStrain = strains.TN64;
    expect(getTaskStatementText(task)).toBe(`Freeze ${strains.TN64.genotype}`);
  });

  test('Pcr', () => {
    const task = new Task();
    task.action = 'Pcr';
    task.hermStrain = strains.TN64;
    expect(getTaskStatementText(task)).toBe(
      `Do PCR test on ${strains.TN64.genotype}`
    );
  });
});

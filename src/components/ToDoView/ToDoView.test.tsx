import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';
import * as alleles from 'models/frontend/Allele/Allele.mock';
import { Strain } from 'models/frontend/Strain/Strain';
import { ToDoView } from './ToDoView';

const task = (): Record<string, unknown> => {
  const strain = new Strain({ allelePairs: [alleles.e204.toTopHet()] });
  return {
    id: 't1',
    dueDate: null,
    action: 'SelfCross',
    hermStrain: strain.toJSON(),
    maleStrain: null,
    resultStrain: strain.toJSON(),
    notes: null,
    completed: false,
    crossDesignId: 'd1',
    childTaskId: null,
    updatedAt: null,
    completedAt: null,
  };
};

describe('ToDoView allele labels button', () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
  });

  test('cycling the label mode changes the labels on the task cards', async () => {
    mockIPC((cmd) => (cmd === 'get_tasks' ? [task()] : []));
    const { container } = render(
      <BrowserRouter>
        <ToDoView />
      </BrowserRouter>
    );
    // The default mode writes gene(allele)
    await waitFor(() => {
      expect(screen.getAllByText('unc-33(e204)').length).toBeGreaterThan(0);
    });

    // Cycle until the label is the bare allele name ("Name" is the first mode)
    const button = container.querySelector(
      '[data-tip^="Allele labels"] button'
    ) as HTMLButtonElement;
    const user = userEvent.setup();
    for (let i = 0; i < 5; i++) {
      await user.click(button);
      if (screen.queryAllByText('e204').length > 0) break;
    }
    expect(screen.getAllByText('e204').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('unc-33(e204)')).toHaveLength(0);
  });
});

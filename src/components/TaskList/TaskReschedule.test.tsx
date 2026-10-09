import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { TaskRescheduleModal } from 'components/TaskList/TaskList';
import { Task } from 'models/frontend/Task/Task';

// a task due in October, the month the date field used to break in
const octoberTask = (): Task => {
  const task = new Task();
  task.id = 't1';
  task.dueDate = new Date(2026, 9, 10);
  return task;
};

const renderModal = (task = octoberTask()): HTMLInputElement => {
  render(
    <TaskRescheduleModal task={task} updateTask={vi.fn()} tasks={[task]} />
  );
  return screen.getByDisplayValue<HTMLInputElement>(/\d{4}-\d{2}-\d{2}/);
};

describe('the reschedule date field', () => {
  test('shows an October due date as a valid date, not 2026-010-10', () => {
    const input = renderModal();
    expect(input.value).toBe('2026-10-10');
  });

  test('a past date, in October, previews as the number of days earlier', () => {
    const input = renderModal();
    fireEvent.change(input, { target: { value: '2026-10-05' } });
    expect(input.value).toBe('2026-10-05');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('- 5 Days')).toBeVisible();
    expect(screen.queryByText(/NaN|Invalid/)).toBeNull();
  });

  test('a later date previews as days later', () => {
    const input = renderModal();
    fireEvent.change(input, { target: { value: '2026-10-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('+ 2 Days')).toBeVisible();
  });

  test('a cleared or part-typed date cannot be previewed, and says so', () => {
    const input = renderModal();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    expect(screen.getByText(/Choose a date/)).toBeVisible();
    // and a valid date brings it back
    fireEvent.change(input, { target: { value: '2026-10-08' } });
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
  });
});

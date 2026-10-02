import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DataTables from './data-tables';

const renderAt = (path: string): void => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <DataTables />
    </MemoryRouter>
  );
};

const activeTabs = (): string[] =>
  screen
    .getAllByRole('tab')
    .filter((tab) => tab.className.includes('tab-active'))
    .map((tab) => tab.textContent ?? '');

describe('Data Tables tab indicator', () => {
  test('highlights the tab for the page the URL is on', () => {
    renderAt('/data-tables/conditions');
    expect(activeTabs()).toEqual(['Conditions']);
  });

  test('highlights Genes for the bare data tables path', () => {
    renderAt('/data-tables');
    expect(activeTabs()).toEqual(['Genes']);
  });
});

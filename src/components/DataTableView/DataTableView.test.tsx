import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from 'react-toastify';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import DataTableView, { singularRows } from './DataTableView';
import { type Field } from 'components/ColumnFilter/ColumnFilter';
import { type ColumnDefinitionType } from 'components/Table/Table';

interface Row {
  name: string;
  extra?: string;
}
const cols: Array<ColumnDefinitionType<Row>> = [
  { key: 'name', header: 'Name' },
];
const fields: Array<Field<Row>> = [
  { name: 'name', title: 'Name', type: 'text' },
];

const renderTable = (
  overrides: Partial<
    React.ComponentProps<typeof DataTableView<Row, string>>
  > = {}
): {
  getFilteredRecords: ReturnType<typeof vi.fn>;
  getCountFilteredRecords: ReturnType<typeof vi.fn>;
} => {
  const getFilteredRecords = vi.fn(async () => [{ name: 'a' }, { name: 'b' }]);
  const getCountFilteredRecords = vi.fn(async () => 120);
  render(
    <DataTableView<Row, string>
      title='Things'
      dataName='thing'
      cols={cols}
      fields={fields}
      nameMapping={{ name: 'Name' }}
      getFilteredRecords={getFilteredRecords}
      getCountFilteredRecords={getCountFilteredRecords}
      insertRecord={vi.fn(async () => {})}
      insertRecordsFromFile={vi.fn(async () => ({
        table: 'things',
        read: 0,
        inserted: 0,
      }))}
      deleteRecord={vi.fn(async () => {})}
      {...overrides}
    />
  );
  return { getFilteredRecords, getCountFilteredRecords };
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(toast, 'success').mockReturnValue(0);
  vi.spyOn(toast, 'error').mockReturnValue(0);
  vi.spyOn(toast, 'warning').mockReturnValue(0);
});

describe('page size', () => {
  test('defaults to 50 rows, and changing it refetches from page 1 and is remembered', async () => {
    const { getFilteredRecords } = renderTable();
    await waitFor(() => {
      expect(getFilteredRecords).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0 })
      );
    });

    await userEvent.selectOptions(
      screen.getByLabelText('Rows per page'),
      '100'
    );

    await waitFor(() => {
      expect(getFilteredRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 })
      );
    });
    expect(
      JSON.parse(localStorage.getItem('worm-world:preferences') ?? '{}')
    ).toMatchObject({ dataTablePageSize: 100 });
  });

  test('starts from the saved page size', async () => {
    localStorage.setItem(
      'worm-world:preferences',
      JSON.stringify({ dataTablePageSize: 25 })
    );
    const { getFilteredRecords } = renderTable();
    await waitFor(() => {
      expect(getFilteredRecords).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25 })
      );
    });
  });
});

describe('clear table', () => {
  test('has no Clear button unless the page provides clearTable', async () => {
    renderTable();
    await screen.findByText('Import');
    expect(screen.queryByText('Clear table')).toBeNull();
  });

  test('confirms with the whole-table row count, and only clears on confirm', async () => {
    const clearTable = vi.fn(async () => {});
    const { getCountFilteredRecords } = renderTable({ clearTable });

    await userEvent.click(await screen.findByText('Clear table'));
    expect(
      await screen.findByText(/permanently deletes all 120 rows in Things/)
    ).toBeInTheDocument();
    // The count asked for is the unfiltered whole table.
    expect(getCountFilteredRecords).toHaveBeenCalledWith({
      filters: [],
      orderBy: [],
    });

    await userEvent.click(screen.getByText('Cancel'));
    expect(clearTable).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Clear table'));
    await userEvent.click(await screen.findByText('Delete all 120 rows'));
    await waitFor(() => {
      expect(clearTable).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).toHaveBeenCalledWith('Cleared Things');
  });

  test('explains which tables to clear first when a foreign key blocks it', async () => {
    const clearTable = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw { Delete: 'FOREIGN KEY constraint failed' };
    });
    renderTable({ clearTable, clearBlockedBy: 'Alleles' });

    await userEvent.click(await screen.findByText('Clear table'));
    await userEvent.click(await screen.findByText('Delete all 120 rows'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Can't clear Things: Alleles still reference it. Clear those first."
      );
    });
  });
});

describe('edit row', () => {
  test('has no Edit button unless the page provides updateRow', async () => {
    renderTable();
    await screen.findByText('a');
    expect(screen.queryByTitle('Edit')).toBeNull();
  });

  test('Edit opens the prefilled form and saves the row merged over the original', async () => {
    const updateRow = vi.fn(async () => {});
    const getFilteredRecords = vi.fn(async () => [
      { name: 'a', extra: 'kept' },
    ]);
    renderTable({
      updateRow,
      lockedFields: ['name'],
      getFilteredRecords,
    });

    await userEvent.click((await screen.findAllByTitle('Edit'))[0]);
    const heading = screen.getByRole('heading', { name: 'Edit Thing' });
    // The page also has the (hidden) Add form with the same field names.
    const dialog = within(heading.closest('.modal-box') as HTMLElement);
    expect(dialog.getByLabelText<HTMLInputElement>('Name').value).toBe('a');
    expect(dialog.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      expect(updateRow).toHaveBeenCalledWith({ name: 'a', extra: 'kept' });
    });
    expect(toast.success).toHaveBeenCalledWith('Saved changes');
  });
});

describe('delete row', () => {
  const confirmYes = (): void => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  };
  // The trash icon in the first data row's last cell.
  const deleteFirstRow = async (): Promise<void> => {
    const cell = (await screen.findByText('a')).closest('tr')?.lastElementChild;
    if (cell === null || cell === undefined) throw new Error('no delete cell');
    await userEvent.click(cell);
  };

  test('says so when the delete removed nothing', async () => {
    confirmYes();
    // The count never changes, as when the delete matched no row.
    const deleteRecord = vi.fn(async () => {});
    renderTable({ deleteRecord });
    await deleteFirstRow();
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        'Nothing was deleted: no row in the database matched this one'
      );
    });
    expect(deleteRecord).toHaveBeenCalledTimes(1);
  });

  test('stays quiet when a row was really deleted', async () => {
    confirmYes();
    let count = 120;
    const getCountFilteredRecords = vi.fn(async () => count);
    const deleteRecord = vi.fn(async () => {
      count -= 1;
    });
    renderTable({ deleteRecord, getCountFilteredRecords });
    await deleteFirstRow();
    await waitFor(() => {
      expect(deleteRecord).toHaveBeenCalledTimes(1);
    });
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe('unused rows', () => {
  const unused = {
    fieldName: 'Unused',
    hint: 'Unused: nothing uses this row',
    getKeys: vi.fn(async () => ['b']),
    rowKey: (row: Row) => row.name,
  };

  test('tints the unused row with the hint, and not the used one', async () => {
    renderTable({ unused });
    await screen.findByText('b');
    const unusedRow = screen.getByText('b').closest('tr');
    await waitFor(() => {
      expect(unusedRow?.getAttribute('data-unused')).toBe('true');
    });
    expect(
      screen.getByText('a').closest('tr')?.hasAttribute('data-unused')
    ).toBe(false);
    expect(
      within(unusedRow as HTMLElement).getAllByTitle(unused.hint)
    ).toHaveLength(1);
  });

  test('"Show only unused" adds the Unused filter and returns to page 1', async () => {
    const { getFilteredRecords } = renderTable({ unused });
    await screen.findByText('b');
    await userEvent.click(screen.getByLabelText('Show only unused'));
    await waitFor(() => {
      expect(getFilteredRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({
          offset: 0,
          filters: [[['Unused', 'True']]],
        })
      );
    });
  });

  test('has no checkbox on tables without unused flagging', async () => {
    renderTable();
    await screen.findByText('b');
    expect(screen.queryByLabelText('Show only unused')).toBeNull();
  });
});

describe('cascading delete', () => {
  const cascade = {
    table: 'Alleles' as const,
    key: (row: Row) => [row.name],
  };
  const clickDeleteOfFirstRow = async (): Promise<void> => {
    const cell = (await screen.findByText('a')).closest('tr')?.lastElementChild;
    if (cell === null || cell === undefined) throw new Error('no delete cell');
    await userEvent.click(cell);
  };
  const mockBackend = (
    impact: unknown[],
    deleted = 1
  ): Array<{ cmd: string; args: any }> => {
    const calls: Array<{ cmd: string; args: any }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'get_delete_impact') return impact;
      if (cmd === 'delete_with_dependents') return deleted;
      return null;
    });
    return calls;
  };
  afterEach(() => {
    clearMocks();
  });

  test('lists what else would be deleted, and deletes nothing on Cancel', async () => {
    const calls = mockBackend([
      { table: 'strain alleles', count: 2, names: [] },
      { table: 'variations', count: 1, names: ['ox11000'] },
    ]);
    const deleteRecord = vi.fn(async () => {});
    renderTable({ cascade, deleteRecord });
    await clickDeleteOfFirstRow();

    expect(await screen.findByText('Delete this row?')).toBeTruthy();
    expect(screen.getByText(/2 strain alleles/)).toBeTruthy();
    expect(
      screen.getByText(/1 variation \(ox11000; no other allele uses them\)/)
    ).toBeTruthy();
    expect(calls[0]).toEqual({
      cmd: 'get_delete_impact',
      args: { table: 'Alleles', key: ['a'] },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this row?')).toBeNull();
    expect(calls.some((c) => c.cmd === 'delete_with_dependents')).toBe(false);
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  test('Delete removes the row and its dependents in one call', async () => {
    const calls = mockBackend([
      { table: 'strain alleles', count: 1, names: [] },
    ]);
    const deleteRecord = vi.fn(async () => {});
    renderTable({ cascade, deleteRecord });
    await clickDeleteOfFirstRow();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete' })
    );
    await waitFor(() => {
      expect(calls).toContainEqual({
        cmd: 'delete_with_dependents',
        args: { table: 'Alleles', key: ['a'] },
      });
    });
    expect(deleteRecord).not.toHaveBeenCalled(); // the plain delete is not used
    expect(toast.warning).not.toHaveBeenCalled();
  });

  test('says when nothing else depends on the row', async () => {
    mockBackend([]);
    renderTable({ cascade });
    await clickDeleteOfFirstRow();
    expect(await screen.findByText('Nothing else depends on it.')).toBeTruthy();
  });

  test('warns when no row matched', async () => {
    mockBackend([], 0);
    renderTable({ cascade });
    await clickDeleteOfFirstRow();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete' })
    );
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        'Nothing was deleted: no row in the database matched this one'
      );
    });
  });

  test('says "1 strain allele" for one and "2 strain alleles" for two', async () => {
    mockBackend([
      { table: 'strain alleles', count: 1, names: [] },
      { table: 'expression relations', count: 2, names: [] },
      { table: 'allele expressions', count: 1, names: [] },
    ]);
    renderTable({ cascade });
    await clickDeleteOfFirstRow();
    expect(await screen.findByText(/1 strain allele$/)).toBeTruthy();
    expect(screen.getByText(/2 expression relations/)).toBeTruthy();
    expect(screen.getByText(/1 allele expression$/)).toBeTruthy();
  });
});

describe('singularRows', () => {
  test.each([
    ['strain alleles', 'strain allele'],
    ['alleles', 'allele'],
    ['variations', 'variation'],
    ['allele expressions', 'allele expression'],
    ['expression relations', 'expression relation'],
    ['categories', 'category'],
    ['phenotype', 'phenotype'],
  ])('%s -> %s', (plural, singular) => {
    expect(singularRows(plural)).toBe(singular);
  });
});

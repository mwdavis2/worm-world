import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { type db_Gene } from 'models/db/db_Gene';
import GeneSearchInput, { optionLabel } from './GeneSearchInput';

const gene = (
  sysName: string,
  descName: string | null,
  physLoc = 1000
): db_Gene => ({
  sysName,
  descName,
  chromosome: 'III',
  physLoc,
  geneticLoc: 1,
});

describe('optionLabel', () => {
  const results = [
    gene('let-?(s1799)', 'let-?'),
    gene('let-?(n886)', 'let-?'),
    gene('F56A8.7', 'unc-64'),
    gene('F56A8.7 (syx-1)', 'syx-1'),
    gene('Y74C9A.6', null),
  ];

  test('adds the key when several results share a descriptive name', () => {
    expect(optionLabel(results[0], results)).toBe('let-? [let-?(s1799)]');
    expect(optionLabel(results[1], results)).toBe('let-? [let-?(n886)]');
  });

  test('leaves a name that is unique among the results as it is', () => {
    expect(optionLabel(results[2], results)).toBe('unc-64');
    expect(optionLabel(results[3], results)).toBe('syx-1');
    expect(optionLabel(results[4], results)).toBe('Y74C9A.6');
  });
});

describe('GeneSearchInput', () => {
  afterEach(() => {
    clearMocks();
  });

  test('tells the placeholder genes apart in the dropdown', async () => {
    mockIPC((cmd) =>
      cmd === 'get_filtered_genes'
        ? [gene('let-?(s1799)', 'let-?'), gene('let-?(n886)', 'let-?')]
        : []
    );
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    fireEvent.change(screen.getByLabelText('gene'), {
      target: { value: 'let' },
    });
    await waitFor(() => {
      expect(screen.getByText('let-? [let-?(s1799)]')).toBeTruthy();
    });
    expect(screen.getByText('let-? [let-?(n886)]')).toBeTruthy();
  });

  test('searches names that start with the text first, each query capped', async () => {
    const calls: any[] = [];
    mockIPC((cmd, args) => {
      if (cmd !== 'get_filtered_genes') return [];
      const filter = (args as any).filter;
      calls.push(filter);
      return JSON.stringify(filter.filters[0][0][1]).includes('StartsWith')
        ? [gene('S1', 'unc-1')]
        : [gene('S2', 'lin-unc'), gene('S1', 'unc-1')];
    });
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    fireEvent.change(screen.getByLabelText('gene'), {
      target: { value: 'unc' },
    });
    await waitFor(() => {
      expect(screen.getByText('unc-1')).toBeTruthy();
    });
    expect(calls).toHaveLength(4);
    expect(calls.every((filter) => filter.limit === 50)).toBe(true);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['unc-1', 'lin-unc']); // starts-with first, no repeat
  });

  test('does not search for a single character and says so', async () => {
    const searched = vi.fn();
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes') searched();
      return [];
    });
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    fireEvent.change(screen.getByLabelText('gene'), {
      target: { value: 'u' },
    });
    expect(screen.getByText(/Type at least 2 characters/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searched).not.toHaveBeenCalled();
  });

  test('waits for typing to pause, searching once for the final text', async () => {
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === 'get_filtered_genes')
        calls.push(JSON.stringify((args as any).filter.filters));
      return [];
    });
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    const input = screen.getByLabelText('gene');
    for (const value of ['un', 'unc', 'unc-']) {
      fireEvent.change(input, { target: { value } });
    }
    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toHaveLength(4); // the four queries of the last text only
    expect(calls.every((call) => call.includes('unc-'))).toBe(true);
  });
});

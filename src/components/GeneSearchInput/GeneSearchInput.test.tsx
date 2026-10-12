import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { type db_Gene } from 'models/db/db_Gene';
import { markSearchIndexStale } from 'utils/searchIndexStale';
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
  beforeEach(() => {
    markSearchIndexStale(); // each test loads its own genes
  });
  afterEach(() => {
    clearMocks();
  });

  const type = (value: string): void => {
    fireEvent.change(screen.getByLabelText('gene'), { target: { value } });
  };

  test('tells the placeholder genes apart in the dropdown', async () => {
    mockIPC((cmd) =>
      cmd === 'get_genes'
        ? [gene('let-?(s1799)', 'let-?'), gene('let-?(n886)', 'let-?')]
        : []
    );
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    type('let');
    await waitFor(() => {
      expect(screen.getByText('let-? [let-?(s1799)]')).toBeTruthy();
    });
    expect(screen.getByText('let-? [let-?(n886)]')).toBeTruthy();
  });

  test('lists names that start with the text first, then names that contain it', async () => {
    mockIPC((cmd) =>
      cmd === 'get_genes'
        ? [
            gene('S2', 'lin-unc'),
            gene('S1', 'unc-1'),
            gene('S3', 'dpy-5'),
            gene('unc-9.1', null),
          ]
        : []
    );
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    type('unc');
    await screen.findByText('unc-1');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['unc-1', 'unc-9.1', 'lin-unc']);
  });

  test('answers from the first character, with no minimum', async () => {
    mockIPC((cmd) =>
      cmd === 'get_genes' ? [gene('S1', 'unc-1'), gene('S2', 'dpy-5')] : []
    );
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    type('u');
    expect(await screen.findByText('unc-1')).toBeTruthy();
    expect(screen.queryByText(/Type at least/)).toBeNull();
  });

  test('loads the genes once, not on every keystroke', async () => {
    const loads = vi.fn();
    mockIPC((cmd) => {
      if (cmd === 'get_genes') {
        loads();
        return [gene('S1', 'unc-1')];
      }
      return [];
    });
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    for (const value of ['u', 'un', 'unc', 'unc-']) {
      type(value);
      await screen.findByText('unc-1');
    }
    expect(loads).toHaveBeenCalledTimes(1);
  });

  test('reloads the genes after something marks them stale', async () => {
    let genes = [gene('S1', 'unc-1')];
    const loads = vi.fn();
    mockIPC((cmd) => {
      if (cmd === 'get_genes') {
        loads();
        return genes;
      }
      return [];
    });
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    type('unc');
    await screen.findByText('unc-1');

    genes = [gene('S1', 'unc-1'), gene('S9', 'unc-99')];
    markSearchIndexStale();
    type('unc-');
    expect(await screen.findByText('unc-99')).toBeTruthy();
    expect(loads).toHaveBeenCalledTimes(2);
  });

  test('lists at most 50 and says how many more there are', async () => {
    mockIPC((cmd) =>
      cmd === 'get_genes'
        ? Array.from({ length: 120 }, (_, i) => gene(`S${i}`, `unc-${i}`))
        : []
    );
    render(<GeneSearchInput onSelect={() => {}} ariaLabel='gene' />);
    type('unc');
    await screen.findByText(/Showing 50 of 120/);
    expect(screen.getAllByRole('listitem')).toHaveLength(51); // 50 + the note
  });

  test('picks a gene and shows its name', async () => {
    const onSelect = vi.fn();
    mockIPC((cmd) => (cmd === 'get_genes' ? [gene('S1', 'unc-1')] : []));
    render(<GeneSearchInput onSelect={onSelect} ariaLabel='gene' />);
    type('un');
    fireEvent.click(await screen.findByText('unc-1'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText<HTMLInputElement>('gene').value).toBe('unc-1');
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

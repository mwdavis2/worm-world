import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});

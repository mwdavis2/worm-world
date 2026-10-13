import { render } from '@testing-library/react';
import { toast } from 'react-toastify';
import { toastDbError } from 'utils/showDbError';
import { vi } from 'vitest';

describe('toastDbError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a database failure shows a plain sentence with the original under Details', () => {
    const error = vi.spyOn(toast, 'error').mockReturnValue(0);
    toastDbError(
      {
        Insert:
          'error returned from database: (code: 2067) UNIQUE constraint failed: genes.systematic_name',
      },
      { action: 'add', table: 'genes', label: 'unc-119' }
    );
    const { container } = render(<>{error.mock.calls[0][0]}</>);
    expect(container.textContent).toContain(
      'A gene named "unc-119" already exists.'
    );
    expect(container.textContent).toContain(
      'Details: error returned from database: (code: 2067)'
    );
    expect(error.mock.calls[0][1]).toEqual({ autoClose: 8000 });
  });

  test('an error the app wrote is shown after the action, without Details', () => {
    const error = vi.spyOn(toast, 'error').mockReturnValue(0);
    toastDbError(new Error('Disk is full'), { action: 'edit', table: 'genes' });
    expect(error).toHaveBeenCalledWith('Unable to save the gene: Disk is full');
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import user from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { markSearchIndexStale } from 'utils/searchIndexStale';
import NewAlleleModal from 'components/NewAlleleModal/NewAlleleModal';
import { unc119 } from 'models/frontend/Gene/Gene.mock';
import { toast } from 'react-toastify';
import { vi } from 'vitest';

interface RecordedCall {
  cmd: string;
  payload: unknown;
}

describe('NewAlleleModal', () => {
  let calls: RecordedCall[];

  const NOT_HANDLED = Symbol('not handled');

  const setupIPC = (
    overrides: (cmd: string, payload: unknown) => unknown = () => NOT_HANDLED
  ): void => {
    calls = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      const overridden = overrides(cmd, payload);
      if (overridden !== NOT_HANDLED) return overridden;
      switch (cmd) {
        case 'get_location_reference_variations':
          return [];
        case 'get_genes': // the gene search box
          return [unc119];
        case 'get_filtered_genes':
          return [unc119];
        case 'get_filtered_conditions':
          return [];
        default:
          return undefined;
      }
    });
  };

  beforeEach(() => {
    markSearchIndexStale(); // the gene box loads its names afresh
  });

  afterEach(() => {
    clearMocks();
  });

  test('Gene tab: creates an Allele linked to the picked existing Gene, no Variation insert', async () => {
    setupIPC();
    const onCreated = vi.fn();
    render(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={onCreated} />
    );

    await user.type(screen.getByLabelText('Allele name'), 'ed3');

    const geneInput = screen.getByRole('textbox', { name: 'Gene' });
    await user.type(geneInput, 'unc');
    const option = await screen.findByText(/unc-119/i);
    await user.click(option);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Allele' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Add Allele' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });

    const insertAlleleCall = calls.find((c) => c.cmd === 'insert_allele');
    expect(insertAlleleCall).toBeDefined();
    expect(insertAlleleCall?.payload).toMatchObject({
      allele: expect.objectContaining({
        name: 'ed3',
        sysGeneName: unc119.sysName,
        variationName: null,
      }),
    });
    expect(calls.find((c) => c.cmd === 'insert_variation')).toBeUndefined();
  });

  test('Ti/Si/Is tab: creates a new Variation (with interpolated genetic location) then an Allele linking to it, in that order', async () => {
    setupIPC((cmd) => {
      if (cmd === 'get_filtered_genes') {
        // Anchor genes on chromosome I for the interpolation.
        return [
          {
            ...unc119,
            sysName: 'g1',
            chromosome: 'I',
            physLoc: 0,
            geneticLoc: 0,
          },
          {
            ...unc119,
            sysName: 'g2',
            chromosome: 'I',
            physLoc: 200,
            geneticLoc: 20,
          },
        ];
      }
      return NOT_HANDLED;
    });
    const onCreated = vi.fn();
    render(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={onCreated} />
    );

    await user.click(screen.getByRole('button', { name: 'Ti/Si/Is' }));
    await user.type(screen.getByLabelText('Allele name prefix'), 'ox');
    await user.selectOptions(screen.getByLabelText('Naming type'), 'Si');
    await user.type(screen.getByLabelText('Allele name suffix'), '100000');
    await user.selectOptions(screen.getByLabelText('Chromosome'), 'I');
    await user.type(screen.getByLabelText('Position value'), '100');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Allele' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Add Allele' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });

    const variationCallIdx = calls.findIndex(
      (c) => c.cmd === 'insert_variation'
    );
    const alleleCallIdx = calls.findIndex((c) => c.cmd === 'insert_allele');
    expect(variationCallIdx).toBeGreaterThanOrEqual(0);
    expect(alleleCallIdx).toBeGreaterThan(variationCallIdx);

    const variationPayload = calls[variationCallIdx].payload as {
      variation: { alleleName: string; physLoc: number; geneticLoc: number };
    };
    expect(variationPayload.variation.alleleName).toBe('oxSi100000');
    expect(variationPayload.variation.physLoc).toBe(100);
    // Interpolated between (0,0) and (200,20) at physLoc=100 -> geneticLoc=10.
    expect(variationPayload.variation.geneticLoc).toBeCloseTo(10, 5);

    const allelePayload = calls[alleleCallIdx].payload as {
      allele: { name: string; variationName: string };
    };
    expect(allelePayload.allele.name).toBe('oxSi100000');
    expect(allelePayload.allele.variationName).toBe('oxSi100000');
  });

  test('auto-deletes the orphaned Variation when the subsequent Allele insert fails', async () => {
    setupIPC((cmd) => {
      if (cmd === 'insert_allele') {
        throw new Error('duplicate name');
      }
      return NOT_HANDLED;
    });
    const onCreated = vi.fn();
    render(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={onCreated} />
    );

    await user.click(screen.getByRole('button', { name: 'Ex' }));
    await user.type(screen.getByLabelText('Allele name prefix'), 'ox');
    await user.type(screen.getByLabelText('Allele name suffix'), '2254');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Allele' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Add Allele' }));

    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'delete_filtered_variations')).toBe(
        true
      );
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  test('a manually-added Advanced row does not survive submission when Basic is active', async () => {
    setupIPC();
    const onCreated = vi.fn();
    render(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={onCreated} />
    );

    await user.type(screen.getByLabelText('Allele name'), 'ed3');
    const geneInput = screen.getByRole('textbox', { name: 'Gene' });
    await user.type(geneInput, 'unc');
    await user.click(await screen.findByText(/unc-119/i));

    // Switch to Advanced, type a name into the default (manual, untagged)
    // row, then switch back to Basic - which is what's active at submit.
    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    await user.type(screen.getByPlaceholderText('Name'), 'ManualPhenotype');
    await user.click(screen.getByRole('button', { name: 'Basic' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Allele' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Add Allele' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });

    // No Basic control was checked, so with the manual row correctly
    // excluded, nothing should have been persisted for it at all.
    expect(calls.some((c) => c.cmd === 'insert_phenotype')).toBe(false);
    expect(calls.some((c) => c.cmd === 'insert_allele_expr')).toBe(false);
  });

  test('editing a Basic-derived Advanced row on a Variation tab (e.g. unchecking Wild-type) actually sticks', async () => {
    // Regression test: setActiveVariationTab (used by the Advanced row list
    // for Ti/Si/Is/Ex) used to always run resyncVariationTab, which
    // regenerates every Basic-derived tagged row fresh on every single
    // change - silently reverting any manual edit to one of those rows as
    // long as its originating Basic control was still checked.
    setupIPC((cmd) => {
      if (cmd === 'get_filtered_conditions') {
        return [
          {
            name: 'Hyg',
            description: null,
            maleMating: null,
            lethal: null,
            maleCrossingDefective: null,
            femaleCrossingDefective: null,
            selfCrossingDefective: null,
            him: null,
            arrested: null,
            maturationDays: null,
          },
        ];
      }
      return NOT_HANDLED;
    });
    render(<NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Ex' }));
    // The checkbox is disabled until a drug is picked - pick it first.
    await user.type(screen.getByPlaceholderText('Drug name'), 'Hyg');
    await user.click(await screen.findByText('Hyg'));
    await user.click(
      screen.getByRole('checkbox', { name: 'Resistant to Drug' })
    );

    await user.click(screen.getByRole('button', { name: 'Advanced' }));

    // Resistant-to-Drug now synthesizes two "0 copies" rows sharing the
    // same (name, wild) identity (one suppressed-by-phenotype, one
    // requires-condition) - either works for this test, take the first.
    const zeroCopiesRow = screen
      .getAllByDisplayValue('0 copies')[0]
      .closest('div') as HTMLElement;
    const wildTypeCheckbox =
      within(zeroCopiesRow).getByLabelText<HTMLInputElement>('Wild-type');
    expect(wildTypeCheckbox.checked).toBe(true);

    await user.click(wildTypeCheckbox);
    expect(wildTypeCheckbox.checked).toBe(false);
  });

  test('a new opening starts with empty drug and gene boxes, not the text from the last one', async () => {
    setupIPC((cmd) => {
      if (cmd === 'get_filtered_conditions')
        return [{ name: 'Puromycin', description: 'drug' }];
      return NOT_HANDLED;
    });
    const { rerender } = render(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />
    );

    // pick a drug from the list: the checkbox becomes usable
    const drugBox = screen.getByPlaceholderText('Drug name');
    await user.type(drugBox, 'Puro');
    await user.click(await screen.findByText('Puromycin'));
    expect(screen.getByLabelText('Resistant to Drug')).toBeEnabled();
    expect(drugBox).toHaveValue('Puromycin');

    // close and open again: the box and the checkbox agree (both empty)
    rerender(
      <NewAlleleModal
        isOpen={false}
        setIsOpen={() => {}}
        onCreated={() => {}}
      />
    );
    rerender(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Drug name')).toHaveValue('');
    });
    expect(screen.getByLabelText('Resistant to Drug')).toBeDisabled();
  });

  test('a picked gene does not linger in the gene box on the next opening', async () => {
    setupIPC();
    const { rerender } = render(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />
    );
    await user.type(screen.getByRole('textbox', { name: 'Gene' }), 'unc');
    await user.click(await screen.findByText(/unc-119/i));
    expect(screen.getByRole('textbox', { name: 'Gene' })).not.toHaveValue('');

    rerender(
      <NewAlleleModal
        isOpen={false}
        setIsOpen={() => {}}
        onCreated={() => {}}
      />
    );
    rerender(
      <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />
    );
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Gene' })).toHaveValue('');
    });
  });

  describe('when adding the allele fails', () => {
    const addEd3 = async (): Promise<void> => {
      render(
        <NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />
      );
      await user.type(screen.getByLabelText('Allele name'), 'ed3');
      await user.type(screen.getByRole('textbox', { name: 'Gene' }), 'unc');
      await user.click(await screen.findByText(/unc-119/i));
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Add Allele' })
        ).toBeEnabled();
      });
      await user.click(screen.getByRole('button', { name: 'Add Allele' }));
    };

    test('a name already in use is said beside the name, and nothing is written', async () => {
      setupIPC((cmd) =>
        cmd === 'get_count_filtered_alleles' ? 1 : NOT_HANDLED
      );
      await addEd3();

      expect(
        await screen.findByText('An allele named "ed3" already exists.')
      ).toBeTruthy();
      expect(calls.find((c) => c.cmd === 'insert_allele')).toBeUndefined();
      expect(calls.find((c) => c.cmd === 'insert_variation')).toBeUndefined();
    });

    test('the message goes away when the name is changed', async () => {
      setupIPC((cmd) =>
        cmd === 'get_count_filtered_alleles' ? 1 : NOT_HANDLED
      );
      await addEd3();
      await screen.findByText('An allele named "ed3" already exists.');
      await user.type(screen.getByLabelText('Allele name'), '2');
      expect(
        screen.queryByText('An allele named "ed3" already exists.')
      ).toBeNull();
    });

    test('a database failure is shown as a plain sentence with the original under Details', async () => {
      const error = vi.spyOn(toast, 'error').mockReturnValue(0);
      setupIPC((cmd) => {
        if (cmd === 'get_count_filtered_alleles') return 0;
        if (cmd === 'insert_allele')
          // the backend rejects with an object, not an Error
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw {
            Insert:
              'error returned from database: (code: 787) FOREIGN KEY constraint failed',
          };
        return NOT_HANDLED;
      });
      await addEd3();

      await waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
      const content = error.mock.calls[0][0];
      const { container } = render(<>{content}</>);
      expect(container.textContent).toContain(
        'The gene or variation does not exist. Add it first.'
      );
      expect(container.textContent).toContain('Details:');
      error.mockRestore();
    });
  });

  test('Basic view: Crossing Effects ticked beside the phenotype are saved when adding from Basic', async () => {
    setupIPC((cmd) => (cmd === 'get_filtered_phenotypes' ? [] : NOT_HANDLED));
    render(<NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />);
    await user.type(screen.getByLabelText('Allele name'), 'e1489');
    await user.type(screen.getByRole('textbox', { name: 'Gene' }), 'unc');
    await user.click(await screen.findByText(/unc-119/i));

    // the Basic dominance control: a phenotype name, then its Crossing Effects
    await user.type(screen.getByPlaceholderText('Name'), 'Him-8');
    const dominanceRow = screen
      .getByRole('combobox', { name: 'Dominance' })
      .closest('div') as HTMLElement;
    await user.click(within(dominanceRow).getAllByRole('checkbox')[0]);
    const menu = screen
      .getByText('Crossing Effects')
      .closest('.dropdown') as HTMLElement;
    await user.click(
      within(menu).getByRole('checkbox', {
        name: 'Him (makes males when selfed)',
      })
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Allele' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Add Allele' }));

    await waitFor(() => {
      expect(calls.map((c) => c.cmd).join(',')).toContain('insert_phenotype');
    });
    expect(
      calls.find((c) => c.cmd === 'insert_phenotype')?.payload
    ).toMatchObject({
      phenotype: { name: 'Him-8', wild: false, him: true },
    });
  });

  test('Basic view: Lethal ticked beside the phenotype is saved when adding from Basic', async () => {
    setupIPC((cmd) => (cmd === 'get_filtered_phenotypes' ? [] : NOT_HANDLED));
    render(<NewAlleleModal isOpen setIsOpen={() => {}} onCreated={() => {}} />);
    await user.type(screen.getByLabelText('Allele name'), 'e1489');
    await user.type(screen.getByRole('textbox', { name: 'Gene' }), 'unc');
    await user.click(await screen.findByText(/unc-119/i));

    const dominanceRow = screen
      .getByRole('combobox', { name: 'Dominance' })
      .closest('div') as HTMLElement;
    // Lethal stays unavailable until the phenotype has a name
    expect(
      within(dominanceRow).getByRole<HTMLInputElement>('checkbox', {
        name: 'Lethal',
      }).disabled
    ).toBe(true);
    await user.type(screen.getByPlaceholderText('Name'), 'Let');
    await user.click(within(dominanceRow).getAllByRole('checkbox')[0]);
    await user.click(
      within(dominanceRow).getByRole('checkbox', { name: 'Lethal' })
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Allele' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Add Allele' }));

    await waitFor(() => {
      expect(calls.map((c) => c.cmd)).toContain('insert_phenotype');
    });
    expect(
      calls.find((c) => c.cmd === 'insert_phenotype')?.payload
    ).toMatchObject({ phenotype: { name: 'Let', wild: false, lethal: true } });
  });
});

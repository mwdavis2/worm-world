import { render, screen, waitFor } from '@testing-library/react';
import user from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import NewAlleleModal from 'components/NewAlleleModal/NewAlleleModal';
import { unc119 } from 'models/frontend/Gene/Gene.mock';
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
        case 'get_filtered_genes':
          return [unc119];
        case 'get_filtered_conditions':
          return [];
        default:
          return undefined;
      }
    });
  };

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

    const geneInput = screen.getByPlaceholderText('Type gene name');
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
});

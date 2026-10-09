import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { render, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import user from '@testing-library/user-event';
import StrainForm from 'components/StrainForm/StrainForm';
import { ed3 } from 'models/frontend/Allele/Allele.mock';
import { unc119 } from 'models/frontend/Gene/Gene.mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('Strain form', () => {
  beforeEach(async () => {
    user.setup();

    mockIPC((cmd, _) => {
      if (cmd === 'get_filtered_alleles') {
        return [ed3.generateRecord()];
      }

      if (cmd === 'get_filtered_alleles_with_gene_filter') {
        return [[ed3.generateRecord(), unc119.generateRecord()]];
      }
      if (cmd === 'get_filtered_genes') return [unc119.generateRecord()];
      if (cmd === 'get_filtered_allele_exprs') return [];
      if (cmd === 'get_filtered_strain_alleles') return [];
      if (cmd === 'get_filtered_strains') return [];
    });
  });

  afterAll(() => {
    clearMocks();
  });

  test('No input gives no options', async () => {
    render(
      <StrainForm onSubmit={() => {}} newId={''} alleleDisplayMode='name' />
    );

    await user.click(screen.getByLabelText(/alleles/i));
    await user.keyboard('ed');

    expect(await screen.findByText(/ed3/i)).toBeVisible();

    await user.keyboard('{backspace}{backspace}');
    expect(screen.queryByText(/ed3/i)).toBeNull();
  });

  describe('the strain field', () => {
    const renderForm = (): void => {
      render(
        <StrainForm onSubmit={() => {}} newId={''} alleleDisplayMode='name' />
      );
    };
    const addEd3 = async (): Promise<void> => {
      await user.click(screen.getByLabelText(/^alleles$/i));
      await user.keyboard('ed');
      await user.click(await screen.findByText(/ed3/i));
    };

    test('starts as a search for saved strains and says how to make a new one', () => {
      renderForm();
      expect(screen.getByLabelText('Find a saved strain')).toBeVisible();
      expect(
        screen.getByText('Or add alleles below to make a new strain.')
      ).toBeVisible();
      expect(screen.getByPlaceholderText('Search saved strains')).toBeVisible();
    });

    test("text typed before adding an allele becomes the new strain's name, not lost", async () => {
      renderForm();
      await user.type(screen.getByLabelText('Find a saved strain'), 'testext');
      await addEd3();
      const field = await screen.findByLabelText('Name for the new strain');
      expect(field).toHaveValue('testext');
      expect(screen.getByPlaceholderText('New strain name')).toBeVisible();
    });

    test('a name typed once the strain has alleles keeps the alleles', async () => {
      renderForm();
      await addEd3();
      const field = await screen.findByLabelText('Name for the new strain');
      await user.type(field, 'MyStrain');
      expect(field).toHaveValue('MyStrain');
      // the allele chip is still there
      expect(screen.getAllByText(/ed3/i).length).toBeGreaterThan(0);
      // and the card shows the new name
      expect(screen.getByTestId('strainCard')).toHaveTextContent('MyStrain');
    });
  });

  describe('Add and Save Strain', () => {
    const calls: Array<{ cmd: string; args: any }> = [];
    let failInsert = false;
    beforeEach(() => {
      calls.length = 0;
      failInsert = false;
      mockIPC((cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === 'get_filtered_alleles') return [ed3.generateRecord()];
        if (cmd === 'get_filtered_alleles_with_gene_filter')
          return [[ed3.generateRecord(), unc119.generateRecord()]];
        if (cmd === 'get_filtered_genes') return [unc119.generateRecord()];
        if (cmd === 'get_filtered_allele_exprs') return [];
        if (cmd === 'get_filtered_strain_alleles') return [];
        if (cmd === 'get_filtered_strains') return [];
        if (cmd === 'insert_strain' && failInsert)
          throw new Error('already exists');
      });
      vi.spyOn(toast, 'success').mockReturnValue(0);
      vi.spyOn(toast, 'error').mockReturnValue(0);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const renderForm = (onSubmit = vi.fn()): ReturnType<typeof vi.fn> => {
      render(
        <StrainForm onSubmit={onSubmit} newId={''} alleleDisplayMode='name' />
      );
      return onSubmit;
    };
    const addEd3 = async (): Promise<void> => {
      await user.click(screen.getByLabelText(/^alleles$/i));
      await user.keyboard('ed');
      await user.click(await screen.findByText(/ed3/i));
    };
    const saveButton = (): HTMLElement =>
      screen.getByRole('button', { name: 'Add and Save Strain' });

    test('says why it is disabled, step by step', async () => {
      renderForm();
      expect(saveButton()).toBeDisabled();
      expect(
        screen.getByText('Add alleles to make a strain to save.')
      ).toBeVisible();

      await addEd3();
      expect(saveButton()).toBeDisabled();
      expect(
        await screen.findByText('Name the new strain to save it.')
      ).toBeVisible();

      await user.type(
        screen.getByLabelText('Name for the new strain'),
        'NewOne'
      );
      expect(saveButton()).toBeEnabled();
    });

    test('saves the strain, then adds it to the design with its name', async () => {
      const onSubmit = renderForm();
      await addEd3();
      await user.type(
        await screen.findByLabelText('Name for the new strain'),
        'NewOne'
      );
      await user.click(saveButton());

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(
        calls.find((c) => c.cmd === 'insert_strain')?.args.strain.name
      ).toBe('NewOne');
      expect(calls.some((c) => c.cmd === 'insert_strain_allele')).toBe(true);
      expect((onSubmit.mock.calls[0][0] as { name: string }).name).toBe(
        'NewOne'
      );
      expect(toast.success).toHaveBeenCalledWith('Saved strain');
      // the form starts over
      expect(screen.getByLabelText('Find a saved strain')).toBeVisible();
    });

    test('if the save fails the card is not added and the form keeps its name', async () => {
      failInsert = true;
      const onSubmit = renderForm();
      await addEd3();
      await user.type(
        await screen.findByLabelText('Name for the new strain'),
        'NewOne'
      );
      await user.click(saveButton());

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Name for the new strain')).toHaveValue(
        'NewOne'
      );
    });
  });
});

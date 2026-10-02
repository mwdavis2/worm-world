import { render, screen } from '@testing-library/react';
import user from '@testing-library/user-event';
import DataImportForm, {
  type FieldType,
} from 'components/DataInputForm/DataInputForm';
import { type db_Allele } from 'models/db/db_Allele';
import { vi } from 'vitest';

describe('DataImportForm ', () => {
  test('successfully renders', () => {
    render(
      <DataImportForm
        title='Empty Form'
        dataName={'Empty Form'}
        fields={[]}
        onSubmit={vi.fn()}
      />
    );

    const form = screen.getByRole('heading', { name: /new/i });
    expect(form).toBeDefined();
  });

  test('submit callback is used', async () => {
    user.setup();
    const onSubmit = vi.fn();

    render(
      <DataImportForm
        title='Empty Form'
        dataName={'Empty Form'}
        fields={[]}
        onSubmit={onSubmit}
      />
    );

    const submitButton = screen.getByRole('button');
    expect(onSubmit).toBeCalledTimes(0);

    await user.click(submitButton);
    expect(onSubmit).toBeCalledTimes(1);
  });

  test('displays form fields', async () => {
    const fields: Array<FieldType<db_Allele>> = [
      {
        name: 'name',
        title: 'Allele Name',
        type: 'text',
      },
      {
        name: 'contents',
        title: 'Allele Contents',
        type: 'text',
      },
      {
        name: 'sysGeneName',
        title: 'Systematic Gene Name',
        type: 'text',
      },
      {
        name: 'variationName',
        title: 'Variation Name',
        type: 'text',
      },
    ];

    render(
      <DataImportForm
        title='Allele Form'
        dataName={'Allele Form'}
        fields={fields}
        onSubmit={vi.fn()}
      />
    );

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(fields.length);
  });

  test('Input ignores leading and trailing whitespace', async () => {
    user.setup();
    const fields: Array<FieldType<{ string?: string; number?: number }>> = [
      {
        name: 'string',
        title: 'String',
        type: 'text',
      },
      {
        name: 'number',
        title: 'Number',
        type: 'number',
      },
    ];

    let result;
    const onSubmit = (record: { string?: string; number: number }): void => {
      result = record;
    };

    render(
      <DataImportForm
        title='Form'
        dataName={'Form'}
        fields={fields}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByLabelText('String'));
    await user.keyboard(' abc\t');

    await user.click(screen.getByLabelText('Number'));
    await user.keyboard('\t4   ');

    const submit = screen.getByRole('button', { name: /insert/i });
    await user.click(submit);

    expect(result).toEqual({ string: 'abc', number: 4 });
  });

  describe('add mode resets between uses', () => {
    interface Item {
      name: string;
      flag: boolean;
    }
    const fields: Array<FieldType<Item>> = [
      { name: 'name', title: 'Name', type: 'text' },
      { name: 'flag', title: 'Flag', type: 'boolean' },
    ];

    test('inputs are blank again after a successful insert', async () => {
      user.setup();
      render(
        <DataImportForm<Item>
          title='Items'
          dataName='item'
          fields={fields}
          onSubmit={(_, success) => {
            success();
          }}
        />
      );
      await user.type(screen.getByLabelText('Name'), 'typed');
      await user.click(screen.getByLabelText('Flag'));
      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe(
        'typed'
      );

      await user.click(
        screen.getByRole('button', { name: 'Insert Into Database' })
      );

      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('');
      expect(screen.getByLabelText<HTMLInputElement>('Flag').checked).toBe(
        false
      );
    });

    test('inputs are blank again after cancelling (clicking outside)', async () => {
      user.setup();
      const { container } = render(
        <DataImportForm<Item>
          title='Items'
          dataName='item'
          fields={fields}
          onSubmit={vi.fn()}
        />
      );
      await user.click(screen.getByText('Add New Item'));
      await user.type(screen.getByLabelText('Name'), 'typed');

      await user.click(
        container.querySelector('.modal > .absolute') as HTMLElement
      );

      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('');
    });

    test('a failed insert keeps what was typed', async () => {
      user.setup();
      render(
        <DataImportForm<Item>
          title='Items'
          dataName='item'
          fields={fields}
          onSubmit={vi.fn() /* never calls the success callback */}
        />
      );
      await user.type(screen.getByLabelText('Name'), 'typed');
      await user.click(
        screen.getByRole('button', { name: 'Insert Into Database' })
      );
      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe(
        'typed'
      );
    });
  });

  describe('edit mode', () => {
    interface Thing {
      name: string;
      note: string | null;
      count: number | null;
      flag: boolean;
      kind: string | null;
    }
    const fields: Array<FieldType<Thing>> = [
      { name: 'name', title: 'Name', type: 'text' },
      { name: 'note', title: 'Note', type: 'text' },
      { name: 'count', title: 'Count', type: 'number' },
      { name: 'flag', title: 'Flag', type: 'boolean' },
      {
        name: 'kind',
        title: 'Kind',
        type: 'select',
        selectOptions: ['I', 'II'],
      },
    ];
    const row: Thing = {
      name: 'a-1',
      note: 'hello',
      count: 3,
      flag: true,
      kind: null,
    };

    const renderEdit = (onSubmit = vi.fn(), onClose = vi.fn()): void => {
      render(
        <DataImportForm<Thing>
          mode='edit'
          title='Things'
          dataName='thing-edit'
          fields={fields}
          initialValues={row}
          lockedFields={['name']}
          open={true}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );
    };

    test('is prefilled, titled for editing, and has no Add New button', () => {
      renderEdit();
      expect(screen.getByRole('heading', { name: 'Edit Thing' })).toBeDefined();
      expect(screen.queryByText(/Add New/)).toBeNull();
      expect(screen.getByLabelText<HTMLInputElement>('Note').value).toBe(
        'hello'
      );
      expect(screen.getByLabelText<HTMLInputElement>('Count').value).toBe('3');
      expect(screen.getByLabelText<HTMLInputElement>('Flag').checked).toBe(
        true
      );
    });

    test('key columns are read-only, and submitting returns the row with them intact', async () => {
      user.setup();
      const onSubmit = vi.fn();
      renderEdit(onSubmit);
      expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(
        true
      );

      await user.clear(screen.getByLabelText('Note'));
      await user.type(screen.getByLabelText('Note'), 'changed');
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0]).toEqual({
        name: 'a-1',
        note: 'changed',
        count: 3,
        flag: true,
        kind: null,
      });
    });

    test('an empty select stays empty instead of picking the first option', async () => {
      user.setup();
      const onSubmit = vi.fn();
      renderEdit(onSubmit);
      expect(screen.getByLabelText<HTMLSelectElement>('Kind').value).toBe('');
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));
      expect(onSubmit.mock.calls[0][0].kind).toBeNull();
    });
  });
});

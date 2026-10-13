import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type db_Allele } from 'models/db/db_Allele';
import { type Filter } from 'models/db/filter/Filter';
import { useState } from 'react';
import { ColumnFilter, type Field } from 'components/ColumnFilter/ColumnFilter';

interface ColumnFilterWrapperProps<T> {
  field: Field<T>;
  filterTypes?: Filter[];
  // told whenever the column's stored filters change
  onFilters?: (filters: Filter[]) => void;
}

const ColumnFilterWrapper = <T,>(
  props: ColumnFilterWrapperProps<T>
): React.JSX.Element => {
  const [filterTypes, setFilterTypes] = useState<Filter[]>(
    props.filterTypes ?? new Array<Filter>()
  );
  return (
    <div className='modal-box'>
      <ColumnFilter
        field={props.field}
        columnFilters={filterTypes}
        setColumnFilters={(filters) => {
          setFilterTypes(filters);
          props.onFilters?.(filters);
        }}
      />
    </div>
  );
};

const field: Field<db_Allele> = {
  name: 'name',
  title: 'Allele Name',
  type: 'text',
};

describe('ColumnFilter', () => {
  it('renders', () => {
    render(<ColumnFilterWrapper field={field} />);
    expect(screen.getByText('Allele Name Filters')).toBeInTheDocument();
  });

  it('renders a text input', () => {
    render(
      <ColumnFilterWrapper field={field} filterTypes={[{ Equal: 'foo' }]} />
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders a select input', () => {
    const selectField: Field<db_Allele> = {
      ...field,
      type: 'select',
      selectOptions: ['foo', 'bar'],
    };
    render(
      <ColumnFilterWrapper
        field={selectField}
        filterTypes={[{ Equal: 'foo' }]}
      />
    );
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);
    expect(selects[0].childElementCount).toBeGreaterThan(2); // equal, notEqual, null, notNull
    expect(selects[1].childElementCount).toBe(2); // foo and bar
    for (const child of selects[1].children) {
      expect(child.textContent).toMatch(/foo|bar/);
    }
  });

  it('renders a boolean input', () => {
    const selectField: Field<db_Allele> = { ...field, type: 'boolean' };
    render(<ColumnFilterWrapper field={selectField} filterTypes={['True']} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(1);
    expect(selects[0].childElementCount).toBe(4); // true, false, null, notNull
  });

  it('delete button removes the filter, leaving a blank row to type in', async () => {
    userEvent.setup();
    const filterTypes: Filter[] = [{ Equal: 'foo' }];
    render(<ColumnFilterWrapper field={field} filterTypes={filterTypes} />);
    expect(screen.getByRole('textbox')).toHaveValue('foo');
    await userEvent.click(screen.getByTitle('delete-filter'));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('a text column opens with a blank "Like" search box, no "+" needed', () => {
    render(<ColumnFilterWrapper field={field} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveValue('Like');
  });

  it('typing in the blank row creates the filter', async () => {
    userEvent.setup();
    const seen: Filter[][] = [];
    render(
      <ColumnFilterWrapper
        field={field}
        onFilters={(filters) => seen.push(filters)}
      />
    );
    // nothing is stored just by opening the box
    expect(seen).toHaveLength(0);
    await userEvent.type(screen.getByRole('textbox'), 'ox');
    expect(seen[seen.length - 1]).toEqual([{ Like: 'ox' }]);
    expect(screen.getByRole('textbox')).toHaveValue('ox');
  });

  it('a number column opens with a blank row too', () => {
    const numberField: Field<db_Allele> = { ...field, type: 'number' };
    render(<ColumnFilterWrapper field={numberField} />);
    // the blank row is there without "+", starting as "Equal"
    expect(screen.getByRole('combobox')).toHaveValue('Equal');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('a select column still starts empty, with the "+" button', () => {
    const selectField: Field<db_Allele> = {
      ...field,
      type: 'select',
      selectOptions: ['foo', 'bar'],
    };
    render(<ColumnFilterWrapper field={selectField} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTitle('add-filter')).toBeInTheDocument();
  });

  it('add button adds a second row below the blank one', async () => {
    userEvent.setup();
    render(<ColumnFilterWrapper field={field} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await userEvent.click(screen.getByTitle('add-filter'));
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    // the first row's label is there but hidden
    expect(screen.getAllByText('OR')).toHaveLength(2);
  });

  it('add button adds a second row on a boolean column, below the True it opened with', async () => {
    userEvent.setup();
    const booleanField: Field<db_Allele> = { ...field, type: 'boolean' };
    render(<ColumnFilterWrapper field={booleanField} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    await userEvent.click(screen.getByTitle('add-filter'));
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  describe('a boolean column', () => {
    const boolField: Field<db_Allele> = { ...field, type: 'boolean' };

    it('opens with a True filter already stored, so closing the box applies it', () => {
      const seen: Filter[][] = [];
      render(
        <ColumnFilterWrapper
          field={boolField}
          onFilters={(filters) => seen.push(filters)}
        />
      );
      expect(seen).toEqual([['True']]);
      expect(screen.getByRole('combobox')).toHaveValue('True');
    });

    it('opens with its existing filters untouched', () => {
      const seen: Filter[][] = [];
      render(
        <ColumnFilterWrapper
          field={boolField}
          filterTypes={['False']}
          onFilters={(filters) => seen.push(filters)}
        />
      );
      expect(seen).toHaveLength(0);
      expect(screen.getByRole('combobox')).toHaveValue('False');
    });

    it('deleting the filter leaves none (it is not re-added)', async () => {
      userEvent.setup();
      const seen: Filter[][] = [];
      render(
        <ColumnFilterWrapper
          field={boolField}
          onFilters={(filters) => seen.push(filters)}
        />
      );
      await userEvent.click(screen.getByTitle('delete-filter'));
      expect(seen[seen.length - 1]).toEqual([]);
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('a text column stores nothing just by opening', () => {
      const seen: Filter[][] = [];
      render(
        <ColumnFilterWrapper
          field={field}
          onFilters={(filters) => seen.push(filters)}
        />
      );
      expect(seen).toHaveLength(0);
    });
  });
});

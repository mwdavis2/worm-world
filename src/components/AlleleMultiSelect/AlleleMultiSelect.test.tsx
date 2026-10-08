import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import user from '@testing-library/user-event';
import {
  AlleleMultiSelect,
  type AlleleMultiSelectProps,
} from 'components/AlleleMultiSelect/AlleleMultiSelect';
import { type db_Allele } from 'models/db/db_Allele';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { ed3, ox11000, ox11001 } from 'models/frontend/Allele/Allele.mock';
import { unc119 } from 'models/frontend/Gene/Gene.mock';

const renderComponent = ({
  placeholder = 'testPlaceholder',
  label = 'testLabel',
  shouldInclude = (_: db_Allele) => true,
}): void => {
  render(
    <MockAlleleMultiSelect
      placeholder={placeholder}
      label={label}
      shouldInclude={shouldInclude}
    />
  );
};

const MockAlleleMultiSelect = (props: {
  shouldInclude: (allele: db_Allele) => boolean;
  placeholder: string;
  label: string;
}): React.JSX.Element => {
  const [selectedRecords, setSelectedRecords] = useState<Set<db_Allele>>(
    new Set()
  );
  const selectProps: AlleleMultiSelectProps = {
    selectedRecords,
    setSelectedRecords,
    shouldInclude: props.shouldInclude,
    placeholder: props.placeholder,
    label: props.label,
  };

  return <AlleleMultiSelect {...selectProps} />;
};

describe('AlleleMultiSelect', () => {
  beforeEach(() => {
    mockIPC((cmd, _) => {
      if (cmd === 'get_filtered_alleles_with_gene_filter') {
        return [
          [ed3, unc119],
          [ox11000, unc119],
          [ox11001, unc119],
        ];
      } else return [];
    });
  });

  afterAll(() => {
    clearMocks();
  });

  test('renders', () => {
    renderComponent({});
    expect(screen.getByText(/testLabel/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/testPlaceholder/i)).toBeDefined();
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  test('selects single element', async () => {
    user.setup();
    renderComponent({});
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'unc');

    expect(await screen.findAllByRole('listitem')).toHaveLength(3);

    const option = screen.getByText(/ed3/i);
    await user.click(option);
    await waitFor(() => {
      const ed3Pill = screen.getByText(/ed3/i);
      expect(ed3Pill).toBeDefined();
      expect(screen.getAllByTestId(/closeButton/i)).toHaveLength(1);
    });
  });

  test('selects multiple elements', async () => {
    user.setup();

    renderComponent({});
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'unc');

    const option1 = await screen.findByText(/ed3/i);
    await user.click(option1);
    await waitFor(() => {
      // check pill shows up
      expect(screen.getByText(/ed3/i)).toBeDefined();
      expect(screen.getAllByTestId(/closeButton/i)).toHaveLength(1);
    });

    await user.click(input);
    await user.type(input, 'ox11000');
    const option2 = await screen.findByText('unc-119(ox11000)');

    await user.click(option2);
    await waitFor(() => {
      expect(screen.getByText(/ox11000/i)).toBeDefined();
      expect(screen.getAllByTestId('closeButton')).toHaveLength(2);
    });
  });

  test('filters using shouldInclude', async () => {
    const shouldInclude = (opt: db_Allele): boolean =>
      opt.name === ox11001.name;
    renderComponent({ shouldInclude });
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'unc');

    expect(await screen.findAllByRole('listitem')).toHaveLength(1);

    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent(`${unc119.descName}(${ox11001.name})`);
  });

  test('searches names that start with the text as well as names that contain it, each capped', async () => {
    const calls: any[] = [];
    mockIPC((cmd, args) => {
      if (cmd === 'get_filtered_alleles_with_gene_filter')
        calls.push((args as any).alleleFilter);
      return [[ed3, unc119]];
    });
    renderComponent({});
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'ed');
    await screen.findByText(/ed3/i);
    expect(calls).toHaveLength(2);
    expect(
      calls.map((filter) => Object.keys(filter.filters[0][0][1])[0]).sort()
    ).toEqual(['Like', 'StartsWith']);
    expect(calls.every((filter) => filter.limit === 200)).toBe(true);
  });

  test('does not search for a single character and says so', async () => {
    const searched = vi.fn();
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_alleles_with_gene_filter') searched();
      return [];
    });
    renderComponent({});
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'e');
    expect(screen.getByText(/Type at least 2 characters/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searched).not.toHaveBeenCalled();
  });

  test('shows at most 50 alleles', async () => {
    mockIPC(() =>
      Array.from({ length: 120 }, (_, i) => [{ ...ed3, name: `e${i}` }, unc119])
    );
    renderComponent({});
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.type(input, 'e');
    await user.type(input, '1');
    expect(await screen.findAllByRole('listitem')).toHaveLength(50);
  });
});

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import PunnettSquareModal, { type PunnettInputs } from './PunnettSquareModal';

const allele = (name: string, chromosome: ChromosomeName): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome, geneticLoc: 0 }),
  });

const inputsFor = (mother: Strain, father?: Strain): PunnettInputs => ({
  mother,
  father,
  motherPhenotypes: new Set(),
  fatherPhenotypes: father === undefined ? undefined : new Set(),
  activeConditions: new Set(),
  himNulloFraction: 0.37,
});

const open = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('checkbox', { hidden: true }));
};

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});
afterEach(() => {
  cleanup();
  clearMocks();
});

describe('PunnettSquareModal', () => {
  test('draws nothing until it is opened', () => {
    const herm = new Strain({ allelePairs: [allele('a1', 'III').toTopHet()] });
    render(
      <PunnettSquareModal filterId='m1' getInputs={() => inputsFor(herm)} />
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('a self cross of a heterozygote is a 2x2 grid with 25% in the corners', async () => {
    const herm = new Strain({ allelePairs: [allele('a1', 'III').toTopHet()] });
    render(
      <PunnettSquareModal filterId='m1' getInputs={() => inputsFor(herm)} />
    );
    await open();
    const table = await screen.findByRole('table');
    // two gametes per side, each 50%, so each cell is 25%
    expect(within(table).getAllByText('50.00%')).toHaveLength(4);
    expect(within(table).getAllByText('25.00%').length).toBeGreaterThanOrEqual(
      3
    );
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
  });

  test('a mated cross names both parents and marks the males', async () => {
    const herm = new Strain({ allelePairs: [allele('x1', 'X').toTopHet()] });
    const male = new Strain({
      allelePairs: [allele('x2', 'X').toTopHet()],
    }).toggleSex();
    render(
      <PunnettSquareModal
        filterId='m1'
        getInputs={() => inputsFor(herm, male)}
      />
    );
    await open();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByLabelText('male').length).toBeGreaterThan(0);
    expect(
      within(table).getAllByLabelText('hermaphrodite').length
    ).toBeGreaterThan(0);
  });

  test('says so when the cross has no hermaphrodite to draw', async () => {
    render(<PunnettSquareModal filterId='m1' getInputs={() => undefined} />);
    await open();
    expect(
      await screen.findByText(/no hermaphrodite parent/)
    ).toBeInTheDocument();
  });

  test('a cross with too many gametes gives a message, not a table', async () => {
    const chromosomes: ChromosomeName[] = ['I', 'II', 'III', 'IV', 'V', 'X'];
    const herm = new Strain({
      allelePairs: chromosomes.map((c, idx) => allele(`g${idx}`, c).toTopHet()),
    });
    render(
      <PunnettSquareModal filterId='m1' getInputs={() => inputsFor(herm)} />
    );
    await open();
    await waitFor(() => {
      expect(screen.getByText(/Too many gametes/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('each cell says how many cells share its genotype and phenotype, with their total', async () => {
    const herm = new Strain({ allelePairs: [allele('a1', 'III').toTopHet()] });
    render(
      <PunnettSquareModal filterId='m1' getInputs={() => inputsFor(herm)} />
    );
    await open();
    const table = await screen.findByRole('table');
    // genotypes: one cell each of the two homozygotes, two heterozygotes
    expect(within(table).getAllByText('2 cells · 50.00%')).toHaveLength(2);
    expect(within(table).getAllByText('1 cell · 25.00%')).toHaveLength(2);
    // no phenotypes are defined for the allele, so all four cells share one
    // phenotype, wild type (the +/+ genotype also reads "Wild type")
    expect(within(table).getAllByText('4 cells · 100.00%')).toHaveLength(4);
  });

  test('hovering a genotype lights the cells with that genotype, and only them', async () => {
    const herm = new Strain({ allelePairs: [allele('a1', 'III').toTopHet()] });
    render(
      <PunnettSquareModal filterId='m1' getInputs={() => inputsFor(herm)} />
    );
    await open();
    const table = await screen.findByRole('table');
    const lit = (): number =>
      table.querySelectorAll('td[data-lit="true"]').length;
    expect(lit()).toBe(0);
    await userEvent.hover(within(table).getAllByText('2 cells · 50.00%')[0]);
    expect(lit()).toBe(2);
    await userEvent.unhover(within(table).getAllByText('2 cells · 50.00%')[0]);
    expect(lit()).toBe(0);
    await userEvent.hover(within(table).getAllByText('1 cell · 25.00%')[0]);
    expect(lit()).toBe(1);
  });

  test('hovering a phenotype lights every cell with that phenotype', async () => {
    const herm = new Strain({ allelePairs: [allele('a1', 'III').toTopHet()] });
    render(
      <PunnettSquareModal filterId='m1' getInputs={() => inputsFor(herm)} />
    );
    await open();
    const table = await screen.findByRole('table');
    await userEvent.hover(within(table).getAllByText('4 cells · 100.00%')[0]);
    expect(table.querySelectorAll('td[data-lit="true"]')).toHaveLength(4);
  });
});

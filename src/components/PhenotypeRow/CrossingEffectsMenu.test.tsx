import { render, screen } from '@testing-library/react';
import user from '@testing-library/user-event';
import CrossingEffectsMenu from 'components/PhenotypeRow/CrossingEffectsMenu';
import {
  defaultPhenotypeRow,
  type PhenotypeRowState,
} from 'components/NewAlleleModal/newAlleleTypes';
import { describe, expect, test, vi } from 'vitest';

const draw = (
  row: PhenotypeRowState,
  onChange = vi.fn()
): ReturnType<typeof vi.fn> => {
  render(<CrossingEffectsMenu row={row} onChange={onChange} />);
  return onChange;
};

describe('the Crossing Effects menu', () => {
  test('has a real checkbox for each effect, all off for a new row', () => {
    draw(defaultPhenotypeRow('r'));
    for (const label of [
      'Male crossing defective',
      'Female crossing defective',
      'Self crossing defective',
      'Him (makes males when selfed)',
    ])
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: label }).checked
      ).toBe(false);
    expect(screen.queryByText('1')).toBeNull();
  });

  test('ticking an effect changes just that flag on the row', async () => {
    user.setup();
    const row = defaultPhenotypeRow('r');
    const onChange = draw(row);
    await user.click(
      screen.getByRole('checkbox', { name: 'Self crossing defective' })
    );
    expect(onChange).toHaveBeenCalledWith({
      ...row,
      selfCrossingDefective: true,
    });
  });

  test('shows how many effects are on the button', () => {
    draw({
      ...defaultPhenotypeRow('r'),
      maleCrossingDefective: true,
      him: true,
    });
    expect(
      screen.getByRole('button', { name: /Crossing Effects/ }).textContent
    ).toContain('2');
  });
});

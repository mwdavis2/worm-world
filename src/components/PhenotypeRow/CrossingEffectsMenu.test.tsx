import { render, screen } from '@testing-library/react';
import user from '@testing-library/user-event';
import CrossingEffectsMenu from 'components/PhenotypeRow/CrossingEffectsMenu';
import { type CrossingEffects } from 'components/NewAlleleModal/newAlleleTypes';
import { describe, expect, test, vi } from 'vitest';

const draw = (
  effects: Partial<CrossingEffects>,
  onChange = vi.fn(),
  disabled = false
): ReturnType<typeof vi.fn> => {
  render(
    <CrossingEffectsMenu
      effects={effects}
      onChange={onChange}
      disabled={disabled}
    />
  );
  return onChange;
};

describe('the Crossing Effects menu', () => {
  test('has a real checkbox for each effect, all off for a new row', () => {
    draw({});
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
    const onChange = draw({ him: true });
    await user.click(
      screen.getByRole('checkbox', { name: 'Self crossing defective' })
    );
    // the new tick is added to what was already on
    expect(onChange).toHaveBeenCalledWith({
      maleCrossingDefective: false,
      femaleCrossingDefective: false,
      selfCrossingDefective: true,
      him: true,
    });
  });

  test('shows how many effects are on the button', () => {
    draw({ maleCrossingDefective: true, him: true });
    expect(
      screen.getByRole('button', { name: /Crossing Effects/ }).textContent
    ).toContain('2');
  });

  test('can be disabled, with no checkboxes to tick', () => {
    draw({}, vi.fn(), true);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

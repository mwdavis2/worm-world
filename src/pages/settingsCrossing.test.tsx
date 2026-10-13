import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getPreferences } from 'utils/preferences';
import Settings from './settings';

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === 'get_sync_accounts') return [];
  });
});
afterEach(() => {
  clearMocks();
  localStorage.clear();
});

const draw = (): void => {
  render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  );
};

describe('settings for crossing effects', () => {
  test('crossing effects count by default, and the Him frequency starts at 37%', () => {
    draw();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', {
        name: 'Ignore crossing effects',
      }).checked
    ).toBe(false);
    expect(screen.getByLabelText(/Him male frequency: 37%/)).toBeTruthy();
    expect(getPreferences().himMalePercent).toBe(37);
    expect(getPreferences().ignoreCrossingEffects).toBe(false);
  });

  test('the toggle is saved', () => {
    draw();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Ignore crossing effects' })
    );
    expect(getPreferences().ignoreCrossingEffects).toBe(true);
  });

  test('the Him slider is saved and kept between 1 and 99', () => {
    draw();
    const slider = screen.getByLabelText(/Him male frequency/);
    fireEvent.change(slider, { target: { value: '60' } });
    expect(getPreferences().himMalePercent).toBe(60);
    fireEvent.change(slider, { target: { value: '99' } });
    expect(getPreferences().himMalePercent).toBe(99);
    expect(slider.getAttribute('min')).toBe('1');
    expect(slider.getAttribute('max')).toBe('99');
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { useContextMenuState } from './ContextMenu';

const target = (): HTMLElement => {
  const el = document.createElement('div');
  el.classList.add('pane');
  document.body.appendChild(el);
  return el;
};

describe('useContextMenuState', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('stays open through the click macOS sends after a Ctrl-click', () => {
    const el = target();
    const { result } = renderHook(() => useContextMenuState(['pane']));
    act(() => {
      el.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      );
    });
    expect(result.current.showRightClickMenu).toBe(true);
    act(() => {
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, ctrlKey: true })
      );
    });
    expect(result.current.showRightClickMenu).toBe(true);
  });

  it('closes on a later plain click, and does not stack listeners', () => {
    const el = target();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useContextMenuState(['pane']));
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    act(() => {
      el.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      );
    });
    now.mockReturnValue(5000);
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(result.current.showRightClickMenu).toBe(false);
    unmount();
    const clicks = (fn: MockInstance): number =>
      fn.mock.calls.filter((c) => c[0] === 'click').length;
    expect(clicks(remove)).toBe(clicks(add));
  });
});

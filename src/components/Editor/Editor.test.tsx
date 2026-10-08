import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Editor from 'components/Editor/Editor';
import type CrossDesign from 'models/frontend/CrossDesign/CrossDesign';
import * as crossDesigns from 'models/frontend/CrossDesign/CrossDesign.mock';
import { BrowserRouter } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import { vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';

const Wrapper = ({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element => {
  return (
    <BrowserRouter>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </BrowserRouter>
  );
};

describe('Editor', () => {
  beforeEach(() => {
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
      disconnect: vi.fn(),
      observe: vi.fn(),
      unobserve: vi.fn(),
    }));
  });

  const renderComponent = (tree: CrossDesign): HTMLElement => {
    return render(<Editor crossDesign={tree} testing={true} />, {
      wrapper: Wrapper, // Need this wrapper since the component uses the react router
    }).container;
  };

  test('Renders', () => {
    renderComponent(crossDesigns.simpleCrossDesign);

    const nodes = screen.getAllByTestId('strainCard');
    expect(nodes).toHaveLength(3 + 1 + 1); // +1 preview node on right drawer, +1 AddStrainModal's always-mounted preview card

    const title = screen.getByText(/ed3 Cross/i);
    expect(title).toBeDefined();

    const alleleNames = screen.getAllByText(/ed3/i);
    expect(alleleNames).toHaveLength(5); // title, two heterozygous, one homozygous node

    const plusses = screen.getAllByText(
      (content) => /\+/.test(content) && !/Ctrl\+|Shift\+/.test(content) // not the menu's shortcut hints
    );
    expect(plusses).toHaveLength(2);

    const addNewNodeButton = screen.getByRole('button', {
      name: /^add strain$/i,
    });
    expect(addNewNodeButton).toBeDefined();
  });

  test('can add strain nodes', async () => {
    const user = userEvent.setup();

    renderComponent(crossDesigns.simpleCrossDesign);

    const nodes = screen.getAllByTestId('strainCard');
    expect(nodes).toHaveLength(3 + 1 + 1); // +1 preview node on right drawer, +1 AddStrainModal's always-mounted preview card

    const addNewNodeButton = screen.getByRole('button', {
      name: /^add strain$/i,
    });
    await user.click(addNewNodeButton);

    const formSubmitButton = screen.getByRole('button', {
      name: /add strain to design/i,
    });
    expect(formSubmitButton).toBeDefined();
    expect(formSubmitButton).toBeVisible();

    await user.click(formSubmitButton);
    await waitFor(() => {
      const nodes = screen.getAllByTestId('strainCard');
      expect(nodes).toHaveLength(4 + 1 + 1); // +1 AddStrainModal's always-mounted preview card
    });
  });

  test('adds notes', async () => {
    const user = userEvent.setup();

    renderComponent(crossDesigns.emptyCrossDesign);

    const notes = screen.queryAllByTestId('noteNode');
    expect(notes).toHaveLength(0);

    const addNoteButton = screen.getByRole('button', {
      name: /add note/i,
    });
    await user.click(addNoteButton);

    const formSubmitButton = screen.getByRole('button', { name: /add note/i });
    expect(formSubmitButton).toBeDefined();
    expect(formSubmitButton).toBeVisible();

    await user.click(formSubmitButton);
    await waitFor(() => {
      const notes = screen.getAllByTestId('noteNode');
      expect(notes).toHaveLength(1);
    });

    await user.click(addNoteButton);
    await user.click(formSubmitButton);
    await waitFor(() => {
      const notes = screen.getAllByTestId('noteNode');
      expect(notes).toHaveLength(2);
    });
  });

  test('every control button in the upper left has a tooltip', () => {
    const container = renderComponent(crossDesigns.simpleCrossDesign);
    const buttons = container.querySelectorAll('.react-flow__controls button');
    const tips = [...buttons].map((button) =>
      (
        button.getAttribute('data-tip') ??
        button.closest('[data-tip]')?.getAttribute('data-tip') ??
        ''
      ).replace(/ \(click to change\)$/, '')
    );
    expect(tips.every((tip) => tip !== '')).toBe(true);
    expect(tips).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Fit view/),
        expect.stringMatching(/^Zoom in/),
        expect.stringMatching(/^Zoom out/),
        'Export image',
        expect.stringMatching(/^Allele labels: /),
      ])
    );
    expect(tips.some((tip) => /canvas$/.test(tip))).toBe(true);
  });

  describe('paste notation', () => {
    // The right-click menu is open in testing mode. Its paste item appears only
    // when the clipboard holds notation.
    const withClipboard = (text: string | null): void => {
      mockIPC((cmd, args) => {
        const message = (args as { message?: { cmd?: string } }).message;
        if (cmd === 'tauri' && message?.cmd === 'readText') return text;
        return [];
      });
    };

    afterEach(() => {
      clearMocks();
    });

    test('is offered when the clipboard holds notation', async () => {
      withClipboard('{{a/+ +/+}{b/0}{a/+ +/+}}');
      renderComponent(crossDesigns.simpleCrossDesign);
      expect(
        await screen.findByRole('button', { name: /paste notation/i })
      ).toBeDefined();
    });

    test.each([
      ['ordinary text', 'hello there'],
      ['a genotype string', 'unc-36(e873) eT1(III)/+ + III; eT1(V)/+ V.'],
      ['an empty clipboard', null],
    ])('is not offered for %s', async (_label, text) => {
      withClipboard(text);
      renderComponent(crossDesigns.simpleCrossDesign);
      // Let the clipboard read finish, then check the item never appeared
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add note/i })).toBeDefined();
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        screen.queryByRole('button', { name: /paste notation/i })
      ).toBeNull();
    });
  });
});

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * On macOS a Ctrl-click sends `contextmenu` and then a `click` of its own; that
 * click must not close the menu it just opened.
 */
const OPEN_CLICK_GRACE_MS = 100;

export const useContextMenuState = (
  elementClasses: string[],
  testing: boolean = false
): {
  rightClickXPos: number;
  rightClickYPos: number;
  showRightClickMenu: boolean;
} => {
  const [rightClickXPos, setXPos] = useState(0);
  const [rightClickYPos, setYPos] = useState(0);
  const [showRightClickMenu, setShowMenu] = useState(testing);
  const openedAt = useRef(0);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      if (e.target !== undefined) {
        const target = e.target as HTMLElement;
        for (const elementClass of elementClasses) {
          if (target.classList.contains(elementClass)) {
            e.preventDefault();
            openedAt.current = Date.now();
            setShowMenu(true);
            setXPos(e.pageX);
            setYPos(e.pageY);
            return;
          }
        }
      } else {
        setShowMenu(false);
      }
    },
    [setXPos, setYPos, elementClasses]
  );

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (e.ctrlKey || e.button !== 0) return;
      if (Date.now() - openedAt.current < OPEN_CLICK_GRACE_MS) return;
      showRightClickMenu && setShowMenu(false);
    },
    [showRightClickMenu]
  );

  useEffect(() => {
    document.addEventListener('click', handleClick);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  });

  return { rightClickXPos, rightClickYPos, showRightClickMenu };
};

interface ContextMenuProps {
  children: React.ReactNode | React.ReactNode[];
  xPos: number;
  yPos: number;
}

export const ContextMenu = (props: ContextMenuProps): React.JSX.Element => {
  return (
    <div
      data-testid='context-menu'
      className='absolute z-50 shadow-md'
      style={{ top: props.yPos, left: props.xPos }}
    >
      <ul className='menu-compact menu w-48 rounded-md bg-base-100 p-1 '>
        {props.children}
      </ul>
    </div>
  );
};

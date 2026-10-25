import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

interface PanelResizeOptions {
  invert?: boolean;
}

export const usePanelResize = (
  initialWidth: number,
  min: number,
  max: number,
  options: PanelResizeOptions = {},
) => {
  const { invert = false } = options;
  const [width, setWidth] = useState(initialWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: width };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        const direction = invert ? -1 : 1;
        const delta = direction * (moveEvent.clientX - drag.startX);
        setWidth(Math.min(max, Math.max(min, drag.startWidth + delta)));
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, min, max, invert],
  );

  return { width, handleMouseDown };
};

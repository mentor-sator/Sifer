import { useCallback, useRef, type PointerEvent } from 'react';
import './orb.css';

export function Orb() {
  const dragging = useRef(false);

  const beginDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    window.sifer.orb.beginDrag({ x: event.screenX, y: event.screenY });
  }, []);

  const continueDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      window.sifer.orb.dragTo({ x: event.screenX, y: event.screenY });
    }
  }, []);

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      return;
    }
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.sifer.orb.endDrag();
  }, []);

  return (
    <div
      className="orb"
      aria-label="Sifer"
      onPointerDown={beginDrag}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragStart={(event) => event.preventDefault()}
    />
  );
}

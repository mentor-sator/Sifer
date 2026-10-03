import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { OrbState } from '../../shared/bridge';
import './orb.css';

const clickSlack = 5;

export function Orb() {
  const [state, setState] = useState<OrbState>('signed-out');
  const dragging = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => window.sifer.orb.onState(setState), []);

  const beginDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    moved.current = false;
    origin.current = { x: event.screenX, y: event.screenY };
    window.sifer.orb.beginDrag({ x: event.screenX, y: event.screenY });
  }, []);

  const continueDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      return;
    }
    const start = origin.current;
    if (
      start &&
      (Math.abs(event.screenX - start.x) > clickSlack ||
        Math.abs(event.screenY - start.y) > clickSlack)
    ) {
      moved.current = true;
    }
    window.sifer.orb.dragTo({ x: event.screenX, y: event.screenY });
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
    if (!moved.current) {
      window.sifer.orb.click();
    }
  }, []);

  return (
    <div
      className={`orb ${state}`}
      aria-label={`Sifer (${state.replace('-', ' ')})`}
      onPointerDown={beginDrag}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragStart={(event) => event.preventDefault()}
    >
      <span className="ring" />
    </div>
  );
}

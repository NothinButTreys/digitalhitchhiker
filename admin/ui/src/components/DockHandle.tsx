import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { DOCK_WORDS, dockAt, nextDock, type Dock } from "../editor-dock";
import { GripIcon } from "./icons";

/** How far the pointer must travel before a press on the handle counts as a drag. */
const DRAG_FROM = 8;

type Props = { dock: Dock; onDock: (dock: Dock) => void };

/**
 * The tab the editor panel is moved by. Dragged, the panel snaps to the
 * left, the right or the bottom, wherever it is let go, and an outline shows
 * where that will be. Pressed without dragging (a click, Enter, a screen
 * reader's double tap), it moves the panel round to the next place; with the
 * keyboard's focus on it, the arrow keys send it left, right or down.
 */
export function DockHandle({ dock, onDock }: Props) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [target, setTarget] = useState<Dock | null>(null);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    dragged.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const from = start.current;
    if (!from) return;
    if (!dragged.current && Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_FROM) return;
    dragged.current = true;
    setTarget(dockAt(event.clientX, event.clientY, window.innerWidth, window.innerHeight));
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    if (!start.current) return;
    start.current = null;
    if (!dragged.current) return;
    setTarget(null);
    onDock(dockAt(event.clientX, event.clientY, window.innerWidth, window.innerHeight));
    // Letting go after a drag also sends a click, at once, when the drag was
    // made with a mouse; that click is the drag's, not a press. A finger's
    // drag sends none, so the mark is wiped a moment later either way and
    // can never swallow the next real press.
    window.setTimeout(() => {
      dragged.current = false;
    }, 0);
  };
  const cancel = () => {
    start.current = null;
    dragged.current = false;
    setTarget(null);
  };
  // The pointer was let go somewhere the handle never heard about.
  const lost = () => {
    start.current = null;
    setTarget(null);
  };

  const click = (event: MouseEvent<HTMLButtonElement>) => {
    // A click with no pointer behind it (the keyboard, a screen reader) is always a press.
    if (dragged.current && event.detail !== 0) {
      dragged.current = false;
      return;
    }
    dragged.current = false;
    onDock(nextDock(dock));
  };

  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const to = ({ ArrowLeft: "left", ArrowRight: "right", ArrowDown: "bottom" } as const)[event.key as "ArrowLeft"];
    if (!to) return;
    event.preventDefault();
    if (to !== dock) onDock(to);
  };

  return (
    <>
      <button
        type="button"
        className="icon-button dock-handle"
        aria-label={`Move this panel. It is ${DOCK_WORDS[dock]}. Press to move it, or use the arrow keys.`}
        title="Drag to the left, the right or the bottom"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={lost}
        onClick={click}
        onKeyDown={key}
      >
        <GripIcon />
      </button>
      {target && <div className="dock-preview" data-dock={target} aria-hidden="true" />}
    </>
  );
}

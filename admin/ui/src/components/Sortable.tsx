import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createContext, useContext, useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

const INSTRUCTIONS =
  "To move this item, press Space or Enter, use the arrow keys to choose a new position, then press Space or Enter again. Press Escape to cancel. Activating this button any other way opens the item's details, which have buttons that move it.";

/** How long a finger must rest on an item before it is picked up, so that a scroll is not mistaken for a drag. */
const HOLD_MS = 300;
/** A click this soon after a drag ends belongs to the drag (the release), not to the person. */
const AFTER_DRAG_MS = 400;

const STRATEGIES = { grid: rectSortingStrategy, strip: horizontalListSortingStrategy, list: verticalListSortingStrategy };

type DragState = { active: boolean; endedAt: number };
const DragStateContext = createContext<{ current: DragState } | null>(null);

type Props = {
  ids: string[];
  /** A grid of tiles, a single row that scrolls sideways, or a single column. */
  layout: "grid" | "strip" | "list";
  /** True while a change is being saved, so a second move cannot overtake it. */
  disabled?: boolean;
  /** What to call an item when announcing a move to a screen reader. */
  nameOf: (id: string) => string;
  onReorder: (ids: string[]) => void;
  children: ReactNode;
};

/**
 * Drag-and-drop ordering that works three ways: with a mouse (drag), with a
 * finger (press and hold, then drag, so an ordinary swipe still scrolls the
 * page), and with a keyboard (from each item's handle). Every move is read
 * out to screen readers.
 */
export function Sortable({ ids, layout, disabled = false, nameOf, onReorder, children }: Props) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: HOLD_MS, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const place = (id: UniqueIdentifier) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`;
  const name = (id: UniqueIdentifier) => nameOf(String(id));
  // A picked-up item is at once "over" its own place. Saying so would cut
  // off the words that it was picked up, so its own place is only read out
  // once it has been somewhere else and come back.
  const hasLeft = useRef(false);
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      hasLeft.current = false;
      return `Picked up ${name(active.id)}, in ${place(active.id)}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      if (over.id === active.id && !hasLeft.current) return undefined;
      hasLeft.current = true;
      return `${name(active.id)} is over ${place(over.id)}.`;
    },
    onDragEnd: ({ active, over }) =>
      over ? `${name(active.id)} was put in ${place(over.id)}.` : `${name(active.id)} was put back.`,
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
  };

  // Releasing the mouse after a drag also produces a click on whatever is
  // under the pointer, and an item may be dragged by a link. The drag library
  // stops that click from reaching the page's own handlers but not from
  // following the link, so while a drag is under way, and for a moment after,
  // clicks are cancelled outright.
  const drag = useRef<DragState>({ active: false, endedAt: 0 });
  const cancelClick = useRef<((event: Event) => void) | null>(null);
  const stopCancelling = () => {
    const listener = cancelClick.current;
    cancelClick.current = null;
    if (listener) document.removeEventListener("click", listener, true);
  };
  useEffect(() => stopCancelling, []);

  const begin = () => {
    drag.current = { active: true, endedAt: 0 };
    stopCancelling();
    const listener = (event: Event) => event.preventDefault();
    cancelClick.current = listener;
    document.addEventListener("click", listener, true);
  };
  const settle = () => {
    drag.current = { active: false, endedAt: Date.now() };
    const listener = cancelClick.current;
    window.setTimeout(() => {
      if (cancelClick.current === listener) stopCancelling();
    }, 60);
  };

  const finish = ({ active, over }: DragEndEvent) => {
    settle();
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      onDragStart={begin}
      onDragEnd={finish}
      onDragCancel={settle}
    >
      <SortableContext items={ids} strategy={STRATEGIES[layout]} disabled={disabled}>
        <DragStateContext.Provider value={drag}>{children}</DragStateContext.Provider>
      </SortableContext>
    </DndContext>
  );
}

/**
 * Props for one sortable item. `itemProps` go on the element that moves and
 * can be dragged from anywhere on it; `handleProps` go on the one button a
 * keyboard or screen-reader user reorders it from.
 *
 * `onActivate` runs when the handle is pressed without dragging: a plain
 * click, or the "click" a screen reader's double-tap, a switch, or a voice
 * command sends. None of those can hold Space and press arrows, so the
 * handle takes them to wherever the move buttons are.
 */
export function useSortableItem(id: string, onActivate?: () => void) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const drag = useContext(DragStateContext);
  const onClick = () => {
    const state = drag?.current;
    if (!state || state.active || Date.now() - state.endedAt < AFTER_DRAG_MS) return;
    onActivate?.();
  };
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  // Pressing and holding is how a finger picks an item up, and it is also how
  // a phone opens its "save image" or "open link" menu. For a finger, the
  // item wins; a mouse's right-click menu is left alone.
  const onContextMenu = (event: MouseEvent) => {
    if ((event.nativeEvent as PointerEvent).pointerType === "touch") event.preventDefault();
  };
  return {
    itemProps: { ref: setNodeRef, style, "data-dragging": isDragging ? "" : undefined, onContextMenu, ...listeners },
    handleProps: { ref: setActivatorNodeRef, ...attributes, onClick },
  };
}

export { arrayMove };

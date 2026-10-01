import { useEffect, useRef, type ReactNode } from "react";
import { Problem, type ProblemInfo } from "./Problem";

export type Order = {
  index: number;
  count: number;
  /** Why the last move failed, if it did. */
  problem: ProblemInfo;
  move: (delta: -1 | 1) => void;
};

type Props = {
  order: Order;
  /** Completes "Position 2 of 6 …", e.g. "on the site". */
  where: string;
  earlier: ReactNode;
  later: ReactNode;
};

/**
 * Moving an item one place at a time with plain buttons: the way to reorder
 * for anyone who cannot, or would rather not, drag.
 *
 * Presses are never refused while an earlier one is being saved; they take
 * their turn. At either end of the order the button that has nowhere to go
 * is marked `aria-disabled` rather than disabled, and focus moves to the
 * button that still works, so the keyboard is never left on a dead control.
 */
export function MoveButtons({ order, where, earlier, later }: Props) {
  const earlierRef = useRef<HTMLButtonElement>(null);
  const laterRef = useRef<HTMLButtonElement>(null);
  const atStart = order.index === 0;
  const atEnd = order.index === order.count - 1;

  useEffect(() => {
    const focused = document.activeElement;
    if (atStart && !atEnd && focused === earlierRef.current) laterRef.current?.focus();
    else if (atEnd && !atStart && focused === laterRef.current) earlierRef.current?.focus();
  }, [atStart, atEnd]);

  const press = (delta: -1 | 1, off: boolean) => () => {
    if (!off) order.move(delta);
  };

  return (
    <div className="order-row">
      {/* Read out when it changes: while a dialog is open the screen behind
          it is inert, so this is where a move is confirmed. */}
      <p role="status">
        Position {order.index + 1} of {order.count} {where}
      </p>
      <Problem error={order.problem} />
      <div className="form-actions">
        <button ref={earlierRef} type="button" className="with-icon" aria-disabled={atStart || undefined} onClick={press(-1, atStart)}>
          {earlier}
        </button>
        <button ref={laterRef} type="button" className="with-icon" aria-disabled={atEnd || undefined} onClick={press(1, atEnd)}>
          {later}
        </button>
      </div>
    </div>
  );
}

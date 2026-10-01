import type { ReactNode } from "react";
import { CloseIcon } from "./icons";

/**
 * A close button that stays at the top corner of a dialog however far its
 * contents have been scrolled, so a long dialog on a small screen can always
 * be left in one press.
 */
export function DialogClose({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  // The bar has no height of its own, so it takes up no room in the dialog;
  // it only carries the button along as the dialog scrolls.
  return (
    <div className="dialog-close-bar">
      {/* Anything else the bar carries sits at its other end. */}
      {children}
      <button type="button" className="icon-button dialog-close" aria-label="Close" title="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

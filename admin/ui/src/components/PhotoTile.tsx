import type { HTMLAttributes, Ref } from "react";
import type { PhotoOut } from "../types";
import { CheckIcon, GripIcon, PencilIcon, TrashIcon } from "./icons";
import { useSortableItem } from "./Sortable";

type Props = {
  photo: PhotoOut;
  /** What to call the photograph in control names: its title, or "Untitled photograph 2". */
  name: string;
  /** True while this photograph is the one open in the editor. */
  editing?: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

type ViewProps = Props & {
  /** 1-based place among the shown photographs. */
  number?: number;
  itemProps?: HTMLAttributes<HTMLLIElement> & { ref?: Ref<HTMLLIElement> };
  handleProps?: HTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> };
};

/**
 * One photograph as a tile that is nothing but the image until it is pointed
 * at, focused, or (on a touch screen, where there is no pointing) always:
 * then its controls and title appear over it. "Needs text" is a state, not a
 * control, so that one label always shows.
 */
function TileView({ photo, name, editing, number, onToggle, onEdit, onDelete, itemProps, handleProps }: ViewProps) {
  const needsText = photo.textStatus === "needs_text";
  const tickHint = photo.selected
    ? "Shown on the site. Press to take it off."
    : needsText
      ? "Add its text, then show it on the site"
      : "Show on the site";

  return (
    <li
      className="tile"
      data-photo-id={photo.id}
      data-shown={photo.selected ? "" : undefined}
      data-editing={editing ? "" : undefined}
      {...itemProps}
    >
      <img
        src={photo.previewUrl}
        alt={photo.alt || "Untitled photograph"}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        draggable={false}
        onClick={onEdit}
      />
      {needsText && <span className="tile-badge label">Needs text</span>}
      {/* A shown photograph always carries its place in the order. */}
      {number !== undefined && (
        <span className="tile-number" aria-hidden="true">
          {String(number).padStart(2, "0")}
        </span>
      )}
      <div className="tile-top">
        <button
          type="button"
          className="icon-button tick"
          data-control="tick"
          aria-pressed={photo.selected}
          aria-label={`Show ${name} on the site`}
          title={tickHint}
          onClick={onToggle}
        >
          <CheckIcon />
        </button>
        <span className="tile-actions">
          <button type="button" className="icon-button" data-control="edit" aria-label={`Edit ${name}`} title="Edit" onClick={onEdit}>
            <PencilIcon />
          </button>
          <button type="button" className="icon-button" aria-label={`Delete ${name}`} title="Delete" onClick={onDelete}>
            <TrashIcon />
          </button>
        </span>
      </div>
      {!needsText && (
        <div className="tile-caption">
          <span className="tile-title">{photo.title}</span>
          {handleProps && (
            <button type="button" className="icon-button grip" aria-label={`Reorder ${name}`} title="Drag to reorder" {...handleProps}>
              <GripIcon />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function PhotoTile(props: Props) {
  return <TileView {...props} />;
}

/** A shown photograph: the same tile, draggable, with a handle for the keyboard. */
export function SortablePhotoTile({ number, ...props }: Props & { number: number }) {
  // Pressing the handle without dragging opens the editor, where the Move
  // earlier and Move later buttons are.
  const { itemProps, handleProps } = useSortableItem(props.photo.id, props.onEdit);
  return <TileView {...props} number={number} itemProps={itemProps} handleProps={handleProps} />;
}

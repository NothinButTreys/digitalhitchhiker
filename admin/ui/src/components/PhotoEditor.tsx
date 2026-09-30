import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import type { Api } from "../api";
import type { CategoryOut, PhotoOut } from "../types";
import { useAction } from "../use-action";
import { DialogClose } from "./DialogClose";
import { ArrowLeftIcon, ArrowRightIcon, TrashIcon } from "./icons";
import { MoveButtons, type Order } from "./MoveButtons";
import { Problem } from "./Problem";

type Props = {
  api: Api;
  photo: PhotoOut;
  categories: CategoryOut[];
  /** "show" when the owner asked to show a photograph that still needs its text: saving then shows it. */
  intent?: "show";
  /** Where a shown photograph sits in its set, with buttons to move it without dragging. */
  order?: Order;
  /**
   * The text was saved. `andShow` is true only when the editor was opened in
   * order to show the photograph and is still open as the save lands; an
   * editor closed while its save was on its way must not show anything.
   */
  onChange: (photo: PhotoOut, options: { andShow: boolean }) => void;
  onRemoved: (id: string, how: "deleted" | "moved") => void;
  onClose: () => void;
};

export function PhotoEditor({ api, photo, categories, intent, order, onChange, onRemoved, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const [text, setText] = useState({ title: photo.title, alt: photo.alt, description: photo.description });
  const [target, setTarget] = useState("");
  const { busy, problem, run } = useAction();

  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
    // Opening on the title field suits a keyboard. On a touch screen it would
    // raise the on-screen keyboard over the photograph the owner may only
    // have wanted to look at, so there focus goes to the heading, unless the
    // editor was opened precisely in order to type the text.
    const touch = typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
    if (touch && intent !== "show") heading.current?.focus();
    else title.current?.focus();
  }, [intent]);

  // Every way of leaving the editor closes the dialog through close() rather
  // than calling onClose() directly, so the browser (or, in tests, the dialog
  // stub) can restore focus to whatever had it before the dialog opened. The
  // dialog's own close event is the one path that tells the parent, so it is
  // never notified twice.
  const close = () => {
    if (!busy) dialog.current?.close();
  };

  // Escape asks to close too. While something is being saved the editor
  // stays, so what happens next is never decided by a dialog that has gone.
  const cancel = (event: SyntheticEvent) => {
    if (busy) event.preventDefault();
  };

  // While saving, the fields are read-only and the buttons only marked as
  // unavailable, never disabled, so whichever has the keyboard's focus keeps
  // it if the save fails and there is something to correct.
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    return run(async () => {
      const saved = await api.saveText(photo.id, text);
      onChange(saved, { andShow: intent === "show" && dialog.current?.open === true });
      dialog.current?.close();
    });
  };

  const move = () =>
    run(async () => {
      if (!target || busy) return;
      await api.movePhoto(photo.id, target);
      onRemoved(photo.id, "moved");
      dialog.current?.close();
    });

  const remove = () =>
    run(async () => {
      if (busy) return;
      if (!window.confirm("Delete this photograph from the library? This cannot be undone.")) return;
      await api.deletePhoto(photo.id);
      onRemoved(photo.id, "deleted");
      dialog.current?.close();
    });

  const others = categories.filter((category) => category.id !== photo.categoryId);

  return (
    <dialog ref={dialog} className="dialog editor" aria-labelledby="editor-heading" onClose={onClose} onCancel={cancel}>
      <DialogClose onClose={close} />
      <div className="editor-media">
        <img src={photo.previewUrl} alt={photo.alt || "Untitled photograph"} width={photo.width} height={photo.height} />
        <p className="muted">{photo.originalName}</p>
      </div>

      <div className="editor-body">
        <h2 id="editor-heading" ref={heading} tabIndex={-1}>
          {photo.title || "Untitled photograph"}
        </h2>
        {photo.textStatus !== "approved" && (
          <p className="muted">A photograph needs a title, alt text, and a description before it can be shown on the site.</p>
        )}

        <Problem error={problem} />

        <form onSubmit={save} className="form">
          <label>
            Title
            <input ref={title} required maxLength={60} readOnly={busy} value={text.title} onChange={(event) => setText({ ...text, title: event.target.value })} />
          </label>
          <label>
            Alt text
            <textarea required maxLength={200} rows={2} readOnly={busy} value={text.alt} onChange={(event) => setText({ ...text, alt: event.target.value })} />
          </label>
          <p className="muted">Say what is visible, for someone who cannot see the photograph.</p>
          <label>
            Description
            <textarea required maxLength={400} rows={3} readOnly={busy} value={text.description} onChange={(event) => setText({ ...text, description: event.target.value })} />
          </label>
          <div className="form-actions">
            <button type="submit" className="primary" aria-disabled={busy || undefined}>
              {intent === "show" ? "Save and show on the site" : "Save text"}
            </button>
          </div>
        </form>

        {order && (
          <MoveButtons
            order={order}
            where="on the site"
            earlier={
              <>
                <ArrowLeftIcon />
                Move earlier
              </>
            }
            later={
              <>
                Move later
                <ArrowRightIcon />
              </>
            }
          />
        )}

        {others.length > 0 && (
          <div className="editor-move">
            <label>
              Move to
              <select disabled={busy} value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">Choose a category</option>
                {others.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" aria-disabled={busy || !target || undefined} onClick={move}>
              Move
            </button>
          </div>
        )}

        <div className="form-actions editor-end">
          <button type="button" className="with-icon danger" aria-disabled={busy || undefined} onClick={remove}>
            <TrashIcon />
            Delete photograph
          </button>
        </div>
      </div>
    </dialog>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Api } from "../api";
import type { CategoryOut, PhotoOut } from "../types";
import { useAction } from "../use-action";
import { Problem } from "./Problem";

type Props = {
  api: Api;
  photo: PhotoOut;
  categories: CategoryOut[];
  onChange: (photo: PhotoOut) => void;
  onRemoved: (id: string) => void;
  onClose: () => void;
};

export function PhotoEditor({ api, photo, categories, onChange, onRemoved, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState({ title: photo.title, alt: photo.alt, description: photo.description });
  const [target, setTarget] = useState("");
  const { busy, problem, run } = useAction();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  // Every way of leaving the editor closes the dialog through close() rather
  // than calling onClose() directly, so the browser (or, in tests, the dialog
  // stub) can restore focus to whatever had it before the dialog opened. The
  // dialog's own close event is the one path that tells the parent, so it is
  // never notified twice.
  const save = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      onChange(await api.saveText(photo.id, text));
      dialog.current?.close();
    });
  };

  const move = () =>
    run(async () => {
      if (!target) return;
      await api.movePhoto(photo.id, target);
      onRemoved(photo.id);
      dialog.current?.close();
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm("Delete this photograph from the library? This cannot be undone.")) return;
      await api.deletePhoto(photo.id);
      onRemoved(photo.id);
      dialog.current?.close();
    });

  const heading = photo.title || "Untitled photograph";

  return (
    <dialog ref={dialog} className="editor" aria-labelledby="editor-heading" onClose={onClose}>
      <h2 id="editor-heading">{heading}</h2>
      <p className="muted">A photograph needs a title, alt text, and a description before it can be shown on the site.</p>
      <img src={photo.previewUrl} alt={photo.alt || "Untitled photograph"} width={photo.width} height={photo.height} />
      <p className="muted">{photo.originalName}</p>

      <Problem error={problem} />

      <form onSubmit={save} className="editor-form">
        <label>
          Title
          <input required maxLength={60} disabled={busy} value={text.title} onChange={(event) => setText({ ...text, title: event.target.value })} />
        </label>
        <label>
          Alt text
          <textarea required maxLength={200} rows={2} disabled={busy} value={text.alt} onChange={(event) => setText({ ...text, alt: event.target.value })} />
        </label>
        <p className="muted">Say what is visible, for someone who cannot see the photograph.</p>
        <label>
          Description
          <textarea required maxLength={400} rows={3} disabled={busy} value={text.description} onChange={(event) => setText({ ...text, description: event.target.value })} />
        </label>
        <div className="editor-actions">
          <button type="submit" disabled={busy}>
            {photo.textStatus === "approved" ? "Save text" : "Approve text"}
          </button>
        </div>
      </form>

      <div className="editor-actions">
        <label>
          Move to
          <select disabled={busy} value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Choose a category</option>
            {categories
              .filter((category) => category.id !== photo.categoryId)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
          </select>
        </label>
        <button type="button" disabled={busy || !target} onClick={move}>
          Move
        </button>
      </div>

      <div className="editor-actions">
        <button type="button" disabled={busy} onClick={remove}>
          Delete photograph
        </button>
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}

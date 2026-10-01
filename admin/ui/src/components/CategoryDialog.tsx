import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Api } from "../api";
import type { CategoryOut } from "../types";
import { useAction } from "../use-action";
import { DialogClose } from "./DialogClose";
import { ArrowDownIcon, ArrowUpIcon } from "./icons";
import { MoveButtons, type Order } from "./MoveButtons";
import { Problem } from "./Problem";

type FormProps = {
  api: Api;
  /** The category being edited; absent when creating one. */
  category?: CategoryOut;
  headingId: string;
  heading: string;
  onDone: (category: CategoryOut) => void;
};

/** The three fields of a category, for creating one or editing its details. */
export function CategoryForm({ api, category, headingId, heading, onDone }: FormProps) {
  const [form, setForm] = useState({
    title: category?.title ?? "",
    place: category?.place ?? "",
    description: category?.description ?? "",
  });
  const { busy, problem, run } = useAction();

  // While saving, the fields are read-only and the button only marked as
  // unavailable, never disabled, so whichever has the keyboard's focus keeps
  // it if the save fails and there is something to correct.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    return run(async () => {
      onDone(category ? await api.updateCategory(category.id, form) : await api.createCategory(form));
    });
  };

  return (
    <form className="form" onSubmit={submit} aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        {heading}
      </h2>
      <Problem error={problem} />
      <label>
        Title
        <input required maxLength={60} readOnly={busy} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </label>
      <label>
        Place
        <input required maxLength={40} readOnly={busy} value={form.place} onChange={(event) => setForm({ ...form, place: event.target.value })} />
      </label>
      <label>
        Description
        <textarea
          required
          maxLength={300}
          rows={3}
          readOnly={busy}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </label>
      {category ? (
        <p className="muted">The address /{category.slug} was set when the category was created and does not change.</p>
      ) : (
        <p className="muted">The title also sets the category's address on the site, which cannot be changed later.</p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" aria-disabled={busy || undefined}>
          {category ? "Save details" : "Create category"}
        </button>
      </div>
    </form>
  );
}

type DialogProps = {
  api: Api;
  category?: CategoryOut;
  /** Where the category sits in the site's menu, with buttons to move it. Editing only. */
  order?: Order;
  onDone: (category: CategoryOut) => void;
  onClose: () => void;
};

export function CategoryDialog({ api, category, order, onDone, onClose }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  const editing = category !== undefined;
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
    // A new category starts with typing its title. Details opened on a touch
    // screen may only be for a look or a move, so there the on-screen
    // keyboard is left down and focus goes to the heading.
    const touch = typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
    const target = editing && touch ? element.querySelector<HTMLElement>("h2") : element.querySelector<HTMLElement>("input");
    target?.focus();
  }, [editing]);

  // Every exit goes through close(), so the browser returns focus to whatever
  // opened the dialog and the parent hears about it exactly once, from the
  // dialog's own close event.
  const close = () => dialog.current?.close();

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="category-dialog-heading" onClose={onClose}>
      <DialogClose onClose={close} />
      <CategoryForm
        api={api}
        category={category}
        headingId="category-dialog-heading"
        heading={category ? `${category.title} details` : "New category"}
        onDone={(done) => {
          onDone(done);
          close();
        }}
      />
      {order && category && (
        <MoveButtons
          order={order}
          where="in the site's menu"
          earlier={
            <>
              <ArrowUpIcon />
              Move up
            </>
          }
          later={
            <>
              <ArrowDownIcon />
              Move down
            </>
          }
        />
      )}
    </dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Api } from "../api";
import { CategoryDialog, CategoryForm } from "../components/CategoryDialog";
import { EyeIcon, EyeOffIcon, GripIcon, PencilIcon, PlusIcon, TrashIcon } from "../components/icons";
import { Problem } from "../components/Problem";
import { Sortable, arrayMove, useSortableItem } from "../components/Sortable";
import { useLibrary } from "../library";
import type { CategoryOut } from "../types";
import { useAction } from "../use-action";
import { useTitle } from "../use-title";

function status(category: CategoryOut): "Live" | "Hidden" | "Not shown" {
  if (category.hidden) return "Hidden";
  return category.live ? "Live" : "Not shown";
}

type RowProps = {
  category: CategoryOut;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function CategoryRow({ category, onToggle, onEdit, onDelete }: RowProps) {
  // Pressing the handle without dragging opens the details, where the Move
  // up and Move down buttons are.
  const { itemProps, handleProps } = useSortableItem(category.id, onEdit);
  return (
    <li className="row" {...itemProps}>
      <button type="button" className="icon-button grip" aria-label={`Reorder ${category.title}`} title="Drag to reorder" {...handleProps}>
        <GripIcon />
      </button>
      {/* The title is the link; its hit area is stretched over the cover and
          the text beside it, so the whole left of the row opens the category
          while the link's name stays just the title. */}
      <div className="row-main">
        <span className="row-cover">
          {category.coverUrl && <img src={category.coverUrl} alt="" loading="lazy" draggable={false} />}
        </span>
        <div className="row-text">
          <Link to={`/c/${category.id}`} className="row-title" draggable={false}>
            {category.title}
          </Link>
          <span className="label muted">{category.place}</span>
          <span className="muted">
            {category.photoCount} photographs, {category.selectedCount} shown
          </span>
        </div>
      </div>
      <span className="label status" data-status={status(category)}>
        {status(category)}
      </span>
      <div className="row-actions">
        <button
          type="button"
          className="icon-button"
          onClick={onToggle}
          aria-label={`${category.hidden ? "Show" : "Hide"} ${category.title}`}
          title={category.hidden ? "Hidden. Press to show it on the site." : "Hide from the site"}
        >
          {category.hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button type="button" className="icon-button" onClick={onEdit} aria-label={`Edit details of ${category.title}`} title="Edit details">
          <PencilIcon />
        </button>
        {category.photoCount === 0 && (
          <button type="button" className="icon-button" onClick={onDelete} aria-label={`Delete ${category.title}`} title="Delete">
            <TrashIcon />
          </button>
        )}
      </div>
    </li>
  );
}

export function CategoriesScreen({ api }: { api: Api }) {
  const { categories, problem: libraryProblem, reload, setCategories } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const { problem, run } = useAction();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const lastReorder = useRef(0);
  useTitle();

  useEffect(() => {
    void reload();
  }, [reload]);

  // The new order appears at once, before the server has been asked. Moves
  // made in quick succession are sent one after another; only the answer to
  // the latest one is put on screen. If the server refuses, the order that
  // was there before comes back and the list is then fetched afresh.
  const reorder = (ids: string[]) => {
    const mine = (lastReorder.current += 1);
    const before = categories?.map((category) => category.id) ?? [];
    const inOrder = (order: string[]) => (list: CategoryOut[] | null) =>
      list && [...order.flatMap((id) => list.find((category) => category.id === id) ?? []), ...list.filter((category) => !order.includes(category.id))];
    setCategories(inOrder(ids));
    return run(async () => {
      try {
        const list = await api.orderCategories(ids);
        if (mine === lastReorder.current) setCategories(list);
      } catch (error) {
        if (mine === lastReorder.current) {
          setCategories(inOrder(before));
          await reload();
        }
        throw error;
      }
    });
  };

  const toggle = (category: CategoryOut) =>
    run(async () => {
      const updated = await api.updateCategory(category.id, { hidden: !category.hidden });
      setCategories((list) => list?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
      setNotice(updated.hidden ? `${updated.title} is now hidden from the site.` : `${updated.title} is no longer hidden.`);
    });

  const remove = (category: CategoryOut) =>
    run(async () => {
      if (!window.confirm(`Delete the category "${category.title}"?`)) return;
      await api.deleteCategory(category.id);
      setCategories((list) => list?.filter((item) => item.id !== category.id) ?? null);
      setNotice(`${category.title} was deleted.`);
      // The row that held the focus has gone.
      heading.current?.focus();
    });

  // A new category is for putting photographs in, so creating one goes
  // straight into it.
  const created = (category: CategoryOut) => {
    setCategories((list) => [...(list ?? []), category]);
    navigate(`/c/${category.id}`);
  };

  const ids = categories?.map((category) => category.id) ?? [];
  const editing = categories?.find((category) => category.id === editingId) ?? null;
  const shownProblem = problem ?? libraryProblem;

  return (
    <section className="screen">
      <div className="category-head">
        <h1 ref={heading} tabIndex={-1}>
          Library
        </h1>
        {categories && categories.length > 0 && (
          <button type="button" className="primary with-icon" onClick={() => setCreating(true)}>
            <PlusIcon />
            New category
          </button>
        )}
      </div>
      <Problem error={shownProblem} />
      {categories === null && !shownProblem && <p>Loading…</p>}

      {categories?.length === 0 && (
        <div className="panel">
          <p>No categories yet. Create one to start uploading.</p>
          <CategoryForm api={api} headingId="first-category" heading="Your first category" onDone={created} />
        </div>
      )}

      {categories && categories.length > 0 && (
        <>
          <p className="muted">
            Drag to set the order of the site's menu. A category appears on the site once it shows at least one photograph.
          </p>
          <Sortable ids={ids} layout="list" nameOf={(id) => categories.find((category) => category.id === id)?.title ?? "Category"} onReorder={reorder}>
            <ul className="rows">
              {categories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  onToggle={() => void toggle(category)}
                  onEdit={() => setEditingId(category.id)}
                  onDelete={() => void remove(category)}
                />
              ))}
            </ul>
          </Sortable>
        </>
      )}

      <p className="visually-hidden" role="status" data-notice="">
        {notice}
      </p>

      {creating && <CategoryDialog api={api} onDone={created} onClose={() => setCreating(false)} />}

      {editing && categories && (
        <CategoryDialog
          key={editing.id}
          api={api}
          category={editing}
          order={{
            index: ids.indexOf(editing.id),
            count: ids.length,
            problem,
            move: (delta) => {
              const index = ids.indexOf(editing.id);
              void reorder(arrayMove(ids, index, index + delta));
            },
          }}
          onDone={(updated) => setCategories((list) => list?.map((item) => (item.id === updated.id ? updated : item)) ?? null)}
          onClose={() => setEditingId(null)}
        />
      )}
    </section>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Api } from "../api";
import { Problem } from "../components/Problem";
import type { CategoryOut } from "../types";
import { useAction } from "../use-action";

const BLANK = { title: "", place: "", description: "" };

function status(category: CategoryOut): "Live" | "Hidden" | "Not shown" {
  if (category.hidden) return "Hidden";
  return category.live ? "Live" : "Not shown";
}

export function CategoriesScreen({ api }: { api: Api }) {
  const [categories, setCategories] = useState<CategoryOut[] | null>(null);
  const [form, setForm] = useState(BLANK);
  const { busy, problem, run } = useAction();

  useEffect(() => {
    let current = true;
    run(async () => {
      const list = await api.listCategories();
      if (current) setCategories(list);
    });
    return () => {
      current = false;
    };
  }, [api, run]);

  const move = (index: number, delta: -1 | 1) =>
    run(async () => {
      if (!categories) return;
      const ids = categories.map((category) => category.id);
      const [id] = ids.splice(index, 1);
      ids.splice(index + delta, 0, id!);
      setCategories(await api.orderCategories(ids));
    });

  const toggle = (category: CategoryOut) =>
    run(async () => {
      const updated = await api.updateCategory(category.id, { hidden: !category.hidden });
      setCategories((list) => list?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
    });

  const remove = (category: CategoryOut) =>
    run(async () => {
      if (!window.confirm(`Delete the category "${category.title}"?`)) return;
      await api.deleteCategory(category.id);
      setCategories((list) => list?.filter((item) => item.id !== category.id) ?? null);
    });

  const create = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const created = await api.createCategory(form);
      setCategories((list) => [...(list ?? []), created]);
      setForm(BLANK);
    });
  };

  return (
    <section className="screen">
      <h1>Library</h1>
      <Problem error={problem} />
      {categories === null && !problem && <p>Loading…</p>}
      {categories?.length === 0 && <p>No categories yet. Create one to start uploading.</p>}
      {categories && categories.length > 0 && (
        <ul className="rows">
          {categories.map((category, index) => (
            <li key={category.id} className="row">
              <div className="row-main">
                <Link to={`/c/${category.id}`} className="row-title">
                  {category.title}
                </Link>
                <span className="label muted">{category.place}</span>
                <span className="muted">
                  {category.photoCount} photographs, {category.selectedCount} selected
                </span>
                <span className="label status" data-status={status(category)}>
                  {status(category)}
                </span>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${category.title} up`}
                >
                  Up
                </button>
                <button
                  type="button"
                  disabled={busy || index === categories.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${category.title} down`}
                >
                  Down
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggle(category)}
                  aria-label={`${category.hidden ? "Show" : "Hide"} ${category.title}`}
                >
                  {category.hidden ? "Show" : "Hide"}
                </button>
                {category.photoCount === 0 && (
                  <button type="button" disabled={busy} onClick={() => remove(category)} aria-label={`Delete ${category.title}`}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="panel" onSubmit={create} aria-labelledby="new-category">
        <h2 id="new-category">New category</h2>
        <label>
          Title
          <input required maxLength={60} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label>
          Place
          <input required maxLength={40} value={form.place} onChange={(event) => setForm({ ...form, place: event.target.value })} />
        </label>
        <label>
          Description
          <textarea
            required
            maxLength={300}
            rows={2}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <button type="submit" disabled={busy}>
          Create
        </button>
      </form>
    </section>
  );
}

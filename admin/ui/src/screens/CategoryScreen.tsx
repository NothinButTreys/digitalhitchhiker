import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Api } from "../api";
import { PhotoEditor } from "../components/PhotoEditor";
import { Problem } from "../components/Problem";
import { UploadButton } from "../components/UploadButton";
import type { CategoryOut, PhotoOut, TextStatus } from "../types";
import { useAction } from "../use-action";

const MAX_SELECTED = 8;
const STATUS: Record<TextStatus, string> = {
  needs_text: "Needs text",
  approved: "Ready",
};

// Mounted once per category (App keys it by `categoryId`), so its state
// always starts empty for the category it shows.
export function CategoryScreen({ api, categoryId }: { api: Api; categoryId: string }) {
  const [categories, setCategories] = useState<CategoryOut[] | null>(null);
  const [photos, setPhotos] = useState<PhotoOut[] | null>(null);
  const [editing, setEditing] = useState<PhotoOut | null>(null);
  const { busy, problem, run } = useAction();
  const shownHeadingRef = useRef<HTMLHeadingElement>(null);
  const restHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterClose = useRef<HTMLElement | null>(null);

  const category = categories?.find((candidate) => candidate.id === categoryId) ?? null;

  useEffect(() => {
    let current = true;
    run(async () => {
      const list = await api.listCategories();
      if (!current) return;
      setCategories(list);
      if (list.some((candidate) => candidate.id === categoryId)) {
        const loaded = await api.listPhotos(categoryId);
        if (current) setPhotos(loaded);
      }
    });
    return () => {
      current = false;
    };
  }, [api, categoryId, run]);

  const setSelected = (photo: PhotoOut, selected: boolean) =>
    run(async () => {
      await api.setSelected(photo.id, selected);
      setPhotos(await api.listPhotos(categoryId));
    });

  if (categories && !category) {
    return (
      <section className="screen">
        <p>No such category.</p>
        <Link to="/">Back to the library</Link>
      </section>
    );
  }

  const shown = photos?.filter((photo) => photo.selected) ?? [];
  const rest = photos?.filter((photo) => !photo.selected) ?? [];
  const full = shown.length >= MAX_SELECTED;

  // Untitled photographs never carry a title, so several appear as "Untitled" on
  // one screen; number their Edit buttons (1-based, in the order shown here) so
  // each has a unique, useful accessible name without changing the visible label.
  let untitledSeen = 0;

  const move = (index: number, delta: -1 | 1) =>
    run(async () => {
      const ids = shown.map((photo) => photo.id);
      const [id] = ids.splice(index, 1);
      ids.splice(index + delta, 0, id!);
      setPhotos(await api.orderSelection(categoryId, ids));
    });

  return (
    <section className="screen">
      <p>
        <Link to="/">Back to the library</Link>
      </p>
      <Problem error={problem} />
      {!category || photos === null ? (
        !problem && <p>Loading…</p>
      ) : (
        <>
          <div className="row-main">
            <h1>{category.title}</h1>
            <span className="label muted">{category.place}</span>
          </div>
          <p className="muted">
            {shown.length} of {MAX_SELECTED} selected. Aim for about six.
          </p>

          <UploadButton
            api={api}
            categoryId={categoryId}
            onUploaded={(uploaded) =>
              setPhotos((list) => {
                const others = (list ?? []).filter((photo) => photo.id !== uploaded.id);
                const shownNow = others.filter((photo) => photo.selected);
                const restNow = others.filter((photo) => !photo.selected);
                return [...shownNow, uploaded, ...restNow];
              })
            }
          />

          <section aria-labelledby="shown-heading" className="group">
            <h2 id="shown-heading" ref={shownHeadingRef} tabIndex={-1}>
              Shown on the site
            </h2>
            {shown.length === 0 && <p className="muted">Nothing selected. This category is not on the site.</p>}
            <ul className="tiles">
              {shown.map((photo, index) => (
                <li key={photo.id} className="tile">
                  <img src={photo.previewUrl} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" />
                  <p>{photo.title}</p>
                  <div className="row-actions">
                    <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${photo.title} earlier`}>
                      Earlier
                    </button>
                    <button type="button" disabled={busy || index === shown.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${photo.title} later`}>
                      Later
                    </button>
                    <button type="button" disabled={busy} onClick={() => setEditing(photo)} aria-label={`Edit ${photo.title}`}>
                      Edit
                    </button>
                    <button type="button" disabled={busy} onClick={() => setSelected(photo, false)} aria-label={`Remove ${photo.title} from the site`}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="rest-heading" className="group">
            <h2 id="rest-heading" ref={restHeadingRef} tabIndex={-1}>
              Not shown
            </h2>
            {full && rest.length > 0 && <p className="muted">Eight are selected. Remove one to add another.</p>}
            {rest.length === 0 && <p className="muted">No other photographs in this category.</p>}
            <ul className="tiles">
              {rest.map((photo) => {
                const name = photo.title || "Untitled";
                let editLabel = `Edit ${name}`;
                if (!photo.title) {
                  untitledSeen += 1;
                  editLabel = `Edit Untitled photograph ${untitledSeen}`;
                }
                return (
                  <li key={photo.id} className="tile">
                    <img src={photo.previewUrl} alt={photo.alt || "Untitled photograph"} width={photo.width} height={photo.height} loading="lazy" />
                    <p>{name}</p>
                    <p className="label muted">{STATUS[photo.textStatus]}</p>
                    <div className="row-actions">
                      <button type="button" disabled={busy} onClick={() => setEditing(photo)} aria-label={editLabel}>
                        Edit
                      </button>
                      {photo.textStatus === "approved" && (
                        <button type="button" disabled={busy || full} onClick={() => setSelected(photo, true)} aria-label={`Show ${photo.title} on the site`}>
                          Show
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {editing && categories && (
        <PhotoEditor
          key={editing.id}
          api={api}
          photo={editing}
          categories={categories}
          onChange={(changed) => setPhotos((list) => list?.map((photo) => (photo.id === changed.id ? changed : photo)) ?? null)}
          onRemoved={(id) =>
            setPhotos((list) => {
              const removed = list?.find((photo) => photo.id === id);
              focusAfterClose.current = (removed?.selected ? shownHeadingRef.current : restHeadingRef.current) ?? null;
              return list?.filter((photo) => photo.id !== id) ?? null;
            })
          }
          onClose={() => {
            setEditing(null);
            const target = focusAfterClose.current;
            focusAfterClose.current = null;
            target?.focus();
          }}
        />
      )}
    </section>
  );
}

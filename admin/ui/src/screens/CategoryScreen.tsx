import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Api } from "../api";
import { CategoryDialog } from "../components/CategoryDialog";
import { EyeIcon, EyeOffIcon, PencilIcon } from "../components/icons";
import { PhotoEditor } from "../components/PhotoEditor";
import { PhotoTile, SortablePhotoTile } from "../components/PhotoTile";
import { Problem } from "../components/Problem";
import { Sortable, arrayMove } from "../components/Sortable";
import { UploadButton } from "../components/UploadButton";
import { useLibrary } from "../library";
import { photographs } from "../text";
import type { PhotoOut } from "../types";
import { useAction } from "../use-action";
import { useTitle } from "../use-title";

/** The most recently added of these photographs. */
function newest(list: PhotoOut[]): PhotoOut | undefined {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
}

/**
 * True when the keyboard's focus is nowhere useful: on nothing, on something
 * that has left the page, or inside a dialog that has closed. Focus is only
 * ever moved for the owner when this is so; where the editor is a panel
 * beside the photographs they may be typing in it while a change made on a
 * tile settles, and must not have focus taken from under them.
 */
function focusLost(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) return true;
  const dialog = active.closest("dialog");
  return dialog !== null && !dialog.hasAttribute("open");
}

/** The shown photographs in the given order, then everything else as it was. */
function inOrder(list: PhotoOut[], ids: string[]): PhotoOut[] {
  const byId = new Map(list.map((photo) => [photo.id, photo]));
  const ordered = ids.flatMap((id) => byId.get(id) ?? []);
  return [...ordered, ...list.filter((photo) => !ids.includes(photo.id))];
}

// Mounted once per category (App keys it by `categoryId`), so its state
// always starts empty for the category it shows.
export function CategoryScreen({ api, categoryId }: { api: Api; categoryId: string }) {
  const { categories, problem: libraryProblem, reload, setCategories } = useLibrary();
  const [photos, setPhotos] = useState<PhotoOut[] | null>(null);
  // A snapshot of the photograph being edited is kept so the editor stays
  // mounted, and can close itself properly, after the photograph has left
  // the list (moved to another category, or deleted).
  const [editing, setEditing] = useState<{ photo: PhotoOut; intent?: "show" } | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [notice, setNotice] = useState("");
  const { busy, problem, run } = useAction();
  const tilesRef = useRef<HTMLDivElement>(null);
  const shownHeadingRef = useRef<HTMLHeadingElement>(null);
  const restHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterClose = useRef<HTMLElement | null>(null);
  const showAfterClose = useRef<PhotoOut | null>(null);
  const focusTick = useRef<string | null>(null);
  // True while the open editor holds text that has not been saved, and while
  // something it started (a save, a move, a delete) is still on its way.
  const editorDirty = useRef(false);
  const editorBusy = useRef(false);
  // Photographs uploaded here that no list from the server has included yet.
  const justUploaded = useRef(new Set<string>());
  const lastReorder = useRef(0);

  const category = categories?.find((candidate) => candidate.id === categoryId) ?? null;
  const known = category !== null;
  useTitle(category?.title);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!known) return;
    let current = true;
    run(async () => {
      const loaded = await api.listPhotos(categoryId);
      if (current) setPhotos(loaded);
    });
    return () => {
      current = false;
    };
  }, [api, categoryId, known, run]);

  // Ticking a photograph moves its tile to the other group, which would
  // leave the keyboard's focus nowhere. Once the change has settled (the
  // controls are disabled while it is being saved, and a disabled control
  // cannot take focus), focus goes back to the same photograph's tick.
  useEffect(() => {
    const id = focusTick.current;
    if (!id || busy) return;
    focusTick.current = null;
    if (!focusLost()) return;
    const tile = [...(tilesRef.current?.querySelectorAll<HTMLElement>("[data-photo-id]") ?? [])].find(
      (element) => element.dataset.photoId === id,
    );
    tile?.querySelector<HTMLElement>('[data-control="tick"]')?.focus();
  }, [photos, busy]);

  // Where the editor is a panel beside the photographs, the rest of the page
  // stays in use, links included. Following one would leave this screen and
  // throw away text that was typed and not saved, so that is asked about
  // first, here and when the window itself is closed or reloaded.
  useEffect(() => {
    const guard = (event: MouseEvent) => {
      if (!editorDirty.current && !editorBusy.current) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.getAttribute("target") === "_blank") return;
      const stay = editorBusy.current || !window.confirm("Leave this page without saving what you typed?");
      if (!stay) return;
      event.preventDefault();
      event.stopPropagation();
      if (editorBusy.current) setNotice("Wait for the change being saved to finish.");
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (editorDirty.current) event.preventDefault();
    };
    document.addEventListener("click", guard, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("click", guard, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);

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
  // Until the photographs have loaded, the library's own word on whether the
  // category is on the site stands in for counting them.
  const onSite = photos ? shown.length > 0 : (category?.live ?? false);
  const status = category?.hidden ? "Hidden" : onSite ? "Live" : "Not shown";
  const total = photos ? photos.length : (category?.photoCount ?? 0);
  // A category's cover is the first photograph it shows, or its newest when
  // it shows none: the library's own rule. Once the photographs are here the
  // cover is worked out from them, so it keeps up with every change at once.
  const coverUrl = photos ? ((shown[0] ?? newest(rest))?.previewUrl ?? null) : (category?.coverUrl ?? null);
  // The navigation shows each category's cover and counts, which the library
  // holds; after a change here they are fetched again.
  const refreshLibrary = () => void reload();

  // Untitled photographs never carry a title, so several appear on one
  // screen; numbering them (1-based, in the order shown here) gives each of
  // their controls a unique, useful name.
  let untitledSeen = 0;
  const names = new Map<string, string>();
  for (const photo of [...shown, ...rest]) {
    if (photo.title) names.set(photo.id, photo.title);
    else names.set(photo.id, `Untitled photograph ${(untitledSeen += 1)}`);
  }
  const nameOf = (id: string) => names.get(id) ?? "Untitled photograph";

  // A list from the server replaces what is on screen, with one exception:
  // an upload can finish while the request for that list is on its way, and
  // the list then does not know the new photograph yet. Such photographs are
  // kept, ahead of the other unshown ones, until a list includes them.
  const showServerList = (list: PhotoOut[]) =>
    setPhotos((current) => {
      const listed = new Set(list.map((photo) => photo.id));
      for (const id of [...justUploaded.current]) if (listed.has(id)) justUploaded.current.delete(id);
      const unlisted = (current ?? []).filter((photo) => justUploaded.current.has(photo.id) && !listed.has(photo.id));
      if (unlisted.length === 0) return list;
      return [...list.filter((photo) => photo.selected), ...unlisted, ...list.filter((photo) => !photo.selected)];
    });

  const findTile = (id: string) =>
    [...(tilesRef.current?.querySelectorAll<HTMLElement>("[data-photo-id]") ?? [])].find((element) => element.dataset.photoId === id);

  const openEditor = (photo: PhotoOut, intent?: "show") => {
    // Where the editor is a panel beside the photographs, another photograph
    // can be asked for while it is open.
    if (editing) {
      // Not while it is saving: what happens next is never decided by an
      // editor that has gone.
      if (editorBusy.current) {
        setNotice(`Wait for ${nameOf(editing.photo.id)} to finish saving.`);
        return;
      }
      // The photograph that is already open: its panel is where to be. Asked
      // for by its tick, it is now open in order to be shown.
      if (editing.photo.id === photo.id) {
        if (intent === "show" && editing.intent !== "show") setEditing({ photo: editing.photo, intent });
        document.querySelector<HTMLElement>("dialog.editor[open] input")?.focus();
        return;
      }
      // Text typed and not saved is not thrown away without asking.
      if (editorDirty.current && !window.confirm(`Leave ${nameOf(editing.photo.id)} without saving what you typed?`)) return;
    }
    editorDirty.current = false;
    // Nothing left over from an earlier editor may act on this one's close.
    focusAfterClose.current = null;
    showAfterClose.current = null;
    setEditing({ photo, intent });
  };

  const setSelected = (photo: PhotoOut, selected: boolean) =>
    run(async () => {
      // Set before the request, so focus returns to the tick whether the
      // change is accepted or refused.
      focusTick.current = photo.id;
      await api.setSelected(photo.id, selected);
      showServerList(await api.listPhotos(categoryId));
      refreshLibrary();
      const name = photo.title || "The photograph";
      setNotice(selected ? `${name} is now shown on the site.` : `${name} is no longer shown on the site.`);
    });

  const toggle = (photo: PhotoOut) => {
    // Showing a photograph that has no text yet opens the editor instead;
    // saving there carries on and shows it.
    if (!photo.selected && photo.textStatus !== "approved") openEditor(photo, "show");
    else void setSelected(photo, !photo.selected);
  };

  // The new order appears at once, before the server has been asked. Moves
  // made in quick succession are sent one after another; only the answer to
  // the latest one is put on screen, so an earlier answer never drags the
  // order back for a moment. If the server refuses, the order that was there
  // before comes back (only the order: an upload that finished meanwhile
  // stays), and the server is then asked what it actually holds.
  const reorder = (ids: string[]) => {
    const mine = (lastReorder.current += 1);
    const before = shown.map((photo) => photo.id);
    setPhotos((list) => list && inOrder(list, ids));
    return run(async () => {
      try {
        const list = await api.orderSelection(categoryId, ids);
        if (mine === lastReorder.current) showServerList(list);
        refreshLibrary();
      } catch (error) {
        if (mine === lastReorder.current) {
          setPhotos((list) => list && inOrder(list, before));
          await api.listPhotos(categoryId).then(showServerList, () => undefined);
        }
        throw error;
      }
    });
  };

  const step = (photo: PhotoOut, delta: -1 | 1) => {
    const ids = shown.map((item) => item.id);
    const index = ids.indexOf(photo.id);
    return reorder(arrayMove(ids, index, index + delta));
  };

  const remove = (photo: PhotoOut) => {
    const open = editing?.photo.id === photo.id;
    // Its own editor is in the middle of saving it: one thing at a time.
    if (open && editorBusy.current) {
      setNotice(`Wait for ${nameOf(photo.id)} to finish saving.`);
      return Promise.resolve();
    }
    return run(async () => {
      const name = nameOf(photo.id);
      if (!window.confirm(`Delete ${name} from the library? This cannot be undone.`)) return;
      await api.deletePhoto(photo.id);
      // Focus that sits on the tile, or in its editor, is about to have
      // nowhere to be; it goes to the heading of the group the tile was in.
      const active = document.activeElement;
      const going =
        active?.closest<HTMLElement>("[data-photo-id]")?.dataset.photoId === photo.id || (open && active?.closest("dialog.editor") != null);
      // Its editor, if that is what is open, has nothing left to edit.
      if (open) {
        editorDirty.current = false;
        setEditing((current) => (current?.photo.id === photo.id ? null : current));
      }
      justUploaded.current.delete(photo.id);
      setPhotos((list) => list?.filter((item) => item.id !== photo.id) ?? null);
      refreshLibrary();
      setNotice(`${name} was deleted.`);
      if (going || focusLost()) (photo.selected ? shownHeadingRef : restHeadingRef).current?.focus();
    });
  };

  const toggleHidden = () =>
    run(async () => {
      if (!category) return;
      const updated = await api.updateCategory(category.id, { hidden: !category.hidden });
      setCategories((list) => list?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
      setNotice(updated.hidden ? `${updated.title} is now hidden from the site.` : `${updated.title} is no longer hidden.`);
    });

  const tileProps = (photo: PhotoOut) => ({
    photo,
    name: nameOf(photo.id),
    editing: editing?.photo.id === photo.id,
    onToggle: () => toggle(photo),
    onEdit: () => openEditor(photo),
    onDelete: () => void remove(photo),
  });

  const editingPhoto = editing ? (photos?.find((photo) => photo.id === editing.photo.id) ?? editing.photo) : null;
  const editingIndex = editingPhoto ? shown.findIndex((photo) => photo.id === editingPhoto.id) : -1;

  return (
    <section className="screen">
      <Problem error={problem ?? libraryProblem} />
      {!category ? (
        !(problem ?? libraryProblem) && <p>Loading…</p>
      ) : (
        <>
          {/* The category's cover fills the header; it is decoration, so it
              has no name of its own. The heading comes first for a screen
              reader, which arrives on it; the place is lifted above it for
              the eye. */}
          <div className="hero" data-cover={coverUrl ? "" : undefined}>
            {coverUrl && <img className="hero-cover" src={coverUrl} alt="" draggable={false} />}
            <div className="hero-body">
              <div className="hero-text">
                <h1 tabIndex={-1}>{category.title}</h1>
                <span className="label hero-place">{category.place}</span>
                <p className="hero-stats">
                  <span>{photographs(total)}</span>
                  {photos !== null && (
                    <span className="count">
                      {shown.length > 0 && (
                        <span className="meter" aria-hidden="true">
                          {shown.map((photo) => (
                            <span key={photo.id} />
                          ))}
                        </span>
                      )}
                      {shown.length} shown
                    </span>
                  )}
                  <span className="status" data-status={status}>
                    {status}
                  </span>
                </p>
              </div>
              <div className="category-tools">
                <button type="button" className="icon-button" aria-label="Edit category details" title="Edit details" onClick={() => setEditingDetails(true)}>
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={category.hidden ? "Show this category on the site" : "Hide this category from the site"}
                  title={category.hidden ? "Hidden. Press to show it on the site." : "Hide from the site"}
                  onClick={toggleHidden}
                >
                  {category.hidden ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
          </div>

          {photos === null ? (
            !problem && <p>Loading…</p>
          ) : (
            <div className="screen" ref={tilesRef}>
              <UploadButton
                api={api}
                categoryId={categoryId}
                onUploaded={(uploaded) => {
                  refreshLibrary();
                  justUploaded.current.add(uploaded.id);
                  setPhotos((list) => {
                    const others = (list ?? []).filter((photo) => photo.id !== uploaded.id);
                    const shownNow = others.filter((photo) => photo.selected);
                    const restNow = others.filter((photo) => !photo.selected);
                    return [...shownNow, uploaded, ...restNow];
                  });
                }}
              />

              <section aria-labelledby="shown-heading" className="group">
                <div className="group-head">
                  <h2 id="shown-heading" ref={shownHeadingRef} tabIndex={-1}>
                    Shown on the site
                  </h2>
                  {shown.length > 1 && <p className="muted">Drag left or right to set the order. The first photograph opens the set.</p>}
                </div>
                {shown.length === 0 && (
                  <p className="muted">Nothing shown yet, so this category is not on the site. Tick a photograph below to show it.</p>
                )}
                <Sortable ids={shown.map((photo) => photo.id)} layout="strip" nameOf={nameOf} onReorder={reorder}>
                  <ul className="tiles strip">
                    {shown.map((photo, index) => (
                      <SortablePhotoTile key={photo.id} number={index + 1} {...tileProps(photo)} />
                    ))}
                  </ul>
                </Sortable>
              </section>

              <section aria-labelledby="rest-heading" className="group">
                <div className="group-head">
                  <h2 id="rest-heading" ref={restHeadingRef} tabIndex={-1}>
                    Not shown
                  </h2>
                </div>
                {rest.length === 0 && (
                  <p className="muted">{shown.length === 0 ? "No photographs yet. Add some above." : "No other photographs in this category."}</p>
                )}
                <ul className="tiles">
                  {rest.map((photo) => (
                    <PhotoTile key={photo.id} {...tileProps(photo)} />
                  ))}
                </ul>
              </section>
            </div>
          )}

          <p className="visually-hidden" role="status" data-notice="">
            {notice}
          </p>
        </>
      )}

      {editingPhoto && editing && categories && (
        <PhotoEditor
          key={editingPhoto.id}
          api={api}
          photo={editingPhoto}
          categories={categories}
          intent={editing.intent}
          order={
            editingIndex >= 0
              ? { index: editingIndex, count: shown.length, problem, move: (delta) => void step(editingPhoto, delta) }
              : undefined
          }
          onChange={(changed, { andShow }) => {
            setPhotos((list) => list?.map((photo) => (photo.id === changed.id ? changed : photo)) ?? null);
            if (andShow) showAfterClose.current = changed;
          }}
          onRemoved={(id, how) => {
            // The tile that opened the editor is about to go, so focus will
            // return to the heading of the group it was in.
            focusAfterClose.current = (editingPhoto.selected ? shownHeadingRef.current : restHeadingRef.current) ?? null;
            justUploaded.current.delete(id);
            setPhotos((list) => list?.filter((photo) => photo.id !== id) ?? null);
            refreshLibrary();
            setNotice(`${nameOf(id)} was ${how === "deleted" ? "deleted" : "moved to another category"}.`);
          }}
          onDirty={(dirty) => {
            editorDirty.current = dirty;
          }}
          onBusy={(working) => {
            editorBusy.current = working;
          }}
          onClose={() => {
            editorDirty.current = false;
            editorBusy.current = false;
            setEditing(null);
            const target = focusAfterClose.current;
            focusAfterClose.current = null;
            if (target) target.focus();
            // Whatever opened the editor may be gone by now (ticking a
            // photograph while its panel is open moves its tile to the other
            // group). Focus then goes to the photograph's Edit control where
            // it now is, or failing that to the heading of its group.
            else if (focusLost()) {
              const edit = findTile(editingPhoto.id)?.querySelector<HTMLElement>('[data-control="edit"]');
              (edit ?? (editingPhoto.selected ? shownHeadingRef.current : restHeadingRef.current))?.focus();
            }
            const toShow = showAfterClose.current;
            showAfterClose.current = null;
            if (toShow) void setSelected(toShow, true);
          }}
        />
      )}

      {editingDetails && category && (
        <CategoryDialog
          api={api}
          category={category}
          onDone={(updated) => setCategories((list) => list?.map((item) => (item.id === updated.id ? updated : item)) ?? null)}
          onClose={() => setEditingDetails(false)}
        />
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import type { Api } from "./api";
import { CategoryDialog } from "./components/CategoryDialog";
import { PlusIcon } from "./components/icons";
import { Mark } from "./components/Mark";
import { PublishPanel } from "./components/PublishPanel";
import { LibraryProvider, useLibrary } from "./library";
import { CategoriesScreen } from "./screens/CategoriesScreen";
import { CategoryScreen } from "./screens/CategoryScreen";

// Keyed by the category, so moving to another category starts a fresh screen
// rather than showing the previous category's state while the next one loads.
function CategoryRoute({ api }: { api: Api }) {
  const { categoryId = "" } = useParams();
  return <CategoryScreen key={categoryId} api={api} categoryId={categoryId} />;
}

/**
 * Every category, one tap away from anywhere, plus a way to start a new one.
 * It appears once there is at least one category to go to.
 */
function CategoryNav({ api }: { api: Api }) {
  const { categories, setCategories } = useLibrary();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  if (!categories || categories.length === 0) return null;

  return (
    <nav className="category-nav" aria-label="Categories">
      <ul>
        <li>
          <NavLink to="/" end>
            All
          </NavLink>
        </li>
        {categories.map((category) => (
          <li key={category.id}>
            <NavLink to={`/c/${category.id}`} data-hidden={category.hidden ? "" : undefined}>
              {category.title}
              {category.hidden && <span className="visually-hidden"> (hidden)</span>}
            </NavLink>
          </li>
        ))}
        <li>
          <button type="button" className="icon-button" aria-label="New category" title="New category" onClick={() => setCreating(true)}>
            <PlusIcon />
          </button>
        </li>
      </ul>
      {creating && (
        <CategoryDialog
          api={api}
          onDone={(category) => {
            setCategories((list) => [...(list ?? []), category]);
            navigate(`/c/${category.id}`);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </nav>
  );
}

/**
 * Moving to another screen puts focus on that screen's heading, so a screen
 * reader says where it has arrived and the keyboard carries on from the top
 * of the new screen rather than from a control that is no longer there.
 * Not on first load: the browser's own start of the page is right then.
 */
function useFocusOnNavigation() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [pathname]);
}

export function App({ api }: { api: Api }) {
  useFocusOnNavigation();
  return (
    <LibraryProvider api={api}>
      <div className="page">
        <header className="site-header">
          <Link to="/" className="label wordmark">
            <Mark />
            Digital Hitchhiker · Library
          </Link>
          <PublishPanel api={api} />
        </header>
        <CategoryNav api={api} />
        <main>
          <Routes>
            <Route path="/" element={<CategoriesScreen api={api} />} />
            <Route path="/c/:categoryId" element={<CategoryRoute api={api} />} />
            <Route
              path="*"
              element={
                <p>
                  Nothing here. <Link to="/">Back to the library</Link>
                </p>
              }
            />
          </Routes>
        </main>
      </div>
    </LibraryProvider>
  );
}

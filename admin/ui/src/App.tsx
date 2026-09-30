import { Link, Route, Routes, useParams } from "react-router";
import type { Api } from "./api";
import { CategoriesScreen } from "./screens/CategoriesScreen";
import { CategoryScreen } from "./screens/CategoryScreen";

// Keyed by the category, so moving to another category starts a fresh screen
// rather than showing the previous category's state while the next one loads.
function CategoryRoute({ api }: { api: Api }) {
  const { categoryId = "" } = useParams();
  return <CategoryScreen key={categoryId} api={api} categoryId={categoryId} />;
}

export function App({ api }: { api: Api }) {
  return (
    <div className="page">
      <header className="site-header">
        <Link to="/" className="label wordmark">
          Digital Hitchhiker · Library
        </Link>
      </header>
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
  );
}

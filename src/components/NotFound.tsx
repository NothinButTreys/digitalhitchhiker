import { Link } from "react-router";
import type { PhotoSet } from "../data/catalog";
import { setPath } from "../lib/routes";

export function NotFound({ first }: { first: PhotoSet | undefined }) {
  return (
    <article className="prose">
      <h1>Not found</h1>
      <p>There is no page at this address.</p>
      {first && (
        <p>
          <Link to={setPath(first)}>See the photographs</Link>
        </p>
      )}
    </article>
  );
}

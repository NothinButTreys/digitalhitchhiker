import { SITE } from "../data/site";

export function Colophon() {
  return (
    <article className="prose">
      <h1>Colophon</h1>
      <p>
        {SITE.name} is a collection of photographs made on the road, mostly in Arizona. The
        pictures are the point; everything else has been kept out of their way.
      </p>
      <p>
        To get in touch, write to <a href={`mailto:${SITE.email}`}>{SITE.email}</a> or find the
        work on{" "}
        <a href={SITE.instagram} rel="noreferrer">
          Instagram
        </a>
        .
      </p>
    </article>
  );
}

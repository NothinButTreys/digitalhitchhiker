import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { App } from "./App";
import { catalog } from "./data";
import { headFor, renderHead } from "./lib/head";
import { allPaths, resolve } from "./lib/routes";
import { robotsTxt, sitemapXml } from "./lib/sitemap";

export type OutputFile = { file: string; body: string };

function page(template: string, path: string, file: string): OutputFile {
  const app = renderToString(
    <StaticRouter location={path}>
      <App />
    </StaticRouter>,
  );
  const head = renderHead(headFor(resolve(catalog, path)));
  return { file, body: template.replace("<!--head-->", head).replace("<!--app-->", app) };
}

export function pages(template: string): OutputFile[] {
  const routes = allPaths(catalog).map((path) =>
    page(template, path, path === "/" ? "index.html" : `${path.slice(1)}/index.html`),
  );
  return [...routes, page(template, "/404", "404.html")];
}

export function extras(): OutputFile[] {
  return [
    { file: "sitemap.xml", body: sitemapXml(allPaths(catalog)) },
    { file: "robots.txt", body: robotsTxt() },
  ];
}

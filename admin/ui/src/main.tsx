import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { createApi } from "./api";
import { App } from "./App";
import { rememberDevEmail } from "./dev-identity";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// A dev identity only in a build made with `--mode devbuild` (`npm run
// build:ui:dev`). The build mode is set on the command line, never by an
// environment variable, so no `ui/.env` file — however it sets
// VITE_DEV_BUILD or NODE_ENV — can open this gate in a production build:
// `import.meta.env.MODE` there is always "production", a constant the
// bundler can fold away, dropping VITE_DEV_EMAIL from the bundle too.
const devEmail = import.meta.env.MODE === "devbuild" ? import.meta.env.VITE_DEV_EMAIL : undefined;
if (devEmail) rememberDevEmail(devEmail);

const api = createApi(fetch.bind(window), devEmail);

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App api={api} />
    </BrowserRouter>
  </StrictMode>,
);

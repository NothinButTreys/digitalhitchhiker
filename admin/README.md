# Library admin

A private admin for the site's photographs, running on Cloudflare: a Worker
(Hono) with a D1 database and an R2 bucket, and screens built with React.

## Commands

Run these from `admin/`.

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply digital-hitchhiker --local
npm run dev            # builds the screens for development, then http://localhost:8787
npm test               # Worker tests
npm run test:ui        # screen and component tests
npm run test:e2e       # browser tests; run `npx playwright install chromium` once first
npm run typecheck
npm run build:ui       # production build of the screens
npm run deploy         # builds the screens and deploys the Worker
```

Never run `wrangler dev --remote`. It runs against the real database and
bucket, not local copies.

## The screens

The header lists every category, so any of them is one press away from
anywhere, and a plus button there starts a new one. Creating a category
goes straight into it.

Inside a category each photograph is a tile that is only the image until it
is pointed at or focused, when its controls appear over it: a tick (shown on
the site or not), a pencil (edit), and a trash can (delete). On a touch screen,
where nothing can be pointed at, the tick always shows and tapping the image
opens the editor, which holds everything else.

Shown photographs, and the categories on the Library screen, are put in
order by dragging (`ui/src/components/Sortable.tsx`, built on dnd-kit):
with a mouse, with a finger after pressing and holding, or with the keyboard
from each item's handle (Space, arrow keys, Space). Every move is read out
to screen readers. The same moves are also offered as plain buttons in the
photograph editor and the category details dialog, for anyone who cannot or
would rather not drag.

## Signing in locally

Locally there is no Cloudflare Access. `.dev.vars` sets `AUTH_MODE=dev` and
`ENVIRONMENT=development`, and in that mode only, the Worker accepts the
owner's address from the `x-dev-email` header, or from a cookie named
`dh-dev-email` when the header is absent. The header wins when both are
present. `AUTH_MODE=dev` has no effect unless `ENVIRONMENT` is `development`
or `test`, and in `access` mode the header and the cookie are both ignored.
In development mode the Worker also accepts the identity from a
`dh-dev-email` cookie so that thumbnails load; any page served from
`localhost` could set that cookie, so run the dev server only while you are
using it.

`npm run dev` builds the screens with `npm run build:ui:dev`, which builds
with `--mode devbuild` and `VITE_DEV_EMAIL=owner@example.com`. Such a build
sends that address in the header on every API request and stores it in the
cookie, so that preview images (plain `<img>` requests, which cannot carry a
header) load too. The address must match `OWNER_EMAIL` in `.dev.vars`.
`npm run dev` leaves a development bundle in `dist/`; always deploy with
`npm run deploy`, which rebuilds it.

`npm run build:ui` and `npm run deploy` build in the default mode, which
never embeds a dev identity. The build mode is set only on the command
line, so no `.env` file under `ui/` can open the gate in a production
build, whatever it sets `VITE_DEV_EMAIL` or `NODE_ENV` to.

## Identity settings

These four are Worker secrets, not entries in `wrangler.jsonc`:

| Name | What it is |
|---|---|
| `OWNER_EMAIL` | The one address allowed to use the admin |
| `ACCESS_TEAM_DOMAIN` | The Cloudflare Access team domain, `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | The Access application's audience (AUD) tag |
| `SERVICE_TOKEN_CLIENT_ID` | The client ID of an Access service token allowed to call the API, if any |

Set each one, typing the value at the prompt:

```bash
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
npx wrangler secret put SERVICE_TOKEN_CLIENT_ID
```

Do not add them to `vars` in `wrangler.jsonc`: a var and a secret share one
name, so a var there would overwrite the secret on every deploy. Until they
are set, the Worker treats each as empty and refuses every request.

## Storage

Categories and photograph records live in the D1 database
`digital-hitchhiker`; original files and previews live in the private R2
bucket `digital-hitchhiker-library`.

R2's free tier is 10 GB, roughly 500 to 2,000 full-quality originals;
enabling R2 requires a payment method on the account even for free use.

## Node

Node 20.19 or newer is required. Some nested packages warn that they want
Node 22; those warnings are expected and do not stop anything. The `overrides` entry in
`package.json` pins `workerd` so the local tools (`wrangler dev` and the
tests) match the Worker's compatibility date; it does not affect deployment.

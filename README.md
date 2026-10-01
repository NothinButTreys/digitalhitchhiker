# Digital Hitchhiker

Static photography portfolio at https://digitalhitchhiker.photography.

## Commands

```bash
npm install
npm run dev          # local development at http://localhost:5173
npm run build        # typecheck, build, and prerender into dist/
npm run preview      # serve dist/ at http://localhost:4173
npm test             # unit and component tests
npm run test:build   # checks on the prerendered HTML (run after build)
npm run test:e2e     # browser and accessibility tests (run after build)
```

`npm run test:e2e` starts its own server on port 4173 and needs a build
first (`npm run build`). It also needs a Chromium browser installed once:

```bash
npx playwright install chromium
```

Browser tests run at four viewport sizes: desktop, tablet, phone, and a
phone held sideways.

## Where the photographs are

Not in this repository. The photographs, their titles and descriptions, the
categories, and their order all live in the library (`admin/`), and only
the library's owner changes them, in the admin.

A publish writes four things into a checkout of this repository and builds
the site from them: `content/sets/*.json`, `content/set-order.json`,
`src/data/manifest.json`, and `public/photos/`. None of them is committed.
A fresh clone has none of them, so `npm run dev`, `npm test`, and
`npm run build` fail until they are fetched:

    export LIBRARY_URL=...            # the admin's address
    export LIBRARY_CLIENT_ID=...      # an Access service token
    export LIBRARY_CLIENT_SECRET=...
    npm run library:pull

Each photograph is published at widths 640, 1280, 2000, 2880, and 4000 px
(never upscaled: only the widths that fit the original, plus the original's
own width when it is narrower than 4000 px). AVIF is written at every
width; JPEG only up to 2000 px, as a fallback for browsers without AVIF
support. The colour profile is kept; all other metadata, including
location, is removed. The settings are in `scripts/lib/encode.ts`.

## People in photographs

No photograph in which a child's face is recognisable is published.
Photographs showing family members or an identifiable private individual
are published only when the owner has approved that specific photograph.
Photographs awaiting approval are tracked privately, outside this repository.

## Publishing

What the site shows is decided in the library admin (`admin/`). Pressing
Publish there starts the `Publish` workflow in this repository, which:

1. fetches the list of categories and shown photographs from the admin,
2. fetches each photograph's images from the library's cache, making them
   first (with the settings in `scripts/lib/encode.ts`) for any photograph
   it has not seen before,
3. writes `content/sets/*.json`, `content/set-order.json`,
   `src/data/manifest.json`, and `public/photos/`,
4. runs the unit tests, builds, runs the build checks and the browser tests,
5. deploys to Vercel, as a preview or to the live site,
6. tells the admin how it went.

Nothing is deployed unless every check passed.

The workflow needs these repository secrets: `LIBRARY_URL`,
`LIBRARY_CLIENT_ID`, `LIBRARY_CLIENT_SECRET`, `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

To work on the site locally with the published photographs, set the three
`LIBRARY_*` values in your shell (the admin accepts one service token, so
these are the workflow's own) and run `npm run library:pull`.

## Deployment

The site is deployed only by the `Publish` workflow (see Publishing).
Pushing to this repository does not deploy anything.

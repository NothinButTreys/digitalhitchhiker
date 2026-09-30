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

## Adding or changing photographs

Originals are not in this repository. They live in
`~/Pictures/Digital Hitchhiker/Originals/<Set>/`. Set `DH_ORIGINALS` to use
another folder.

1. Put the original in the set's folder under Originals.
2. Add an entry to `content/sets/<set>.json` with `slug`, `source`, `title`,
   `alt`, and `description`. The order of entries is the order on the site.
3. Run `npm run photos`. This must run on a Mac: HEIC originals are
   converted with the macOS `sips` tool. It writes web-sized copies to
   `public/photos/<set>/` and updates `src/data/manifest.json`.
4. Run `npm test`, then commit the content file, the new files in
   `public/photos/`, and the manifest.

The build fails if a photograph has no alt text, no description, or no
generated files.

Each photograph is written at widths 640, 1280, 2000, 2880, and 4000 px
(images are never upscaled, so a photograph is only written at the target
widths that fit its original, plus the original's own width if it is
narrower than 4000 px and not already one of those). AVIF is written at
every width; JPEG is written only up to 2000 px, as a fallback for browsers
without AVIF support. The colour profile is kept; all other metadata,
including location, is stripped.

## Removing a photograph

1. Delete its entry from the set's file in `content/sets/`.
2. Run `npm run photos`.
   This also deletes every file in `public/photos/` that the manifest no
   longer accounts for, and prints each one it removes.
3. Run `npm test`, then commit the content file, the manifest, and the
   removed files.

## People in photographs

No photograph in which a child's face is recognisable is published.
Photographs showing family members or an identifiable private individual
are published only when the owner has approved that specific photograph.
Photographs awaiting approval are tracked privately, outside this repository.

## Adding a set

Create `content/sets/<slug>.json` with `slug`, `title`, `place`,
`description`, and a `photos` array, add the slug to `content/set-order.json`,
then follow the steps above for each photograph.

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
`LIBRARY_*` values in your shell and run `npm run library:pull`.

## Deployment

Vercel builds from `vercel.json`. Every push to a branch gets a preview
URL. `master` is production.

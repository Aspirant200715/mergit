# Mergit logo for the app UI (black and white)

Everything here is drawn in `currentColor`, so it takes the text colour of wherever it sits:
ink `#0E1018` on porcelain `#F4F5F7` / white, moon `#ECEEF2` on night `#0B0C0F` in dark mode.
The geometry comes from the masters in `final/` (see `final/construction.md`); nothing here is
redrawn. Every file is generated: edit `_gen/build.py`, not the outputs.

## Files

| File | What it is |
|---|---|
| `MergitLogo.tsx` | React components `MergitSymbol` and `MergitLogo` (inline SVG, no dependencies beyond React) |
| `MergitLoader.tsx` | React loading indicator: the pills slide in, grip the Ethereum symbol, hold, release (1.6 s loop) |
| `mergit-loader.svg` | The same animation as a self-contained SVG (`<img src>` or CSS background); ink, or moon in dark mode |
| `dashboard-pr4.patch` | Brand patch for PR #4 ("Porcelain"): new `BrandMark`, favicon set, manifest, head tags |
| `_gen/` | `build.sh` (rebuilds everything), `build.py` (generator), `frames.sh` (renders loader frames to check them), `tagline.svg` (outlined Onest 500 tagline) |

Plain SVG masters (already in `final/`, use these for anything that is not React):

| File | Use |
|---|---|
| `final/symbol.svg` | Symbol, 24 px and up |
| `final/symbol-small.svg` | Symbol on the 16 px pixel grid, 16 to 23 px |
| `final/wordmark.svg` | "Mergit" wordmark |
| `final/lockup-horizontal.svg` | Symbol + wordmark side by side (min 24 px tall) |
| `final/lockup-stacked.svg` | Symbol over wordmark (min 64 px tall) |
| `*-black.svg` / `*-white.svg` | Fixed `#0E1018` / `#FFFFFF` copies for places where CSS cannot set the colour |

Web icons are in `final/web/` (favicon set, app icons, avatar, `head.html`, `manifest.webmanifest`);
README headers and the share card are in `final/readme/` (`README-snippet.md` has the markup).

## Components

```tsx
import { MergitLogo, MergitSymbol } from "./MergitLogo";
import { MergitLoader } from "./MergitLoader";

// Nav: decorative symbol next to the visible word (no title, so it is aria-hidden)
<a href="/" className="brand" style={{ color: "var(--ink)" }}>
  <MergitSymbol size={32} />
  Mergit
</a>

// Standalone symbol that needs a name
<MergitSymbol size={48} title="Mergit" />

// Lockups and wordmark; height in px, width follows the artwork
<MergitLogo />                                {/* horizontal, 32 px tall, named "Mergit" */}
<MergitLogo variant="stacked" height={96} />
<MergitLogo variant="wordmark" height={24} title="" />   {/* "" = decorative */}

// Loading state (role="status", announced as "Loading")
<MergitLoader size={40} label="Loading proofs" />
```

- `MergitSymbol` props: `size` (px, default 32), `title`, `className`. Below 24 px it switches to
  the pixel-grid drawing from `symbol-small.svg`, as `construction.md` prescribes.
- `MergitLogo` props: `variant` (`"horizontal" | "stacked" | "wordmark"`, default horizontal),
  `height` (px, default 32), `title` (default `"Mergit"`; `""` hides it from screen readers), `className`.
- `MergitLoader` props: `size` (px, default 32), `label` (default `"Loading"`), `className`. The
  mark fills about 80 % of the box (the pills travel outside it), so use 32 px or more. With
  `prefers-reduced-motion: reduce` it shows the still symbol.
- Colour: set `color` on the element or a parent (`className="text-ink"`, `style={{ color: ... }}`).

The components type-check and lint clean under the dashboard's strict TypeScript and ESLint
config (React 19, `react-jsx`).

## Dashboard patch (PR #4)

What `dashboard-pr4.patch` changes in `frontend/`:

- `src/components/Icon.tsx`: `BrandMark` draws the new symbol in `currentColor`. Same `size`
  prop and `brand-mark` class; new optional `badge` prop (default `false`). Plain: the symbol in
  `var(--ink)`, so it inverts with the theme. `badge`: the old look, symbol in on-ink on an ink circle.
- `src/styles/components.css`: `.brand-mark` loses the circle; `.brand-mark-badge` adds it back.
- `public/favicon.svg`: the new icon (switches to moon in a dark browser theme).
- New: `public/favicon.ico` (16 + 32 px from the pixel-grid symbol), `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `manifest.webmanifest`.
- `index.html`: icon, apple-touch-icon and manifest links (the theme-color metas are unchanged).

Checked on the PR's working copy: `npm run lint`, `npm run format:check`, `npm run build` clean;
Playwright e2e 42 / 42 passed.

Apply it yourself (from the root of a checkout of the PR #4 branch, the folder that contains `frontend/`):

```sh
git apply --check path/to/mergit-brand-kit/04-ui/dashboard-pr4.patch
git apply path/to/mergit-brand-kit/04-ui/dashboard-pr4.patch
(cd frontend && npm run lint && npm run format:check && npm run build && npx playwright test)
git add frontend/src/components/Icon.tsx frontend/src/styles/components.css frontend/index.html \
  frontend/public/favicon.svg frontend/public/favicon.ico frontend/public/apple-touch-icon.png \
  frontend/public/icon-192.png frontend/public/icon-512.png frontend/public/icon-512-maskable.png \
  frontend/public/manifest.webmanifest
git commit -m "Use the final Mergit symbol for the brand mark and favicon set"
```

## Changing the logo

The generators were not kept. To change the logo, edit the SVG files in this kit (`01-logo/`, `02-logo-colour/`) and update the matching paths in these components and the PNG exports.

# README header snippet

Paste at the top of the repository's `README.md`. GitHub picks the image that matches the
reader's theme; `<img>` is the fallback (light) for everything else.

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/header-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/header-light.png">
    <img alt="Mergit. Pay for what you got." src="assets/header-light.png" width="640">
  </picture>
</p>
```

Paths are relative to the repository root. If the brand folder moves, change all three. The
PNGs are 1280 x 320 (shown at 640 wide, so they stay sharp on 2x screens); the `.svg` files
next to them are the sources and can be used instead of the PNGs (GitHub renders them, but
some README mirrors and package registries do not).

Files here:

| File | What |
|---|---|
| `header-light.png` / `.svg` | Horizontal lockup in ink `#0E1018` on porcelain `#F4F5F7`, tagline in `#565C6B` |
| `header-dark.png` / `.svg` | Moon `#ECEEF2` on night `#0B0C0F`, tagline in `#A1A6B2` |
| `og-mono-1200x630.png` / `.svg` | Black-and-white share card (Open Graph / Twitter): lockup on porcelain |

Share card tags for the website `<head>`:

```html
<meta property="og:image" content="https://YOUR-DOMAIN/og-mono-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

Copy `header-light.png` and `header-dark.png` into an `assets/` folder in your repo (or change the paths above).

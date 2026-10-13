# Mergit frontend

The Mergit dashboard, built from the approved Figma designs:
[Porcelain, light](https://www.figma.com/design/neI67DQPihvv95wNsatkmW) and
[Porcelain Night, dark](https://www.figma.com/design/yV9dTpC723weK7Dyqx2YYg).

Vite, React 19, TypeScript and React Router. No backend yet: every screen reads from
`src/mock/data.ts`, and no number on it is measured.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck and production build
npm run test:e2e   # Playwright; add PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome
```

## Screens

| Route | Screen |
|---|---|
| `/` | Overview |
| `/runs/:id` | Run workspace, task graph and live log |
| `/runs/new` | New run |
| `/agents` | Agents |
| `/proofs/:id` | Work proof |
| `/leaderboard` | Leaderboard |
| `/integrations` | Integrations |
| `/wallet` | Wallet and identity |
| `/signin` | Sign in |

## Light and dark

- Both palettes live in `src/styles/tokens.css` as CSS variables under `data-theme` on `<html>`.
  Components only use tokens, so a theme switch is one attribute change.
- The first visit follows the OS. Choosing a theme saves it; choosing the one the OS already uses
  clears the saved choice, so the app follows the OS again.
- An inline script in `index.html` sets the theme before first paint, so there is no flash.
- Open tabs stay in sync through the `storage` event, and the app follows OS changes live
  while no choice is saved.
- The toggle reveals the new theme in a circle from the button (View Transitions API). Browsers
  without it, and theme changes from another tab or the OS, cross-fade instead.
  `prefers-reduced-motion` switches instantly.

## Copy

The designs predate the current paper, so a few labels differ on purpose: Monad testnet and MON
became an unnamed L2 testnet and ETH, the contracts are Identity, ReceiptRegistry and
ReputationAnchor, and reputation reads as value density.

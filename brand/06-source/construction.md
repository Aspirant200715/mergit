# Mergit logo: construction

The final symbol is f-01 (two horizontal, offset, fully rounded pills that grip the official
Ethereum symbol), in one colour. Every file is built by `python3 final/_gen/build.py`
(geometry helpers in `_gen/geom.py`, `_gen/eth.py`, `_gen/mark.py`). Units below are SVG
units in the file's own viewBox.

## Symbol (`symbol.svg`, viewBox 0 0 256 256)

| Part | Value |
|---|---|
| Artwork box | 16 to 240 on both axes (224 x 224), padding 16 on every side |
| Upper pill | x 16 to 216, y 16 to 88: 200 x 72, radius 36 (fully rounded) |
| Lower pill | x 40 to 240, y 168 to 240: 200 x 72, radius 36 |
| Offset | 24 (upper pill to the left, lower to the right; point-symmetric about 128, 128) |
| Gap between the pills | 80 (y 88 to 168) |
| Ethereum symbol | official geometry (canonical SVG, viewBox 0 0 256 417), uniform scale 0.3828: 97.99 x 159.58, box x 79.01 to 176.99, y 48.21 to 207.79, centred on 128, 128 |
| Channel | 16 all round the symbol's silhouette (the hull offset by 16) |
| Channel corners | radius 16 round the symbol's top and bottom points (concentric, so the channel stays 16); radius 8 where the channel meets a pill edge |
| Pill material over the top point / under the bottom point | 16.21 / 16.21 |
| Gap between the symbol's halves | 8 (perpendicular), the official proportion |
| Ink centroid | 127.9, 127.3: 0.7 above the box centre, which is the optical lift; no further shift |

Feet (where the channel leaves a pill): the upper pill keeps a 4.83 straight run between the
radius-8 fillet and its round end; on the lower pill the symbol height is solved so the fillet
lands exactly on the apex of the round end (x 76), so the fillet and the end are one smooth
curve with no sliver of flat and no overlap. (The chevron's notch is wider than the diamond's
at the same depth, so both feet cannot have the same flat without moving the symbol off-centre.)

Drawing: one `<path fill="currentColor">` with four subpaths (two pills, the upper diamond,
the lower chevron). The symbol and the pills are the same colour; the channel alone separates
them.

## Small symbol (`symbol-small.svg`, viewBox 0 0 256 256, 16-unit grid)

16 units = 1 px at 16 px and 2 px at 32 px; every pill edge sits on a whole pixel.

| Part | Value |
|---|---|
| Upper pill | x 16 to 208, y 16 to 80: 192 x 64 (12 x 4 px at 16 px), radius 32 |
| Lower pill | x 48 to 240, y 176 to 240 |
| Offset | 32 (2 px) |
| Channel | 24 (1.5 px at 16 px, 3 px at 32 px) |
| Ethereum symbol | scale 0.3454: 88.42 x 144 (5.5 x 9 px), y 56 to 200, centred on 128 |
| Pill material over the points | 16 (exactly 1 px row at 16 px) |

The channel is wider than the master's because a 1 px diagonal gap anti-aliases to mid grey
and the symbol merges into the pills; at 1.5 px it stays visibly lighter. The halves' gap
(7.2 units, 0.45 px) closes at 16 px and shows as a grey seam; the silhouette (diamond over
chevron between two bars) still reads. At 32 px the halves' gap is open.

## Wordmark (`wordmark.svg`, viewBox 0 0 475.2 181.04)

Route E's clasp-g wordmark (Onest 600 "Mergit", tracking -0.01em), outlines unchanged.
Ink box 459.2 x 165.04, padding 8 on every side. Cap height 113.12 (cap top y 13.28,
baseline y 126.4); the i dot and t rise 5.28 above the cap top; the g descends to 173.04.

## Lockups

- **Horizontal** (`lockup-horizontal.svg`, 687.3 x 204.04): symbol 169.68 tall
  (1.5 x cap height), its centre on the middle of the cap height; gap 42.42 (0.25 x symbol
  height, 0.375 x cap) from the lower pill's round end to the M. The upper pill sits 18.2
  further back, so the measured 0.25 reads like the 0.30 starting value.
- **Stacked** (`lockup-stacked.svg`, 475.2 x 492.28): wordmark width 1.8 x symbol width
  (symbol 255.11 square); gap 56.12 (0.22 x symbol height) from the lower pill to the word's
  highest ink (i dot, t), 0.24 to the cap top; symbol centred on the word's ink box (the
  word's ink centroid is only 2.8 units right of it, so no nudge).
- Both: padding 8 inside the viewBox.

## Clear space

Clear space = the pill height on every side: **x = 72/224 of the symbol's height (0.32 S)**.
In the files: 72 units round `symbol.svg`'s artwork, 54.5 round the horizontal lockup,
82 round the stacked lockup. Nothing else (text, edges, other logos) enters that zone.

## Minimum sizes and which file to use

| Size | File |
|---|---|
| Symbol 16 to 23 px (favicon, tab, small badges) | `symbol-small.svg` |
| Symbol 24 px and up (nav 32 px badge, avatar, app icon) | `symbol.svg` (channel 1.5 px at 24 px) |
| Horizontal lockup: minimum 24 px tall (81 px wide), recommended 32 px tall (108 px wide) or more | `lockup-horizontal.svg` |
| Stacked lockup: minimum 64 px tall (62 px wide) | `lockup-stacked.svg` |
| Wordmark alone: minimum 12 px cap height (about 19 px tall, 50 px wide) | `wordmark.svg` |

Colour: the plain files draw with `currentColor` (ink `#0E1018` on `#F4F5F7`; dark mode
`#ECEEF2` on `#0B0C0F`). Where CSS cannot set the colour, use the `-black` (`#0E1018`) or
`-white` (`#FFFFFF`) copies.

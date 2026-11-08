# Hairline figures

Line figures that answer the pointer, used on Aura's **explainer** surfaces only
("How it works", empty states, the 404, the pool header) — never on market data.

Two sources:

- **`@lucasmarkes/hairline`** (npm, MIT): the package's ready-made figures as React
  components — `import { Plug } from "@lucasmarkes/hairline/react"`.
- **This folder**: figures drawn for Aura with the `hairline-create` skill, on the
  same engine.

| File | What it is |
| --- | --- |
| `kernel.js` | The Hairline engine, copied **unchanged** from the skill (MIT, see `LICENSE`). |
| `window.js` | A market window: a carriage runs to a gate, the gate drops (frozen), the tray past it tips its coin (settled). |
| `sides.js` | YES / NO: a two-pan balance; coins drop into the side you pick and it tips. |

The figure files stay in the skill's own format (a classic script that reads the
global `HL` and ends in `hairline({ … })`), so the skill's checks run on them as
they are. `scripts/sync-hairline.mjs` turns them into ES modules under
`src/components/hairline/` (kernel + `figures/<name>.js` + types), which
`<HairlineFigure figure={…} />` mounts.

## Changing or adding a figure

1. Edit `<name>.js` here (or make a new one with `/hairline-create <idea>`).
2. Check it with the skill, from any scratch folder:
   `node <skill>/look.mjs <path>/app/hairline/<name>.js --answer x,y,z`
   (validator + eight screenshots on one sheet — read the sheet).
3. `node scripts/sync-hairline.mjs` to regenerate the modules. CI runs it with
   `--check` and fails if they are stale.

## Theme

`styles.css` sets `--hairline-plate` to the surface a figure sits on (page
background by default, `.hairline-on-card` on cards, `.hiw-plate` in the guide)
and `--hairline-hi` to Aura's orange. Dark mode follows the `.dark` class.

# Design

## Register

design

## Creative north star

A working catalog on a desk: drawers, index cards, a reading surface. The operator is shelving and weeding, not configuring a product.

## Surfaces

- **Masthead:** Instrument Serif italic wordmark, a find field, house census, theme.
- **Drawers:** one per install scope. Counts follow the tray filters. The house census does not. The quarantine shelf sits at the bottom, held out of All drawers and the census.
- **Tray:** index cards. Stamps are cataloguing (kind, form, origin, copies, risk, invocation), not badges for their own sake.
- **Reader:** the skill body at a readable measure. Frontmatter, on-disk facts, risk, and copies sit above the manuscript as cataloguing, not a settings panel.

Ten named skins live in `src/themes.css`. Carbon is the first-run default. Skins may change type, chrome, and stamp geometry. They must not become a neon dashboard.

## Named rules

**The two-signal rule.** Kind, risk, form, and origin always carry words as well as colour. A red mark without the word "risk" is a defect.

**The path is data rule.** Filesystem paths use the mono face, wrap rather than masquerade as prose, and expose the full value on `title` when space is tight.

**The filesystem-effect rule.** Delete copy names unlink, delete file, or delete folder for each card. A symlink is unlinked. Its target stays. Plugin-cache and builtin cards still warn that they may return.

**The extra-action rule.** Quarantine and Restore sit beside Delete. They do not wear the stamp. Delete is the only destructive mark.

**The evidence rule.** Inferred origin and static audit findings are labelled as such. They are not scores, and they are not hidden behind colour.

**The reduced-motion rule.** Idle logo motion and nonessential transitions stop when `prefers-reduced-motion` is set. See `src/styles.css`.

## Do

- Keep chrome out of the measure of the skill body.
- Let the tray be dense; let the reader be empty when nothing is selected.
- Persist tray filters in `localStorage` the same way theme is persisted.

## Do not

- Inter, glass, gradient type, or colour-only status.
- A validity or health dashboard.
- Cute confirmations. The action is Delete. Quarantine is a hairline box, not a second stamp.

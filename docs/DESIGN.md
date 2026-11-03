# Design system and UX

Cozy Studio must feel like a professional creative tool. It is precise and technical, and it stays clear for new users. Keep the current visual identity: Carbon and Paper themes, runtime accent colors, Workbench controls and the shared canvas layout.

This guide owns the visual rules and the CSS ownership map. It is not a token catalog. The token files are the source of truth for values.

## Principles

- Clarity before decoration.
- System state is visible and actionable.
- One vocabulary across the UI.
- Copy is clear for first-time visitors.
- Empty states teach the next step.
- Diagnostics name the blocker and the next action.

## Palette

Studio chrome uses Workbench UI 0.4.0 tokens (`--wb-*` and `--wbp-*`) with **Ambient Carbon Comfortable** and a Paper appearance.

- Carbon (dark): background `#0a0a0a`, panels `#161616`, controls `#2a2a2a`, wells `#0d0d0d`. Catalog Carbon (`#202020` / `#282828`) is not used.
- Paper (light): background `#efece4`, panels `#e4e0d6`, controls `#d8d2c4`, wells `#f6f3eb`.
- The accent starts as Violet (`#8b6cff`, the landing page accent) on `--wb-accent`, `--wba-accent` and `--wbp-accent`. The logo cycles palettes for Generate, tabs and selection. The cup mark follows that scale. The catalog signature coral `#e79a72` is not the Studio default.
- Precision density is `comfortable` (`--wbp-gap` 18px, `--wbp-pad` 24px). The Create Generate cluster keeps `--create-control-gap: 12px`.
- Edges are `soft`. Presentation is `utility`: Studio does not ship Compose instrument editors, knobs or Workbench.js.
- Lighting paints `.studio-surface`, `.studio-control`, `.studio-well`, `.studio-bar`, `.studio-popover`, `.studio-dialog` and the 0.4 dial and thumb targets when `supportsWorkbenchLighting()` is true. Otherwise `data-ambient-fallback="unsupported-css"` keeps flat Carbon or Paper colors.

Do not treat the Create rail as a cream panel in Carbon. Generate uses a darkened accent fill so that its label stays readable. Overlays (Settings, Jobs, Trash, Activity, workflows) use the same `--wb-*` tokens and the same `studio-dialog`, `studio-field` and `studio-list-row` chrome as Create.

## Typography

- The typography preset is `neutral`. `--wbp-font-label` and `--wbp-font-heading` use Manrope, then system UI.
- `--wbp-font-value` is monospace for IDs, ports, logs and status numbers.
- Controls use 13px text, captions 12px and section headings 14px.

## CSS load order and owners

`index.html` loads the Manrope font, `index.css` and `main.tsx`. `index.css` imports these sources in this order:

| Source                              | Owns                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `tailwindcss`                       | Theme, one Preflight reset, generated utilities and Tailwind layers                          |
| `styles/workbench-tokens.css`       | Theme colors, semantic aliases, ambient inputs and the shared action height                  |
| `styles/workbench-precision.css`    | Control size, typography, density and edge tokens                                            |
| `styles/workbench-ambient.css`      | Workbench material and lighting paint                                                        |
| `styles/workbench-studio.css`       | Studio-specific Workbench controls and ambient specificity bridges                           |
| `styles/compact-style-selector.css` | Compact style selection, catalogs, tiles and disclosures                                     |
| `styles/studio-foundation.css`      | Tailwind theme extensions, base defaults, shared utilities and CSS motion primitives         |
| `styles/studio-workspace.css`       | Create and workflow composition, responsive rails, result tools, Library and viewer surfaces |
| `styles/studio-organization.css`    | Tag and collection menus, organization editors and the carousel details panel                |

Vite uses the React and `@tailwindcss/vite` plugins. All CSS goes into one eager stylesheet that the lazy workflow routes share. Workflow components do not import CSS. There is no second Preflight, Sass pipeline, CSS Modules build or runtime CSS-in-JS engine.

Import order is a contract. Workbench and workspace component rules are unlayered. The foundation keeps its `base` and `utilities` layers. Unlayered normal rules win over normal layered utilities. Do not move the component sheets into a new layer or reorder the imports during routine cleanup.

`!important` declarations reverse that layer priority. The toolbar and global keyboard-focus rules in the foundation's utilities layer can win over unlayered Workbench rules. Change those rules at their owner. Keep the Ambient kernel's scoped rules, third-party notice and license intact.

The landing site owns its styles under `landing/`. The Studio entry point does not import them. Generated reports and embedded HTML previews are separate documents, not Studio themes.

`lib/workbenchAmbient.ts` applies the theme, density, appearance and ambient attributes to the root. Portals such as `GsapDropdown` carry the same theme data. `lib/providerBrand.ts` owns the provider glyph wells and the readiness and auth pill classes. Brand tint must not replace semantic text and status colors.

## CSS conventions

- Add theme semantics to the token owner. Keep the Workbench, precision, ambient and Create aliases where they serve different scopes. Two tokens with equal values are not always interchangeable.
- Add component rules at their existing owner. Keep one root definition per selector where cascade precedence allows it. Put responsive and state variants beside the family that owns them. Do not add a second override sheet.
- Keep complete Tailwind class names in maps and variants. `lib/utils.ts` owns the `clsx` plus `tailwind-merge` helper. Do not add a second class-merging helper.
- Keep runtime values in the component style or a bounded custom property. Examples are image transforms, portal positions, virtualized layout, card sizing and accent colors. They are not dead CSS.
- Keep the 639/640 and 1023/1024 viewport boundaries, the container queries for catalog, result and viewer widths, and the ResizeObserver-driven workspace layout. A Jobs rail changes the available workspace width without changing the viewport.
- Keep specificity and shorthand order when you merge rules. A repeated selector inside a media query has a different role from a duplicate root rule.
- Keep automatic Tailwind source detection unless you verified all dynamic consumers. [Dependencies](DEPENDENCIES.md) and the package manifest own the versions. Tailwind, the class helpers and GSAP each have a different role.

## Component geometry

- Single-line controls use a 32px row with 13px text. Two-line output selectors use 40px. Settings inherits this scale. Change these values only at their token owners.
- `studio-field` owns the text input and select insets: 6px vertical and 12px horizontal. `studio-ghost-control` owns labeled action padding and an 8px icon gap. Icon-only SVG actions keep compact equal insets. `--wb-control-border` gives a neutral edge in both themes. These two primitives do not use Ambient bevel paint; the surrounding shell keeps its material.
- The Create generation action uses content height, a 48px minimum and 10px vertical padding. Do not squeeze a two-line action and its thumbnail into a fixed 36px row. `studio-workspace.css` owns that geometry; `workbench-studio.css` owns its theme paint and type.
- Settings is a 1120 × 760 dialog, bounded by the viewport. The header, section navigation and footer stay fixed; only the content scrolls. Narrow screens use a section selector. Desktop content, header and footer share 24px edge insets; narrow layouts use 16px. Provider account cards use two columns when space permits and one on narrow screens. Setup guidance wraps; it is not clamped. The narrow footer keeps a row for the save status above the actions. `workbench-studio.css` owns the shared label, help and control rows, the modal scrim and the Cozy layout rules.
- Onboarding is a centered, content-sized dialog up to 960px wide and 800px high, bounded by the viewport. Body text starts at 14px and the introduction uses 16px. Setup diagnostics stay collapsed when Studio is ready. Provider names use the existing brand marks.
- Create layout follows the available workspace width, not the viewport. From 1120px, Create uses a 320px main rail, an optional 360px Workflow or Styles panel and the canvas. From 720px to 1120px, Prompt, Workflow and Styles share the rail. Narrower workspaces use Configure and Preview navigation.
- The Create prompt grows from 192px to 320px and then scrolls. References do not add to its height.
- Workflow card art is 4:3 and loads lazily as 640 × 480 WebP. Each card reserves its image size while it loads.

## Motion

- GSAP is the standard. Typical durations are 150 to 250 ms.
- Animate state, reveal and feedback. Do not add motion for its own sake.
- Prefer `transform` and `opacity`. Press feedback does not scale whole cards or images.
- `lib/motionRuntime.ts` owns GSAP. `lib/gsapMotion.tsx` owns shared presence and route and dialog motion. No other motion engine is installed. `components/ui/GsapDropdown.tsx` owns dropdown animation, portal placement, interruption and cleanup. Exiting surfaces become inert, and focus returns through the existing handlers. CSS selectors exclude motion-owned surfaces where the shared adapter writes transforms.
- Each surface has one entry owner: native route transitions, CSS panel transitions or GSAP. GSAP surfaces do not also use CSS opacity or geometry transitions. Presence keeps closing surfaces for the 120 ms CSS exit. `TooltipBubble` owns the shared 300 ms tooltip delay.
- `hooks/useTheme.ts` writes the accent custom properties and handles theme motion. CSS owns hover and focus paint, spinners and small disclosure transitions.
- Reduced motion has a CSS path and a JavaScript path. Keep their durations, easing, transform ownership and completion behavior together. Do not infer animation completion from screenshots.
- Modal scrims use a translucent theme surface with `blur(12px) saturate(0.25)`. Settings opens and closes through the GSAP presence adapter at about 160 ms and 100 ms. Do not animate the Settings height. `useDialogFocus` owns focus, nested Escape, body scroll locks and inert background branches.
- `CozyMascot` renders the supplied SVG in full and compact variants. The dark body and light features stay fixed; the steam, coffee, pencil and notebook follow the accent. GSAP pauses hidden mascots. In onboarding, three short steps enter in sequence, and Cozy waves the pencil, blinks and draws once. System motion follows the OS; Reduced turns off decorative CSS and GSAP motion and leaves all content visible.

## Interaction

- Global drag and drop for references.
- Useful shortcuts: `Escape`, carousel navigation and comparison.
- Destructive confirmations explain the impact and the recovery.
- Demand-mounted surfaces show visible loading and error states. Do not leave silent gaps.
- Show a command only when it has real behavior or a blocked reason that the user can act on.
- Appearance changes in Settings are previews until Save. Discard restores the saved appearance.
- The Create rail, its prompt, workflow controls and footer stay usable at narrow widths. Controls must not overlap the prompt or cause horizontal overflow.
- The shell owns the viewport and delegates scrolling to rails, dialogs and canvases. Check desktop and narrow mobile widths when you change overflow or fixed menus.
- A `:focus-within` wrapper can draw input focus. The Add styles search also has a forced-colors outline. The layered global focus rule uses `--wb-ink`. Inspect the mounted control before you remove an `outline: none` declaration.

## Preserved exceptions

| ID        | Owner and reason                                             | Evidence and review trigger                                                                                                                                           |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS-EX-01 | The react-scan development overlay must float above dialogs  | Now in `studio-foundation.css`; review by 2027-03-20 or when removing react-scan                                                                                      |
| CSS-EX-02 | Mobile workflow menu geometry must win over inline placement | Foundation/workspace rules; keep the earlier 390px evidence distinct from the 2026-09-26 audit. Review by 2027-03-20 or when dropdown positioning/mobile dock changes |
| CSS-EX-03 | Anchored style previews transition top/left for continuity   | `compact-style-selector.css`; layout cost not profiled. Review by 2027-03-20 or when profiling preview navigation                                                     |
| CSS-EX-04 | WebKit and Mozilla range pseudo elements need separate rules | `workbench-studio.css`; review by 2027-03-20 or when supported browsers change                                                                                        |
| CSS-EX-05 | Pixel-art rendering uses ordered compatibility values        | `studio-foundation.css`; review against explicit browser targets before removal                                                                                       |
| CSS-EX-06 | Workbench bridges preserve ambient and utility precedence    | `workbench-studio.css`; review when the imported Workbench contract changes                                                                                           |
| CSS-EX-07 | Reduced-motion rules shorten CSS animations and JS movement  | Foundation, workspace, GSAP adapters, theme hook; review with focus and completion behavior                                                                           |
| CSS-EX-08 | Some CSS and utility variants have unvisited consumers       | Audit inventory and host markers; absence in one browser session is not proof of disuse                                                                               |

The exceptions were reviewed on 2026-09-26. Review them again when the listed owner changes. Do not remove one only because a static audit reports a warning.

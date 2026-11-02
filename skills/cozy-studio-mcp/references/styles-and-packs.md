# Styles and packs

Studio compiles `styles` on the server with the same functions and Settings as the Studio UI.

## Find styles

1. Search.
   - Call `studio_find_styles` with `q` (matches preset id, name, display name and category), `packId` (one pack) or both. `limit` is 1 to 50, default 20. There is no offset: narrow `q` or `packId` to see more.
   - `packId` is the style pack id (`stylePack.id` in the manifest from `studio_extensions`). It can differ from the extension id.
   - Each result has `packId`, `presetId`, `name`, `category`, `hasIntentionalPolicy` and `summary` (up to 160 characters of the preset's aesthetic). A copied preset is left out while its source pack is installed, so each style shows once.
   - Results carry no images. The user sees previews in the Studio style catalog.
   - Done when you have the `packId` and `presetId` of each preset to use.

2. Check the compiler.
   - Call `studio_settings`. `intentionalStylesV1` picks the compiler: `false` (the default) runs the legacy compiler, `true` runs Intentional styles.
   - With Intentional styles on, use only presets with `hasIntentionalPolicy: true`.
   - Done when every chosen preset fits the active compiler.

## Apply styles

Pass `styles` to `studio_generate` or `studio_plan_generation`:

- `styles: [{packId, presetId, strength?}]`, one to five presets. `strength` is 0 to 1. It defaults to the Settings style intensity (`defaultStyleIntensity`, 0.75 unless the user changed it).
- `styles` runs the styles recipe. Leave `recipeId` out.
- `styleMode` sets how styles treat `referenceIds`. It defaults to the Settings `defaultStyleReferenceMode`, `preserve` unless the user changed it.

| `styleMode`   | Legacy compiler                                                   | Intentional styles                                               |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `preserve`    | Keeps the layout of the references. No effect without references. | Needs `referenceIds`. Without them, the call returns 400.        |
| `reinterpret` | Restages the references. No effect without references.            | Restages the references.                                         |
| `generate`    | Runs as `preserve`.                                               | Ignores the references. Use it when there are no `referenceIds`. |

Preview every styled call with `studio_plan_generation`. Its `styles` field gives `compiler`, `mode` and `issues`, and `providerPrompt` shows the compiled prompt.

| Error                                                                               | Action                                                                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Style <packId>/<presetId> is not installed. Find presets with studio_find_styles.` | Use ids from `studio_find_styles`.                                                                                                      |
| `styles uses the styles recipe. Leave recipeId out.`                                | Remove `recipeId`.                                                                                                                      |
| `Pass styles instead of compiled style fields.`                                     | Remove compiled fields, such as `selectedStyles` or `compilerVersion`, from `recipeParams`.                                             |
| 400 with `issues`, code `PRESERVATION_NEEDS_CONTENT_REFERENCE`                      | Add a reference, or set `styleMode: "generate"`.                                                                                        |
| 400 with `issues`, code `UNMIGRATED_PRESET`                                         | Replace the presets it names with presets that have `hasIntentionalPolicy: true`, or ask the user about the Intentional styles setting. |
| `The selected styles have no visual fields to apply.`                               | Choose other presets.                                                                                                                   |
| `Style pack <packId> cannot be read: ... Reinstall extension <id>.`                 | Reinstall that pack (see below).                                                                                                        |

`studio_user_styles` lists the user's saved styles. `styles` cannot use them yet; the user applies them in the Studio UI.

## Read pack data

- `studio_extensions` lists installed packs: their manifests, `installedLayers`, `origins` (per extension id: `{from: "download" | "local", folder}`) and `invalid` folders with their issues.
- `studio_extension_json` with `{extensionId, path}` reads one JSON file of a pack. `path` is relative and ends in `.json`.

## Install, update and remove packs

These tools need Full control access.

1. List published packs.
   - Call `studio_available_extensions`. Each source has `id`, `label`, `extensions` and `error`. Each extension has `id`, `version`, `installedVersion`, `installedLayers` and `updateAvailable`.
   - A private source needs a GitHub token or a hub password. The user sets these secrets.
   - Done when you have the `sourceId` (the source `id`) and `extensionId` (the extension `id`) of each pack the user wants.

2. Install or update.
   - Call `studio_install_extension` with `{sourceId, extensionId, layers?}`. Installing a pack with `updateAvailable` updates it.
   - The only layer is `cards` (full-quality preview cards). Pass `layers: ["cards"]` to add cards and `layers: []` for none. Without `layers`, the call keeps the layers already installed.
   - The call can take up to 120 seconds. After a timeout, check `studio_extensions` before you retry.
   - Studio verifies every download and writes the pack in one step. A failed install keeps the previous version.
   - Done when `studio_extensions` lists the pack at the new version and `studio_find_styles` with its `stylePack.id` as `packId` returns presets.

3. Remove.
   - `studio_remove_extension` with `{extensionId}` deletes a downloaded pack and its layers from disk. Built-in and local packs cannot be removed. Follow **Ask before destructive tools** in [SKILL.md](../SKILL.md).
   - A new Studio with no packs installs the Essentials pack (`cozy.pack-00`) once. After the user removes it, it stays removed.
   - Done when `studio_extensions` no longer lists the pack.

## Author styles

Studio does not author style content. It loads installed packs only (`docs/adr/0011-declarative-extensions-and-style-pack-sources.md` in the Studio checkout). Presets, style DNA, cards and pack builds live in the private `cozy-styles-dev` repository, next to the Studio checkout. When you have that repository, start at its `curation/agent-kit/START-HERE.md` and follow it. Without it, tell the user that style authoring needs that repository. Do not add style content to the Studio checkout.

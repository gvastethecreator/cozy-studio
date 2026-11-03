# Workflows

This file maps a kind of output (a character sheet, a storyboard, a sprite sheet, a restored photo, a new camera angle) or a workflow name to the `recipeId`, `task` and `recipeParams` for `studio_generate`. To run the generation, continue with [generate-and-compare.md](generate-and-compare.md).

The product calls these Workflows. The MCP tool and field names remain `studio_recipes`, `recipeId` and `recipeParams`.

## Process

1. Find candidates.
   - Call `studio_recipes` with `q` set to the user's words, for example `{q: "storyboard"}`.
   - Each summary has `id`, `title`, `description`, `targetRecipeId`, `supportedTasks`, `supportedProviders`, `requiredParameterIds` and, for UI-only workflows, `uiOnly: true`.
   - For a plain image, leave `recipeId` out. For styles only, use `styles` instead of `recipeId` ([styles-and-packs.md](styles-and-packs.md)).
   - Done when you have one to three candidates that are not `uiOnly`, or you know the request is UI-only (see the table below).

2. Read one workflow.
   - Call `studio_recipes` with `{id}`. The result adds `parameters` (schemas with options) and `defaultParams`.
   - Check that the provider is in `supportedProviders` and the task is in `supportedTasks`.
   - Done when you know a value for every id in `requiredParameterIds`.

3. Offer options.
   - When more than one workflow fits, offer two or three options. For each option, give the workflow title, what it makes, the provider and the job count.
   - Done when the user chose an option, or the request already named one.

4. Build the input and check it.
   - Set `recipeId` to the `id` from step 2. An alias id, such as `character-poses`, works: Studio runs its `targetRecipeId` with the alias defaults.
   - Put only the values you change in `recipeParams`. Studio merges them over `defaultParams`.
   - Leave `task` out to use the workflow default. For an edit, set `task: "image_edit"` and pass the source image in `referenceIds`.
   - Preview with `studio_plan_generation`. It reports the `recipeId` and `task` that Studio will run.
   - Done when the plan returns `ready: true`, or you have a blocker to report.

## Current workflows

`studio_recipes` is the source of truth. This map helps you choose search words.

| Intent                                                 | Workflow `id`                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Restore or reinterpret a reference image               | `remaster`                                                                                                                             |
| Character reference sheet                              | `character`                                                                                                                            |
| Character poses, sprites, scenes, variants, transforms | `character-lab`, or an alias: `character-poses`, `character-sprites`, `character-scenes`, `character-variants`, `character-transforms` |
| Another camera view of an image                        | `camera`                                                                                                                               |
| Storyboard grid                                        | `cinematic`                                                                                                                            |
| Neighboring storyboard frames                          | `timeline`                                                                                                                             |
| One sprite-sheet image                                 | `spritesheet`                                                                                                                          |
| Apply style presets, or make style cards               | `styles`; to apply presets, pass the `styles` input                                                                                    |
| Frame animation with GIF export                        | `animation-sequence` (UI only)                                                                                                         |
| Runtime sprite atlas                                   | `sprite-atlas` (UI only)                                                                                                               |

## UI-only work

`studio_generate` makes single images. Send these requests to the Studio UI and tell the user why.

| Work                           | Why it stays in the UI                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Sprite Atlas runs              | A run coordinates row prompts, layout guides, extraction and QA across many frames. |
| Animation Sequence runs        | A run builds frames one by one, with a correction flow and GIF export.              |
| Masked edits                   | `studio_generate` has no mask input. Use the image editor in Studio.                |
| Component Studio (TCG layouts) | It composes and exports a PNG in the UI. No MCP tool drives it.                     |

A UI-only workflow returns 400 "This workflow needs its run in the Studio UI (Workflows). studio_generate makes single images."

## Workflow errors

| Error                                                                                                   | Action                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Unknown workflow. Use studio_recipes.`                                                                 | Use an `id` from `studio_recipes`.                                                                                           |
| `Workflow <id> does not support task <task>.`                                                           | Pick a task from `supportedTasks`, or leave `task` out.                                                                      |
| `Workflow <id> does not support provider <provider>.`                                                   | Pick a provider from `supportedProviders`.                                                                                   |
| A parameter error                                                                                       | Fix `recipeParams` against `parameters` from `studio_recipes {id}`.                                                          |
| `<Title> is turned off. Turn it on in Settings → Styles & workflows.` (code `workflow_module_disabled`) | Tell the user. The user turns the module on, or asks you to change `disabledWorkflowModules` ([configure.md](configure.md)). |

For style errors, see [styles-and-packs.md](styles-and-packs.md).

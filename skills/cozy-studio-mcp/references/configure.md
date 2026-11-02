# Configure Studio

## Agent access

The user sets Agent access (MCP) in Settings > Advanced & maintenance. Studio reads it on every call, so a change applies to the next call. All local MCP clients share it. `studio_status` returns `mcpAccess` and `mcpAccessLabel`. Each level adds tools to the level before it:

- Off (`off`): no Studio tool. Every call returns 403. `studio_guide` still works.
- Read only (`read`), the default: every read tool, including `studio_plan_generation` and `studio_find_styles`.
- Organize (`organize`): adds `studio_organize_images`, which changes tags and collection membership of existing images. It never deletes, archives or moves images and never uses provider usage.
- Full control (`write`): adds `studio_generate`, `studio_retry_batch`, `studio_cancel`, `studio_import_reference`, `studio_import_reference_file`, `studio_update_settings`, `studio_install_extension`, `studio_remove_extension` and `studio_apply_update`.

Rules:

- Before a task, compare `mcpAccessLabel` with the level the task needs. Ask the user for the lowest level that works: Organize to organize images; Full control to generate, import, change settings, manage packs or update Studio.
- A 403 returns `access` (the current level) and `required`. Tell the user to set `required` at Settings > Advanced & maintenance > Agent access (MCP).
- No tool changes Agent access or Allowed import folders.

## Change settings

`studio_update_settings` needs Full control. It accepts only these fields. Any other field rejects the whole call with `Invalid tool arguments`. The user sees each field at the Settings path in brackets.

- `language`: `en` or `es`. [Creation & startup > Language]
- `preferredWorkflow`: `default`, `remaster`, `character-poses`, `character-sprites`, `character-scenes`, `character-variants`, `character-transforms`, `character`, `character-lab`, `camera`, `cinematic`, `timeline`, `animation-sequence`, `spritesheet` or `sprite-atlas`. [Creation & startup > Startup workflow]
- `disabledWorkflowModules`: module ids from the tool schema, for example `camera` or `sprite-atlas`. The list replaces the saved list. Create (`default`) is not a module and stays on. [Styles & workflows > Workflow modules]
- `defaultStyleIntensity`: 0.1 to 1, the `strength` of styles that do not set one. [Creation & startup > Default style intensity]
- `defaultStyleReferenceMode`: `preserve` or `reinterpret`. [Creation & startup > Default style reference mode]
- `intentionalStylesV1`: `true` or `false`. It picks the style compiler: see [styles-and-packs.md](styles-and-packs.md). [Creation & startup > Detailed style instructions]
- `outputOrganization.subfolderTokens`: up to 6 of `workspace`, `date`, `provider`, `model`, `recipe` and `workflow`, in folder order. The list replaces the saved list. `[]` means no subfolders. [Files & naming > Folder structure]
- `outputOrganization.fileNameTemplate`: up to 120 characters, without `< > : " / \ | ? *`. Tokens: `{date}`, `{time}`, `{timestamp}`, `{timestampUtc}`, `{generation}`, `{workspace}`, `{workflow}`, `{provider}`, `{model}`, `{job}`, `{jobId}`, `{recipe}`, `{prompt}` and `{style}`. The default is `{timestampUtc}_{generation}_{style}_{prompt}`. [Files & naming > File name template]
- `notifyOnUpdates`: `true` or `false`. When true, Studio checks for updates every hour while it is visible. [Help & updates > Update notifications]

1. Read the current values.
   - Call `studio_settings`.
   - Done when you have the saved value of each field the user wants to change.

2. Send the change.
   - Send only the fields the user asked to change. In `outputOrganization`, send only the subfield that changes.
   - For a list field, send the whole new list. To turn one workflow module on, send the saved `disabledWorkflowModules` without its id.
   - Done when the call returns the saved settings.

3. Report.
   - Tell the user the saved values. Output settings apply to new images only. Existing files keep their names and folders.
   - Done when the user knows each value that changed.

## Providers and models

- `studio_generate` and `studio_plan_generation` use `providerId: "chatgpt"` unless the call sets another provider. They do not read the Settings default provider. [SKILL.md](../SKILL.md) says when to use `codex`.
- `studio_providers` shows each provider's readiness without secret values. Use a provider that it shows as ready.
- To use another model, set `model` on that one `studio_generate` call. Do not change a default. `chatgpt` takes `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` or `gpt-image-2`. `codex` takes a Codex model. Every other provider uses its Settings default.

## Key-based providers

Some providers read a key from `.env.local` in the checkout, for example `OPENAI_API_KEY`, `FAL_KEY`, `REPLICATE_API_TOKEN`, `GOOGLE_API_KEY` or `XAI_API_KEY`. The Providers section of `docs/USER_GUIDE.md` lists each provider's variables.

1. Ask the user to add the key.
   - The user edits `.env.local` (**Leave user-only actions to the user**).
   - Studio reads `.env.local` only when it starts. Ask the user to restart Studio after the change.
   - Done when the user says the key is in place and Studio restarted.

2. Check the provider.
   - With a shell in the checkout, run `bun run providers:preflight -- --provider=<id>`. It reports readiness, such as `canAttempt=true`, and never prints values. Without a shell, call `studio_providers`.
   - Done when the provider is ready, or you told the user what is still missing.

## Only the user

Agents cannot do these. Tell the user where to do them.

| Action                                                            | Where                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Sign in or out (ChatGPT, xAI, Google)                             | Settings > Accounts & models                                                      |
| Default provider, model defaults, execution settings              | Settings > Accounts & models                                                      |
| Output directory                                                  | Settings > Files & naming > Output directory                                      |
| External folders, import sources, metadata export                 | Settings > Library & imports                                                      |
| Rename or recolor tags and collections                            | Settings > Tags & collections                                                     |
| Agent access, Allowed import folders                              | Settings > Advanced & maintenance                                                 |
| Storage cleanup, thumbnail repair, log cleanup, Rebuild Library   | Settings > Advanced & maintenance                                                 |
| Empty the Archive (permanent)                                     | **Archive** in the header > **Delete permanently** (deletes every archived image) |
| Delete a workspace                                                | The workspace menu > Delete workspace                                             |
| Private pack hub password                                         | Settings > Styles & workflows                                                     |
| Provider keys, ports, Library folder, pack sources, worker limits | `.env.local`, then restart Studio                                                 |

Removing a style pack and applying an app update are agent tools, but they need the user's agreement first: see [SKILL.md](../SKILL.md).

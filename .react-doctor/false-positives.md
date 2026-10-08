# Reviewed React Doctor exceptions

Reviewed with React Doctor 0.9.17. Keep the full project scan and the default
rules. These exceptions apply only while the predicates below remain true.
Remove an exception when its owner, cleanup, bounds, or source changes.
Size, complexity, missing validation, and missing cleanup are not exceptions.

## Async ownership and cleanup

| Source                                             | Predicate and evidence                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hooks/useCatalogPage.ts`                          | Both loading resets are inside `finally`. `requestGate.finish(token)` prevents an older request from clearing a newer request's flag. Existing catalog-page tests cover request ownership and failure. |
| `hooks/useStudioSettings.ts`                       | The reset is inside `finally`, guarded by mount state and the refresh revision. Existing settings-hook tests cover refresh state.                                                                      |
| `components/settings/SubscriptionAuthControls.tsx` | `loadStatus` resets inside `finally`. An aborted request must not publish completion for a newer provider.                                                                                             |
| `components/recipes/useUserStyleLibrary.ts`        | The loading reset is inside `finally`; retain the request's cleanup guard.                                                                                                                             |
| `hooks/useStyleRuntimePacks.ts`                    | The effect checks cancellation after asynchronous work before publishing state. Retain those checks and its cleanup.                                                                                   |
| `components/recipes/UserStyleEditorSurface.tsx`    | Created preview URLs are retained for the editor and revoked when replaced, removed, or unmounted. Creation and disposal have different owners in the same editor.                                     |

## Required ordering and resource limits

The installed `async-await-in-loop` rule explicitly says to parallelize only
independent work and preserve resource limits, transaction order, and failure
or cancellation semantics.

| Source                                                            | Reason to keep sequential execution                                                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ImageConversionModal.tsx`                             | Stop means stop after the current conversion. The next image must not start early. Serial work also bounds native image-decoding memory. The existing conversion test covers order and retrying failed items. |
| `components/settings/SettingsExtensionsPanel.tsx`                 | Bulk installs share the installation/catalog state and report one current pack.                                                                                                                               |
| `apps/local-server/src/extensionRoutes.ts`                        | Requested layers write the same extension root. Complete each install before starting the next layer download.                                                                                                |
| `apps/local-server/src/spriteAtlasService.ts`                     | Export decodes one atlas frame at a time, bounding Sharp's native memory use.                                                                                                                                 |
| `apps/local-server/src/spriteAtlasRunReconciler.ts`               | Row groups can share a run file. Read after the preceding write and preserve dispatch failure order. Run recovery may decode images, so only one run imports at a time.                                       |
| `lib/workspaceIdbMigration.ts`                                    | Each creation result updates `remoteIds` before the next legacy entry is admitted. Preserve deduplication and the migration marker's commit order.                                                            |
| `landing/kit/js/app.js`, `landing/kit/js/modules/stage-motion.js` | GPU device and shader initialization is deliberately staggered by host. Keep bounded setup rather than launching all device allocations at once.                                                              |

## Serialization and path validation

- `apps/local-server/src/localExtensionInstall.ts`: the JSON round trip
  normalizes expected search metadata to its serialized manifest shape before
  `isDeepStrictEqual`. In particular, it removes undefined optional fields.
  `structuredClone` would compare a different contract.
- `apps/local-server/src/providers/codexResponsesImageExecutor.test.ts`: the
  checkpoint test models JSON persistence across process restart. It is not
  testing a generic in-memory clone.
- `apps/local-server/src/outputDestination.ts`: `assertOutputInsideRoot` checks
  the target against the registered root and resolves existing ancestors to
  reject escaping junctions. Collision candidates retain that directory and
  change only the basename suffix. Reservations use a hash of the candidate and
  exclusive creation; parsed reservation data is validated before reuse.

## External navigation

`hooks/usePreferredWorkflow.ts` consumes the parent's asynchronous preference
and restores the external URL through `useHashRouter`; it does not send
child-produced state to a parent. The waiting flag makes restoration one-shot,
the initial hash detects intervening navigation, and `studio-navigation`
cancels a pending restore. Existing router tests cover the route behavior.

The Character Lab anchor `#recipe-character-lab` is an application hash route
handled by the same router, rather than a target element in the document.
Its statement-local `anchor-target-exists` exception retains normal navigation.

## Bounded lookups and cached formatters

- `landing/kit/kinds.mjs`: each kind owns a different small alias array. Each
  array is searched once; constructing a Set per kind does not remove a
  repeated scan of the same collection.
- `landing/kit/js/app.js`: the two formatters are created once in the top-level
  IIFE and shared by every formatting call. They are not created in a hot
  callback.
- `docs/codemap/codemap.html`: each edge gets its own bounded presentation class
  list. Checking its `dim` class once is not repeated searching of a growing
  data collection. The exception belongs to the canonical template so map
  regeneration retains its reason. Node lookups use the projection's ID index.
- `landing/kit/vendor/pretext/analysis.js`: Pretext 0.0.9 caches its word and
  grapheme segmenters in module variables. Construction happens only when the
  corresponding cache is null; cache reset and locale changes are explicit.
  The only new config override filters `js-hoist-intl` for this exact dependency
  file. All other rules still analyze it. Keep the dependency's generated code
  intact and review this predicate when its version changes.

Inline comments identify the exact statements. Generated first-party landing
copies come from `landing/kit/js`; rebuild them rather than editing copies.

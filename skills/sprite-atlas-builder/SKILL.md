---
name: sprite-atlas-builder
description: 'Cozy Studio sprite workflows: choose an atlas, animation sequence, or sheet and identify specialist work.'
---

# Sprite Atlas Builder

This file is a pointer. The checkout does not contain the specialist scripts or references.

Use `$spritesheet-expert` for irregular item atlases, video frame selection, onion-skin metrics, local model segmentation, and engine-loader proof.

That specialist is an external dependency, not part of this checkout. Resolve it through the installed skill catalog when the task needs it. If unavailable, report that dependency for specialist work; do not claim the app implements those capabilities.

Use the Cozy Studio recipes for the lanes the app implements:

- `sprite-atlas` for `animation`, `true-grid`, and `tileset` runs. Production compose accepts a strip only at the declared cell size. `static-items` stays blocked in the app.
- `animation-sequence` for separate frames and a GIF. Frames must already match the contract size.
- `spritesheet` and Character Lab `sprite_sheet` actions for one sheet image. They do not extract an atlas.

New atlas runs ask for native transparency. Chroma green remains an explicit one-shot background, labeled as a key color.

Read `AGENTS.md` for the provider and data boundaries. Use the current recipe module and its tests to verify parameters and output shape before submitting a job. Readiness of a recipe does not prove generation quality or engine playback.

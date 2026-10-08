# ADR 0008: Versioned optional asset packs

## Status

Accepted. Style-pack distribution is defined by [ADR 0011](0011-declarative-extensions-and-style-pack-sources.md).

## Decision

Keep the Core Asset Set below the budget in `assets/asset-policy.json`. Runtime imports may depend only on that set. The policy is the current inventory; do not maintain a second list in prose.

Character Lab uses core runtime atlases. Its large source and authoring frames are optional packs. `assets/asset-pack-lock.json` records their SHA-256 hashes, file counts and byte counts. Ignored generation failure ledgers are transient diagnostics and stay outside the lock.

Style packs are installed extensions, not in-repo optional asset packs. Their manifests, cards and distribution follow ADR 0011.

## Enforcement

`bun run repo:assets:audit` checks the core budget, classification, required files and optional-pack integrity. `bun run core-assets:smoke` checks the app without optional authoring packs. Refresh the lock only after reviewing intentional asset changes.

Installer evidence does not authorize a Git history rewrite. History changes require explicit approval.

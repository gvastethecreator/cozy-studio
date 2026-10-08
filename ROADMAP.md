# Roadmap

Cozy Studio is an open-source preview: a local-first, library-backed image studio with ChatGPT HTTP as the recommended provider and optional backend adapters.

## Priorities

- Make first run and provider recovery easier to understand.
- Improve job recovery, storage diagnostics and image traceability.
- Reduce shell orchestration complexity while preserving Catalog Entries and Persistent Jobs as the durable sources of truth.
- Keep Windows, macOS and Linux setup reproducible, with clear limits for portable and Electron launch modes.
- Keep public documentation and contributor checks small and current.
- Prepare a release candidate with fresh setup, runtime and safety evidence.

These are directions, not a completion checklist or release promise. [GitHub Issues](https://github.com/gvastethecreator/cozy-studio/issues) and [Project #8](https://github.com/users/gvastethecreator/projects/8) hold live work state. The [user guide](docs/USER_GUIDE.md) describes available behavior; [Architecture](docs/ARCHITECTURE.md) describes its contracts.

## Product boundaries

Studio is not becoming a hosted SaaS or a reusable npm library. API keys remain optional for the recommended ChatGPT connection. Electron remains a development shell. Native video needs a separate media-domain decision.

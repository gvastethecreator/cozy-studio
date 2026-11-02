# Roadmap

Cozy Studio is an open-source preview: a local-first, library-backed image studio with ChatGPT HTTP as the recommended provider and optional backend adapters.

## Priorities

- Make first run and provider recovery easier to understand.
- Improve job recovery, storage diagnostics and image traceability.
- Make the app shell simpler. Catalog Entries and Persistent Jobs stay the durable sources of truth.
- Keep Windows, macOS and Linux setup reproducible, with clear limits for the portable launch mode.
- Keep public documentation and contributor checks small and current.
- Prepare a release candidate with fresh setup, runtime and safety evidence.

These are directions, not a completion checklist or release promise. [GitHub Issues](https://github.com/gvastethecreator/cozy-studio/issues) and [Project #8](https://github.com/users/gvastethecreator/projects/8) hold live work state. The [user guide](docs/USER_GUIDE.md) describes available behavior; [Architecture](docs/ARCHITECTURE.md) describes its contracts.

## Product boundaries

Studio is not becoming a hosted SaaS or a reusable npm library. API keys remain optional for the recommended ChatGPT connection. Studio runs in the browser; there is no packaged desktop app. Native video is out of scope until a separate decision adds it.

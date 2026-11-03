# Security policy

## Supported versions

Cozy Studio is in open-source preview. Security fixes land on the `main` branch until a stable release exists.

## Reporting vulnerabilities

Do not open public issues for vulnerabilities that involve local files, credentials, Provider Secrets, or asset exposure.

Use [GitHub private vulnerability reporting](https://github.com/gvastethecreator/cozy-studio/security/advisories/new). Reports go to the repository maintainers without opening a public issue. Include:

- affected commit or version
- operating system
- steps to reproduce
- expected impact and observed impact
- sanitized logs with no secrets

## Local-first notes

- Keep Provider Secrets outside Studio Settings that persist in SQLite.
- ChatGPT and xAI Sign in tokens live in an owner-only app-data file, outside the Studio data folder. [Platform support](docs/PLATFORMS.md#default-paths) lists the path for each OS. Studio does not encrypt them, so use full-disk encryption. Never copy them into SQLite, logs, transcripts, catalog metadata or the UI.
- Versions that stored tokens under `.studio/auth/studio-oauth.json` are not migrated. Revoke those provider sessions, remove that legacy file, and sign in again after upgrading.
- Sign out clears local credentials first and then makes a best-effort provider revocation request. A provider outage cannot keep a local token signed in.
- Studio Sign in uses the vendors' device-code endpoints. OpenAI and xAI do not document this as a supported Studio API. An xAI 403 for your plan tier and an empty Codex image response are known provider results, not vulnerabilities. Do not move a ChatGPT HTTP job onto Codex app-server when that request is uncertain.
- Never commit `.env.local`, SQLite databases, logs, transcripts, or Studio data folders.
- Treat Studio data folder paths as user-controlled data.
- Do not operate on arbitrary paths. Register or import External Output Sources first.

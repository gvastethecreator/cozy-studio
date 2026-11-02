import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readDoc(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('onboarding docs contract', () => {
  const readme = readDoc('README.md');
  const troubleshooting = readDoc('docs/TROUBLESHOOTING.md');
  const skill = readDoc('skills/cozy-studio-setup/SKILL.md');
  const docs = [readme, troubleshooting, skill].join('\n---\n');

  it('README first-run path separates ChatGPT sign-in from optional Codex setup and names storage', () => {
    expect(readme).toContain('private app-data folder');
    expect(readme).toContain('Pictures folder');
    expect(readme).toContain('never silent-installs Bun');
    expect(readme).toContain('https://bun.sh/docs/installation');
    expect(readme).toContain('https://github.com/openai/codex');
    expect(readme).toContain(
      'ChatGPT is recommended; sign in through Settings → Accounts & models',
    );
    expect(readme).toContain('Optional, only for the Codex provider: Codex CLI');
    expect(readme).toContain('`codex login`');
    expect(readme).toContain('bun run studio:onboard --setup');
    expect(readme).toContain('bun run dev');
    expect(readme).toContain('http://localhost:17222');
    expect(readme).toContain('{timestampUtc}_{generation}_{style}_{prompt}');
    expect(readme).not.toMatch(/as `AI-Studio-Library`/);
  });

  it('TROUBLESHOOTING lists studio:onboard, consent, and STUDIO_LIBRARY_DIR', () => {
    expect(troubleshooting).toContain('bun run studio:onboard');
    expect(troubleshooting).toContain('Mutating steps need an explicit yes');
    expect(troubleshooting).toContain('STUDIO_LIBRARY_DIR');
    expect(troubleshooting).toContain('Cozy Studio');
    expect(troubleshooting).toContain(
      'External folder to scan is an import source, not the generation destination',
    );
    expect(troubleshooting).toContain(
      'Generate writes to the images folder chosen in onboarding or Settings → Files & naming',
    );
  });

  it('setup skill still owns the Setup Prompt text', () => {
    expect(skill).toContain('COZY_STUDIO_SETUP_SKILL_PATH');
    expect(skill).toContain('Ask your agent and Copy prompt');
    expect(skill).toContain('bun run studio:onboard');
    expect(skill).toContain('Never silent-install Bun');
  });

  it('does not call Preferred Output Path the generation destination or claim silent Bun / bundled login', () => {
    expect(docs).not.toMatch(/Preferred Output Path is the generate destination/i);
    expect(docs).not.toMatch(/Generate writes to Preferred Output Path/i);
    expect(docs).not.toMatch(/silently installs Bun/i);
    expect(docs).not.toMatch(/Studio bundles ChatGPT login/i);
    expect(readme).toContain('That login is not bundled');
  });
});

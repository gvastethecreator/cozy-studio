#!/usr/bin/env bun
/**
 * Source text rules that import linting cannot express: retired tokens, raw Library layout paths,
 * required contracts and retired facade files. Import boundaries are `no-restricted-imports`
 * overrides in vite.config.ts and run with `bun run lint`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

interface SourceRule {
  files: RegExp;
  skip?: RegExp;
  forbid?: RegExp;
  require?: RegExp;
  message: string;
}

const self = 'scripts/architecture-source-rules.ts';

const rules: SourceRule[] = [
  {
    files: /\.tsx?$/,
    forbid:
      /catalog-cache|catalog-trash|GenerationBatch|LegacyVisualBatch|studioVisualBatchCatalog|materializeVisual/,
    message:
      'Retired browser batch state must not return; Catalog Entry and Persistent Job are the live models.',
  },
  {
    files: /^components\/(recipes\/.+|RecipesView|RecipeRouter)\.tsx?$/,
    skip: /^components\/recipes\/recipeModuleUi\.ts$|\.test\.tsx?$/,
    forbid: /Recipe Provider Directives/,
    message: 'Recipe surfaces collect UI params only; Recipe Modules build provider directives.',
  },
  {
    files: /^(apps\/local-server\/src|scripts)\/.+\.tsx?$/,
    skip: /^apps\/local-server\/src\/library\.ts$|\.test\.tsx?$/,
    forbid:
      /path\.join\(\s*libraryDir\s*,\s*['"](?:library\.sqlite|transcripts|assets|outputs|\.studio)['"]/,
    message:
      'Use resolveLibraryPathFromRoot(libraryDir, ...) for Library DB, transcripts, assets, outputs and .studio paths.',
  },
  {
    files:
      /^(packages\/shared\/src|services|hooks|contexts|components|lib|apps\/local-server\/src)\/.+\.(tsx?|mjs|js)$/,
    skip: /\.test\.tsx?$|^apps\/local-server\/src\/(db\/migrations|dbMigrationFixture)\.ts$/,
    forbid:
      /project\.created|\bprojectId\b|\bproject_id\b|\/api\/projects|listProjects|ensureDefaultProject|(?:interface|type)\s+Project\b/i,
    message: 'Product code uses Workspace; the Project contract is retired.',
  },
  {
    files: /^scripts\/.+\.(tsx?|mjs|js)$/,
    skip: /\.test\./,
    forbid: /['"]\/api\/projects['"]|listProjects\(/,
    message: 'Scripts set up jobs through Workspace, not /api/projects.',
  },
  {
    files: /^apps\/local-server\/src\/db\/jobs\.ts$/,
    forbid: /export function createJob[\s\S]*(?:project_id|projectId|\bProject\b)/,
    message: 'The live job write path must not write legacy Project columns.',
  },
  {
    files: /^services\/localGenerationRun\.ts$/,
    require: /workspaceId/,
    message: 'Local generation runs pass workspaceId.',
  },
  {
    files: /^packages\/shared\/src\/studioApiSchemas\.ts$/,
    require: /export const StudioWorkspaceSchema/,
    message: 'The shared API keeps StudioWorkspaceSchema.',
  },
  {
    files: /^packages\/shared\/src\/studioApiSchemas\.ts$/,
    require: /export const CreateJobRequestBoundarySchema/,
    message: 'The shared API keeps CreateJobRequestBoundarySchema.',
  },
];

const retiredFiles = [
  'services/localStudioService.ts',
  'apps/local-server/src/db.ts',
  'apps/local-server/src/dbStore.ts',
];

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && file !== self && existsSync(file));
const failures: string[] = [];

for (const rule of rules) {
  const scanned = files.filter((file) => rule.files.test(file) && !rule.skip?.test(file));
  // A rule that scans nothing has a stale path; fail instead of passing silently.
  if (scanned.length === 0) failures.push(`no files match ${rule.files} (${rule.message})`);
  for (const file of scanned) {
    const source = readFileSync(file, 'utf8');
    if (rule.forbid?.test(source) || (rule.require && !rule.require.test(source))) {
      failures.push(`${file}: ${rule.message}`);
    }
  }
}
for (const file of retiredFiles) {
  if (existsSync(file)) failures.push(`${file}: retired facade has returned.`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`[architecture:source] ${failures.length} violation(s)`);
  process.exit(1);
}
console.log(`[architecture:source] ok (${rules.length} rules, ${files.length} files)`);

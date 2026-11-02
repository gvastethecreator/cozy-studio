import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  base: './',
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 17222,
    host: '0.0.0.0',
    watch: {
      // Local runtime state, logs and agent worktrees are not app source. Watching them pinned
      // the dev server during extension builds and agent worktree checkouts.
      ignored: [
        '**/.claude/**',
        '**/.local/**',
        '**/.scratch/**',
        '**/.tmp/**',
        '**/tmp/**',
        '**/logs/**',
      ],
    },
  },
  preview: {
    port: 17222,
    host: '0.0.0.0',
  },
  build: {
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-runtime',
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
            },
            {
              // Shell code shared by the entry and lazy surfaces. Keeping it in one chunk keeps
              // the entry small however the lazy recipe graph changes.
              name: 'shell-shared',
              test: /[\\/](?:node_modules[\\/](?:tailwind-merge|clsx)[\\/]|lib[\\/](?:utils|gsapMotion|imagePanZoom)\.tsx?|contexts[\\/](?:GlobalContext|ToastUiContext|toastStore|RuntimeLogContext|runtimeLogStore)\.tsx?|hooks[\\/](?:useTheme|useImagePresentation)\.ts|components[\\/]CozyMascot\.tsx)(?:\?.*)?$/,
            },
            {
              name: 'styles-browser-support',
              test: (id: string) =>
                /[\\/]components[\\/]recipes[\\/](?:stylePresetManifests|styleLayerComposer|styleBrowserRenderPlan|useStyleComposition|styleCategoryIdentity|styleGridVirtualization|useStyleBrowserNavigation|useUserStyleLibrary)\.tsx?(?:\?.*)?$/.test(
                  id,
                ),
            },
          ],
        },
      },
    },
  },
  plugins: [...react(), ...tailwindcss()] as never,
  fmt: {
    semi: true,
    singleQuote: true,
  },
  lint: {
    plugins: ['oxc', 'typescript', 'react'],
    categories: {
      correctness: 'error',
    },
    env: {
      builtin: true,
    },
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      'no-control-regex': 'off',
      'no-unused-vars': 'off',
      'no-useless-escape': 'off',
    },
    ignorePatterns: [
      'dist/**',
      'landing/**',
      'generated/**',
      'logs/**',
      'output/**',
      'outputs/**',
      'tmp/**',
      '.tmp/**',
      '.tmp-*',
    ],
    overrides: [
      {
        files: ['**/*.{ts,tsx}'],
        rules: {
          'typescript/no-explicit-any': 'off',
          'typescript/no-unused-vars': 'off',
          'react/rules-of-hooks': 'error',
          'react/exhaustive-deps': 'off',
          'react/only-export-components': 'off',
          // The React Compiler diagnostics introduced by newer Oxlint are a separate
          // component migration; keep this upgrade on the existing lint contract.
          'react/set-state-in-effect': 'off',
          'react/refs': 'off',
          'react/immutability': 'off',
          'react/preserve-manual-memoization': 'off',
          'react/purity': 'off',
          'react/globals': 'off',
          'react/static-components': 'off',
        },
        env: {
          es2022: true,
          browser: true,
        },
      },
      {
        files: [
          'apps/local-server/src/**/*.ts',
          'scripts/**/*.ts',
          'electron/**/*.cjs',
          'utils/runtimeLogger.ts',
        ],
        rules: {
          'no-console': 'off',
        },
        env: {
          es2022: true,
          node: true,
        },
      },
      // Import boundaries. scripts/architecture-source-rules.ts holds the text rules that
      // import linting cannot express.
      {
        files: ['apps/local-server/src/**/*.{ts,tsx}'],
        excludeFiles: ['apps/local-server/src/providers/**', '**/*.test.{ts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  regex:
                    '(^|/)(providerInputCompiler|externalProviderResults|(google|fal|openaiImages|replicate|comfy|grokImagine|grokImagineHttp|grokRuntime|antigravityImage|chatgptResponsesImage)Executor)$',
                  message:
                    'Keep provider compilers and concrete executors behind apps/local-server/src/providers/.',
                },
              ],
            },
          ],
        },
      },
      {
        files: [
          'components/recipes/**/*.{ts,tsx}',
          'components/RecipesView.tsx',
          'components/RecipeRouter.tsx',
        ],
        excludeFiles: ['components/recipes/recipeModuleUi.ts', '**/*.test.{ts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  regex: '(^|/)providerInputCompiler$',
                  message: 'Recipe surfaces collect UI params only; providers compile inputs.',
                },
                {
                  regex:
                    '(^|/)(lib/recipeModules(/index|/taskSpec)?|packages/shared/src(/index|/generationContracts)?)$',
                  importNames: [
                    'buildGenerationTaskSpecFromRecipe',
                    'createGenerationTaskSpec',
                    'buildRecipeProviderDirectives',
                  ],
                  message:
                    'Recipe surfaces collect UI params only; Recipe Modules build task specs and provider directives.',
                },
              ],
            },
          ],
        },
      },
      {
        files: ['lib/studioCatalogView.ts', 'hooks/useCatalog.ts'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  regex: '(^|/)(catalogImageGenerationConfig|useIndexedDBStorage|GlobalContext)$',
                  message:
                    'Catalog View and useCatalog query Catalog Entries directly, not export adapters or retired browser batch state.',
                },
              ],
            },
          ],
        },
      },
      {
        // Startup surfaces: heavy vendors, route pages and GSAP dropdowns load on demand.
        files: [
          'utils/fileUtils.ts',
          'hooks/useCameraViewport.ts',
          'lib/gsapMotion.tsx',
          'components/shell/StudioViewport.tsx',
          'components/Toolbar.tsx',
          'components/HeaderToolbar.tsx',
          'components/ImageGrid.tsx',
          'components/header/WorkspaceStrip.tsx',
          'components/studio/StudioOperationsRail.tsx',
        ],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  regex: '^(jszip|three|gsap|@gsap/react)(/|$)',
                  importNamePattern: '.',
                  allowTypeImports: true,
                  message: 'Load ZIP, Three.js and GSAP with import() so they stay out of startup.',
                },
                {
                  regex:
                    '(^|/)(ui/GsapDropdown|studio/StudioGridSurface|RecipesView|RecipePage|QueuePanel)$',
                  importNamePattern: '.',
                  allowTypeImports: true,
                  message:
                    'Lazy-load route pages and the queue panel; use DemandMountedGsapDropdown for menus.',
                },
              ],
            },
          ],
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    '*.{ts,tsx,js,jsx,css,md,json}': 'vp check --fix',
  },
});

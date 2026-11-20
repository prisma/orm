const typescriptEslint = require('@typescript-eslint/eslint-plugin')
const jest = require('eslint-plugin-jest')
const simpleImportSort = require('eslint-plugin-simple-import-sort')
const _import = require('eslint-plugin-import-x')
const localRules = require('eslint-plugin-local-rules')
const path = require('path')

const globals = require('globals')
const tsParser = require('@typescript-eslint/parser')
const js = require('@eslint/js')

const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

const project = path.resolve(__dirname, 'tsconfig.json')

module.exports = [
  {
    files: ['**/*.ts'],
  },
  {
    ignores: [
      '.prisma',
      '.github',
      'target/**',
      'helpers/blaze/**',
      '**/dist/**',
      '**/declaration/**',
      '**/esm/**',
      '**/build/**',
      '**/fixtures/**',
      '**/__fixtures__/**',
      '**/generated/**',
      '**/.generated/**',
      '**/prism.ts',
      '**/charm.ts',
      '**/pnpm-lock.yaml',
      '**/generated-dmmf.ts',
      '**/packages/client/generator-build/**',
      '**/packages/client/declaration/**',
      '**/packages/client/runtime/**',
      '**/packages/client/src/__tests__/types/**',
      'packages/cli/config.js',
      'packages/cli/config.d.ts',
      'packages/prisma7/index.js',
      'packages/prisma7/index.d.ts',
      'packages/prisma7/config.js',
      'packages/prisma7/config.d.ts',
      'packages/client/scripts/default-index.js',
      '**/packages/cli/prisma-client/**',
      '**/packages/cli/install/**',
      '**/packages/cli/preinstall/**',
      'packages/cli/**/tmp-*',
      '**/sandbox/**',
    ],
  },
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
    'plugin:jest/recommended',
  ),
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
      jest,
      'simple-import-sort': simpleImportSort,
      import: _import,
      'local-rules': localRules,
    },

    languageOptions: {
      globals: {
        ...globals.node,
      },

      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',

      parserOptions: {
        project,
      },
    },

    settings: {
      jest: {
        version: 27,

        globalAliases: {
          describe: 'describeIf',
        },
      },
    },

    rules: {
      'prettier/prettier': 'warn',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      'eslint-comments/no-unlimited-disable': 'off',
      'eslint-comments/disable-enable-pair': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'jest/expect-expect': 'off',
      'no-empty': 'off',

      'no-restricted-properties': [
        'error',
        {
          property: 'substr',
          message: 'Deprecated: Use .slice() instead of .substr().',
        },
      ],

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // The `*-wasm` packages are wasm-pack output published to npm with their
              // `src/` directory intact, so a deep import into those is legitimate.
              group: ['@prisma/*/src/*', '@prisma/*/src/**', '!@prisma/*-wasm/src/**'],
              message:
                'Workspace packages publish only their build output, so this path does not exist once the package is installed from npm and the import throws MODULE_NOT_FOUND. Import from the package entry instead, e.g. `@prisma/internals`.',
            },
          ],
        },
      ],

      'jest/valid-title': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      'jest/no-conditional-expect': 'off',
      'jest/no-export': 'off',
      'jest/no-standalone-expect': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
    },
  },
  {
    files: ['./packages/client/src/runtime/core/types/exported/*.ts'],
    ignores: ['**/index.ts'],

    rules: {
      'local-rules/all-types-are-exported': 'error',
      'local-rules/imports-from-same-directory': 'error',
    },
  },
  {
    files: ['./packages/client/src/runtime/core/types/exported/index.ts'],

    rules: {
      'local-rules/valid-exported-types-index': 'error',
    },
  },
  {
    // Tests are never published, so they may reach into a package's src/ for
    // helpers that the package entry does not export.
    files: ['**/*.test.ts', '**/*.vitest.ts', '**/__tests__/**', '**/tests/**'],

    rules: {
      'no-restricted-imports': 'off',
    },
  },
]

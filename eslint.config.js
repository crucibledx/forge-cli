import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

export default tseslint.config(
    ...tseslint.configs.recommended,
    {
        plugins: {
            '@stylistic': stylistic,
            'simple-import-sort': simpleImportSort,
        },
        rules: {
            'semi': 'off',
            'quotes': 'off',
            '@stylistic/semi': ['error', 'never'],
            '@stylistic/quotes': ['error', 'single', {avoidEscape: true}],
            '@stylistic/indent': ['error', 4],
            '@stylistic/object-curly-spacing': ['error', 'never'],
            '@stylistic/comma-spacing': ['error', {before: false, after: true}],
            '@stylistic/member-delimiter-style': ['error', {
                multiline: {delimiter: 'none'},
                singleline: {delimiter: 'comma'},
            }],
            '@typescript-eslint/no-unused-vars': ['warn', {argsIgnorePattern: '^_'}],
            '@typescript-eslint/consistent-type-imports': ['error', {prefer: 'type-imports'}],
            'simple-import-sort/imports': ['error', {
                groups: [
                    // Side-effect imports
                    ['^\\u0000'],
                    // Node builtins
                    ['^node:'],
                    // External packages
                    ['^[a-z@](?!domain|application|infrastructure)'],
                    // Internal aliases — namespace/default imports before named
                    ['^@domain', '^@application', '^@infrastructure'],
                    // Relative imports
                    ['^\\.'],
                ],
            }],
            'simple-import-sort/exports': 'error',
        },
    },
    {
        ignores: ['dist/', 'node_modules/'],
    },
)

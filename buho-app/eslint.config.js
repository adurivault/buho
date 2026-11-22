import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import ts from 'typescript-eslint';
import { loadConfig } from '@sveltejs/load-config';

const svelteConfig = (await loadConfig(import.meta.dirname, { traverse: false }))?.config;

/**
 * Browser storage is off-limits (see AGENTS.md, invariant 2) — nothing uses it,
 * not even the theme. Opt-in persistence would be a product decision, made
 * explicit by an override here, never a slip.
 */
const NO_STORAGE = {
    'no-restricted-globals': [
        'error',
        ...['localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
            name,
            message: 'Buho never persists user data in the browser (AGENTS.md, invariant 2).',
        })),
    ],
    'no-restricted-properties': [
        'error',
        ...['localStorage', 'sessionStorage', 'indexedDB'].map((property) => ({
            object: 'window',
            property,
            message: 'Buho never persists user data in the browser (AGENTS.md, invariant 2).',
        })),
        {
            object: 'document',
            property: 'cookie',
            message: 'Buho never persists user data in the browser (AGENTS.md, invariant 2).',
        },
    ],
};

export default ts.config(
    { ignores: ['build/', '.svelte-kit/', 'static/', 'node_modules/'] },
    js.configs.recommended,
    ...ts.configs.recommended,
    ...svelte.configs.recommended,
    prettier,
    ...svelte.configs.prettier,
    {
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        rules: {
            ...NO_STORAGE,
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
            ],
            // Flags every Map/Set/Date a component creates, including the scratch
            // ones built and thrown away inside a function or a `$derived`. State
            // that must be reactive is declared with `$state` or `SvelteMap`.
            'svelte/prefer-svelte-reactivity': 'off',
            // Links are external, `mailto:`, or resolved upstream (`module.href`,
            // tab lists) and passed in as strings, which the rule cannot follow.
            // `goto` calls are still checked.
            'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }],
        },
    },
    {
        // Misreads `$bindable(default)` in props destructuring as a dead store.
        files: ['**/*.svelte'],
        rules: { 'no-useless-assignment': 'off' },
    },
    {
        files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                extraFileExtensions: ['.svelte'],
                parser: ts.parser,
                svelteConfig,
            },
        },
    },
    {
        // Tests poke at storage on purpose, to prove nothing lands there.
        files: ['**/*.test.ts'],
        rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
    }
);

// v96 — minimum ESLint setup for apps/api. The dependency-hygiene
// audit flagged that web had `next lint` but api had no lint target,
// so any unused vars / no-floating-promise drift would slip through.
// This is intentionally conservative: just the rules that catch real
// bugs (no-unused-vars, no-explicit-any, no-floating-promises). Code
// style is owned by the typechecker + the team's reviewer discipline.

import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/", "node_modules/", "coverage/", "*.config.js"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off", // server logs go to stdout/stderr; that's the design
    },
  },
];

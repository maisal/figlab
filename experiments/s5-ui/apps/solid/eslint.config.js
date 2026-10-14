// ESLint settings: the same rules as the repository (eslint.config.js at the root), plus the framework's lint plugin.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid/configs/typescript";

export default defineConfig(
  { ignores: ["dist/"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, solid],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Solid assigns refs in compiled JSX (`let el!: HTMLDivElement; <div ref={el} />`).
      // ESLint cannot see that assignment, so this rule gives false errors.
      "no-unassigned-vars": "off",
    },
  },
);

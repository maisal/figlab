// ESLint settings: the same rules as the repository (eslint.config.js at the root), plus the framework's lint plugin.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";

export default defineConfig(
  { ignores: ["dist/"] },
  {
    files: ["**/*.ts", "**/*.svelte"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, svelte.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
);

// ESLint settings: the same rules as the repository (eslint.config.js at the root).
// No framework plugin: Preact has no lint plugin of its own, and the React template's
// eslint-plugin-react-hooks is not used here (experiments/s5-ui/README.md "TypeScript and lint").
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);

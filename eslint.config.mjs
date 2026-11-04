import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "@next/eslint-plugin-next";
import hooks from "eslint-plugin-react-hooks";
export default defineConfig([
  { files: ["**/*.mjs"], extends: [js.configs.recommended], languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", fetch: "readonly", AbortSignal: "readonly", setTimeout: "readonly" } } },
  { files: ["**/*.{ts,tsx}"], extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "@next/next": next, "react-hooks": hooks },
    rules: { ...next.configs.recommended.rules, ...next.configs["core-web-vitals"].rules,
      "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" },
  },
  globalIgnores([
  ".next/**", "next-env.d.ts", "playwright-report/**", "test-results/**", ".local/**",
  "apps/jarvis-browser-bridge/dist/**", "apps/jarvis-mac-companion/.build/**",
])]);

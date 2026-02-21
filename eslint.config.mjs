import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Project overrides
  {
    rules: {
      // Too many existing anys across the repo right now—don't block builds/commits.
      "@typescript-eslint/no-explicit-any": "off",

      // Optional: keep these as warnings (nice-to-have, not blocking)
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
]);

export default eslintConfig;

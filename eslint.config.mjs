import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // SQLite row shapes, MediaDeviceInfo, and several ZBar/Zxing APIs
    // don't have useful types. Forcing strict typing on them costs hours
    // and produces type assertions that aren't actually safer. Lint
    // enforcement is for catching real bugs, not for ceremony.
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Catch handlers commonly use `(e)` even when they don't reference
      // the variable. Allow underscore-prefixed args to be unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",             // compiled custom server (tsc output)
    "next-env.d.ts",
    "scripts/**",          // tsx scripts don't need to match app lint
    "public/a.out.js",     // ZBar WASM bridge — not our code
  ]),
]);

export default eslintConfig;

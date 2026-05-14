import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "logs/**",
      "uploads/**",
      "coverage/**",
      "migrations/**",
      "scripts/**",
      "tests/**",
      "*.config.js",
      "*.config.cjs",
      "*.config.ts",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // High-value bug catchers:
      // Forgotten `await` is the most common cause of silent data corruption
      // in Express handlers. This rule catches it at lint time.
      "@typescript-eslint/no-floating-promises": "error",
      // Catches `app.use(async (req, res) => ...)` where the handler returns
      // a rejected promise that Express can't see.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
      // console.* should go through the Winston logger. Intentional consoles
      // in negotiation-logger.ts (dev pretty-print), index.ts (crash handlers),
      // and seeders/ get per-file overrides below.
      "no-console": "error",
      "no-unused-vars": "off", // handled by tsconfig now
      "@typescript-eslint/no-unused-vars": "off", // ditto
    },
  },
  {
    files: [
      "src/modules/chatbot/engine/negotiation-logger.ts",
      "src/index.ts",
      "src/seeders/**/*.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
];

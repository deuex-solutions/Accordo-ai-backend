// See LOGGING.md at the repo root for the convention.
// `no-console` is a hard error: import `logger` from `src/config/logger.ts` instead.
// Exceptions are explicitly allow-listed below.
export default [
  {
    ignores: ["node_modules/**", "logs/**", "dist/**"],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "error",
    },
  },
  // Allow console.* in places where the logger isn't usable.
  {
    files: [
      // Runs before the logger is initialized
      "src/config/env.ts",
      // CLI seeders that print to stdout for the developer running them
      "src/seeders/**/*.ts",
      // Intentional pretty-printed dev debug
      "src/modules/chatbot/engine/negotiation-logger.ts",
      // Utility scripts run from the CLI
      "src/scripts/**/*.ts",
      "scripts/**/*.{ts,cjs,mjs,js}",
    ],
    rules: {
      "no-console": "off",
    },
  },
];

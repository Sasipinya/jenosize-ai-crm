import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // pglite boots a real Postgres in WASM and runs migrations per file.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

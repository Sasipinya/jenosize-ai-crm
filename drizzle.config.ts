// drizzle-kit config: only used to generate SQL migrations from the schema.
// Migrations are applied by scripts/migrate.ts (real DB) or tests/helpers/test-db.ts (pglite).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
});

// pnpm db:migrate — apply SQL migrations in /drizzle to DATABASE_URL (or MIGRATION_DATABASE_URL).
import { main, runMigrations } from "./lib/db-cli";

main(runMigrations);

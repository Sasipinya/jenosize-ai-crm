// pnpm db:setup — one command: migrate, then seed (ADR 005). Safe to re-run.
import { main, runMigrations, runSeed } from "./lib/db-cli";

main(async () => {
  await runMigrations();
  await runSeed();
});

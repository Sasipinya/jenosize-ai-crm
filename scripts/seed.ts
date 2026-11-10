// pnpm db:seed — insert synthetic Thai demo data. Skips if the DB already has users.
import { main, runSeed } from "./lib/db-cli";

main(runSeed);

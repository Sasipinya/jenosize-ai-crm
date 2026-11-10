// Zod schema for the login form / credentials provider input.
import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),
  password: z.string().min(1).max(200),
});

export type Credentials = z.infer<typeof credentialsSchema>;

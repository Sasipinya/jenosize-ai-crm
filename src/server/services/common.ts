// Shared service helpers: transaction type, paging, LIKE escaping and unique-violation detection.
import type { Db } from "../db/client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export const PAGE_SIZE = 20;

/** Escapes % _ \ so user text is matched literally inside ILIKE. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Postgres error code, also when Drizzle wraps the driver error in `cause`. */
export function pgCode(err: unknown): string | undefined {
  const code = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined);
  const cause = typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return code(err) ?? code(cause);
}

/** Log-safe summary of an unknown error. Never uses `message`: Drizzle query errors embed bound params (PII). */
export function safeErr(err: unknown): { name: string; code?: string } {
  return { name: err instanceof Error ? err.name : "unknown", code: pgCode(err) };
}

/** True for Postgres unique_violation (23505), also when Drizzle wraps it in `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined);
  const cause = typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return code(err) === "23505" || code(cause) === "23505";
}

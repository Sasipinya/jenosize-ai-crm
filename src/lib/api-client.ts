// Browser helper for our own JSON API: returns data or a readable error message, never throws.
export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

export async function callApi<T = unknown>(url: string, method: "POST" | "PATCH", body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
    if (!res.ok) return { ok: false, message: json?.error?.message ?? `Request failed (${res.status})` };
    return { ok: true, data: json?.data as T };
  } catch {
    return { ok: false, message: "Network error, please try again" };
  }
}

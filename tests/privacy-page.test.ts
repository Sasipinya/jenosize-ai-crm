// /privacy is public: the route guard lets an anonymous request through, other pages still redirect to /login,
// and the page renders both languages with the deletion route (reply in the LINE chat).
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-proxy-tests-only";
});

const anonymous = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("GET /privacy without login", () => {
  it("passes the route guard (no redirect, no 401)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(anonymous("/privacy"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1"); // NextResponse.next(): handled by the page
  });

  it("control: a private page still redirects to /login and a private API still returns 401", async () => {
    const { proxy } = await import("@/proxy");
    const page = await proxy(anonymous("/leads"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    const api = await proxy(anonymous("/api/leads"));
    expect(api.status).toBe(401);
  });

  it("only /privacy itself is public: look-alike paths still go through the guard", async () => {
    const { proxy } = await import("@/proxy");
    for (const path of ["/privacyx", "/privacy-foo"]) {
      const res = await proxy(anonymous(path));
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
    }
  });

  it("the page renders Thai and English, with deletion by replying in the LINE chat", async () => {
    const { default: PrivacyPage } = await import("@/app/privacy/page");
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    expect(html).toContain('lang="th"');
    expect(html).toContain('lang="en"');
    expect(html).toContain("แชท LINE");
    expect(html).toContain("Reply in the LINE chat");
    expect(html).toContain("within 30 days of your request"); // the owner's retention decision
    expect(html).toContain("ภายใน 30 วัน");
    expect(html).toContain("does not delete data automatically"); // honest about what is not built
  });
});

import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitizeHtml";

describe("sanitizeHtml", () => {
  it("removes unsafe tags and inline handlers", () => {
    const input =
      `<p onclick="evil()">hello</p>` +
      `<script>alert("x")</script>` +
      `<iframe src="https://example.com"></iframe>`;
    const output = sanitizeHtml(input);

    expect(output).toContain("<p");
    expect(output).toContain("hello");
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<iframe");
    expect(output).not.toContain("onclick");
  });

  it("removes dangerous URL protocols and keeps safe links", () => {
    const input =
      `<a href="javascript:alert(1)">bad</a>` +
      `<a href="https://example.com/docs">good</a>`;
    const output = sanitizeHtml(input);

    expect(output).not.toContain("javascript:");
    expect(output).toContain(`href="https://example.com/docs"`);
  });

  it("returns empty string for blank input", () => {
    expect(sanitizeHtml("   ")).toBe("");
  });
});

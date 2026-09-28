import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/recipes", async () => (await import("@/test/curated")).curatedModule);

async function get(query: string) {
  const res = await GET(new Request(`http://localhost/api/og${query}`));
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("GET /api/og", () => {
  it("renders a 1200 by 630 PNG with a long public cache", async () => {
    const { res, bytes } = await get("?g=2&d=2&r=desk&o=exorcist");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });

  it("renders the plain card for bad or missing values", async () => {
    const plain = (await get("")).bytes;
    for (const query of [
      "?t=jevs",
      "?g=99&d=3",
      "?g=3",
      "?g=3&d=3&r=nosuch&o=exorcist",
      "?g=3&d=3&r=desk",
      "?g=3&d=3&o=exorcist",
      "?g=3&d=3&r=desk&o=nosuch",
      "?g=3&d=3&r=desk&r=desk&o=exorcist",
    ]) {
      expect((await get(query)).bytes, query).toEqual(plain);
    }
  });

  it("draws a curated outcome, and It jevs. for a generated recipe, differently from the plain card", async () => {
    const plain = (await get("")).bytes;
    const curated = (await get("?g=2&d=2&r=desk&o=exorcist")).bytes;
    const other = (await get("?g=2&d=2&r=desk&o=evacuate")).bytes;
    const generated = (await get("?g=2&d=2")).bytes;
    expect(curated).not.toEqual(plain);
    expect(generated).not.toEqual(plain);
    expect(curated).not.toEqual(generated);
    expect(curated).not.toEqual(other);
  });
});

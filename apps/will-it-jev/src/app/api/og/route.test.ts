import { describe, expect, it } from "vitest";
import { GET } from "./route";

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
    const { res, bytes } = await get("?t=nope&g=3&d=3&r=tonight");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });

  it("renders the plain card for bad or missing values", async () => {
    const plain = (await get("")).bytes;
    for (const query of ["?t=great&g=99", "?t=nope&g=3", "?t=nope&g=3&d=3&r=nosuch", "?t=nope&g=3&d=3&r=tonight&r=tonight"]) {
      expect((await get(query)).bytes, query).toEqual(plain);
    }
    expect((await get("?t=nope&g=3&d=3&r=tonight")).bytes).not.toEqual(plain);
  });
});

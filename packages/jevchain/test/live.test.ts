/**
 * Hits the real TypeSafe API. Skipped unless TYPESAFE_API_KEY is set.
 * Run with: TYPESAFE_API_KEY=... pnpm test test/live.test.ts
 */
import { describe, expect, it } from "vitest";
import { choice, createJev, emit, gate, noul, parallel, ask, route } from "../src/index.js";

const key = process.env.TYPESAFE_API_KEY;

describe.skipIf(!key)("live: TypeSafe API", () => {
  const jev = createJev();

  it("routes a haunted appliance to the exorcist", async () => {
    const desk = route("desk", {
      ask: choice("Which team should handle this support ticket?", {
        billing: "payments, refunds, invoices",
        bug: "a software defect in the product",
        exorcism: "paranormal or supernatural activity",
      }),
      branches: {
        billing: emit("billing"),
        bug: emit("bug"),
        exorcism: gate("urgent", { ask: noul("Is the customer in immediate danger?"), pass: { min: 0.5 }, then: emit("send the priest now"), otherwise: emit("book a priest") }),
      },
    });
    const r = await jev.run(desk, "My toaster whispers my name at 3am and the bread comes out cold.");
    expect(r.status).toBe("ok");
    expect(r.trace.spans[0]!.decision!.taken).toBe("exorcism");
    expect(r.trace.models[0]).toMatch(/^jev-/);
    expect(r.trace.usage.inputTokens).toBeGreaterThan(0);
  }, 20_000);

  it("batches a parallel fan-out into one request", async () => {
    const p = parallel("vibe-check", {
      branches: {
        drama: ask("drama", { questions: { d: noul("Is there interpersonal drama here?") } }),
        tone: ask("tone", { questions: { t: choice("Tone?", ["friendly", "passive-aggressive", "hostile"]) } }),
      },
    });
    const r = await jev.run(p, "k. whatever. do what you want, you always do.");
    expect(r.status).toBe("ok");
    expect(r.trace.usage.requests).toBe(1);
    expect(r.trace.usage.calls).toBe(2);
  }, 20_000);
});

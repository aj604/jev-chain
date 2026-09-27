import { choice, noul, score } from "jevchain";
import { describe, expect, it } from "vitest";
import { answerFor, byQuestion, fakeJev } from "./fake-jev";

describe("answerFor", () => {
  it("says 0.1 to a noul", () => {
    expect(answerFor(noul("Is it?"))).toEqual({ type: "noul", noul: 0.1 });
  });

  it("says level 0 to a score", () => {
    expect(answerFor(score("How much?", ["low", "mid", "high"]))).toMatchObject({
      type: "score",
      score: 0,
      probabilities: { "0": 1, "1": 0, "2": 0 },
    });
  });

  it("picks a choice's first label at 0.9, the rest sharing 0.1", () => {
    const answer = answerFor(choice("Which?", ["a", "b", "c"]));
    expect(answer).toMatchObject({ type: "choice", choice: "a" });
    expect(answer.type === "choice" && answer.probabilities).toEqual({ a: 0.9, b: 0.05, c: 0.05 });
  });

  it("moves the 0.9 to an overridden choice", () => {
    const answer = answerFor(choice("Which?", ["a", "b"]), { choice: "b" });
    expect(answer).toMatchObject({ type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.9 } });
  });
});

describe("byQuestion", () => {
  it("matches a key inside the instructions, longest key first", () => {
    const oracle = byQuestion({ "gate 1": { noul: 0.2 }, "gate 10?": { noul: 0.8 } });
    expect(oracle(noul("Does it stop at gate 10?"))).toEqual({ noul: 0.8 });
    expect(oracle(noul("Does it stop at gate 1?"))).toEqual({ noul: 0.2 });
    expect(oracle(noul("Something else?"))).toBeUndefined();
  });
});

describe("fakeJev", () => {
  it("answers through the real client and records each request", async () => {
    const { client, requests } = fakeJev(byQuestion({ "Is it?": { noul: 0.7 } }));
    const result = await client.ask("the state", { a: noul("Is it?"), b: noul("Is it not?") });
    expect(result.answers).toEqual({ a: { type: "noul", noul: 0.7 }, b: { type: "noul", noul: 0.1 } });
    expect(requests).toEqual([
      {
        state: "the state",
        questions: { a: { type: "noul", instructions: "Is it?" }, b: { type: "noul", instructions: "Is it not?" } },
      },
    ]);
  });

  it("batches same-tick asks into one request", async () => {
    const { client, requests } = fakeJev();
    await Promise.all([client.ask("s", { a: noul("A?") }), client.ask("s", { b: noul("B?") })]);
    expect(requests).toHaveLength(1);
  });

  it("fails every request with the given status, without retrying", async () => {
    const { client, requests } = fakeJev(undefined, { status: 503 });
    await expect(client.ask("s", { a: noul("A?") })).rejects.toMatchObject({ status: 503 });
    expect(requests).toHaveLength(1);
  });

  it("fails with a given body instead of the default one", async () => {
    const body = { error: { type: "paused", message: "Paused." } };
    const { client } = fakeJev(undefined, { status: 503, body });
    await expect(client.ask("s", { a: noul("A?") })).rejects.toMatchObject({ status: 503, body });
  });
});

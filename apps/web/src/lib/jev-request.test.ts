import { describe, expect, it } from "vitest";
import { MAX_QUESTIONS, validateJevRequest } from "./jev-request";

const ok = {
  state: "my toaster whispers my name",
  model: "jev-latest",
  questions: { x: { type: "noul", instructions: "Is this a bug report?" } },
};

describe("validateJevRequest", () => {
  it("accepts a well-formed body", () => {
    expect(validateJevRequest(ok)).toEqual({ ok: true, body: ok });
  });

  it.each([
    ["an object", { me: "Sam", messages: [{ from: "Priya", text: "brunch?" }] }],
    ["an array", ["one", "two"]],
  ])("accepts JSON state: %s", (_, state) => {
    expect(validateJevRequest({ ...ok, state }).ok).toBe(true);
  });

  it.each([
    ["non-object", []],
    ["missing state", { ...ok, state: "" }],
    ["empty object state", { ...ok, state: {} }],
    ["null state", { ...ok, state: null }],
    ["numeric state", { ...ok, state: 42 }],
    ["missing model", { ...ok, model: 3 }],
    ["questions array", { ...ok, questions: [] }],
    ["empty questions", { ...ok, questions: {} }],
    ["question without type", { ...ok, questions: { x: { instructions: "?" } } }],
  ])("rejects %s", (_, body) => {
    expect(validateJevRequest(body).ok).toBe(false);
  });

  it(`caps questions at ${MAX_QUESTIONS}`, () => {
    const questions = Object.fromEntries(
      Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => [`q${i}`, { type: "noul", instructions: "?" }]),
    );
    expect(validateJevRequest({ ...ok, questions }).ok).toBe(false);
  });
});

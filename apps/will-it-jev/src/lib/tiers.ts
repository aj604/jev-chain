/** The three verdicts, best first. */
export const TIERS = ["jevs", "kinda", "nope"] as const;

export type Tier = (typeof TIERS)[number];

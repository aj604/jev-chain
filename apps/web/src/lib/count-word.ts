const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/**
 * A small count as copy writes it: "six", or "Six" to start a sentence.
 * Counts past twelve stay as digits.
 */
export function countWord(n: number, { capital = false }: { capital?: boolean } = {}): string {
  const word = WORDS[n] ?? String(n);
  return capital ? word[0]!.toUpperCase() + word.slice(1) : word;
}

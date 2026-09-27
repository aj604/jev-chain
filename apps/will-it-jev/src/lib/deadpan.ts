/**
 * The site's voice is flat. Returns the first rule `text` breaks, as a
 * lowercase message, or null when it reads fine. Rules are checked in order.
 */
export function toneIssue(text: string): string | null {
  if (text.includes("!")) return "no exclamation marks. keep it flat";
  if (/\p{Extended_Pictographic}/u.test(text)) return "no emoji";
  if (/\b(lol|lmao)\b/i.test(text)) return "no lol";
  return null;
}

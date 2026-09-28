import { ogImage } from "@/lib/og-image";
import { parseShareQuery } from "@/lib/share";

export const runtime = "nodejs";

/** The share preview image, from the query string alone. Bad or missing values give the plain card. */
export function GET(req: Request) {
  return ogImage(parseShareQuery(new URL(req.url).searchParams));
}

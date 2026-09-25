import { example as hauntedDesk } from "./haunted-desk";
import { example as groupChatDrama } from "./group-chat-drama";
import { example as textThemBack } from "./text-them-back";
import { example as meetingEmail } from "./meeting-email";
import { example as prHoroscope } from "./pr-horoscope";
import type { Example } from "./types";

export type { Example } from "./types";

/** Every example, in gallery order. */
export const examples: Example[] = [hauntedDesk, groupChatDrama, textThemBack, meetingEmail, prHoroscope];

export function getExample(slug: string): Example | undefined {
  return examples.find((e) => e.slug === slug);
}

import type { Metadata } from "next";
import { ShareView } from "@/components/studio/share-view";

export const metadata: Metadata = {
  title: "shared run",
  description: "A jevchain run, shared by link: every decision, every probability, every branch not taken.",
};

export default function SharePage() {
  return <ShareView />;
}

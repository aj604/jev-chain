import type { Metadata } from "next";
import { COPY } from "@/lib/copy";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: COPY.siteTitle, template: `%s · ${COPY.siteTitle}` },
  description: COPY.tagline,
  applicationName: COPY.siteTitle,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

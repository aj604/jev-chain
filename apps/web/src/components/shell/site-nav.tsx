"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useByok } from "@/lib/use-byok";
import { cn } from "@/lib/cn";
import { useShell } from "./shell-provider";
import { ThemeToggle } from "./theme-toggle";

export const GITHUB_URL = "https://github.com/aj604/jev-chain";

const LINKS = [
  { href: "/studio", label: "studio", key: "s" },
  { href: "/examples", label: "examples", key: "e" },
  { href: "/docs", label: "docs", key: "d" },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const byok = useByok();
  const { openKeyDialog, openShortcuts } = useShell();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  // close the mobile menu on navigation
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-hard-b bg-paper/90 backdrop-blur-sm supports-[backdrop-filter]:bg-paper/80">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-2 focus:z-50 focus:border-hard focus:bg-paper focus:px-3 focus:py-1.5 focus:font-mono focus:text-xs"
      >
        skip to content
      </a>
      <nav aria-label="main" className="mx-auto flex h-(--nav-h) max-w-[88rem] items-stretch px-4 sm:px-6">
        <Link href="/" aria-label="jevchain home" className="flex items-center pr-5 sm:border-hard-r sm:pr-6">
          <Logo />
        </Link>

        <ul className="hidden items-stretch sm:flex">
          {LINKS.map((l) => (
            <li key={l.href} className="flex">
              <Link
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-2 px-4 font-mono text-[13px] lowercase transition-colors duration-(--dur-fast)",
                  isActive(l.href) ? "text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {isActive(l.href) && <span aria-hidden className="size-1.5 bg-accent" />}
                {l.label}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-3 -bottom-px h-[2px] transition-colors duration-(--dur-fast)",
                    isActive(l.href) ? "bg-ink" : "bg-transparent group-hover:bg-line-soft",
                  )}
                />
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-1">
          <span className="hidden md:contents">
          <Tooltip label="keyboard shortcuts · ?">
            <Button variant="ghost" size="icon" aria-label="keyboard shortcuts" onClick={openShortcuts}>
              <Kbd className="border-0 bg-transparent shadow-none">?</Kbd>
            </Button>
          </Tooltip>
          </span>
          <span className="hidden sm:contents">
          <Tooltip label="source on github">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="jevchain on github"
              className="grid size-8 place-items-center text-ink-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink"
            >
              <GithubIcon />
            </a>
          </Tooltip>
          </span>
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={openKeyDialog}
            aria-label={byok ? "api key settings (using your key)" : "api key settings"}
            className="ml-1.5"
          >
            <span aria-hidden className={cn("size-1.5", byok ? "bg-accent" : "border-(length:--bw) border-ink-3")} />
            key
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-1 sm:hidden"
            aria-label={menuOpen ? "close menu" : "open menu"}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
              {menuOpen ? <path d="M3 3l10 10M13 3L3 13" /> : <path d="M2 4.5h12M2 8h12M2 11.5h12" />}
            </svg>
          </Button>
        </div>
      </nav>

      <div id={menuId} hidden={!menuOpen} className="border-hard-t bg-paper sm:hidden">
        <ul className="px-4 py-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between border-soft-b py-3 font-mono text-sm lowercase last:border-0",
                  isActive(l.href) ? "text-ink" : "text-ink-2",
                )}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-1.5", isActive(l.href) ? "bg-accent" : "bg-transparent")} />
                  {l.label}
                </span>
                <span aria-hidden className="text-ink-3">→</span>
              </Link>
            </li>
          ))}
          <li>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center justify-between py-3 font-mono text-sm lowercase text-ink-2"
            >
              <span className="flex items-center gap-2 pl-3.5">github</span>
              <span aria-hidden className="text-ink-3">↗</span>
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { DOC_PAGES, DOC_SECTIONS, docHref } from "@/docs/nav";
import { useHotkey } from "@/lib/hotkeys";
import { cn } from "@/lib/cn";

interface Hit {
  href: string;
  page: (typeof DOC_PAGES)[number];
  heading?: string;
}

/** Title and heading matches, pages first. Every word must match somewhere. */
function search(query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const pages: Hit[] = [];
  const headings: Hit[] = [];
  for (const page of DOC_PAGES) {
    if (has(`${page.title} ${page.nav ?? ""} ${page.section}`)) pages.push({ href: docHref(page.slug), page });
    // "unsure" finds the heading; "gate unsure" too. Plain "gate" finds the page, not all of its headings.
    const titleAlone = has(page.title);
    for (const h of page.headings) {
      if (has(h.title) || (!titleAlone && has(`${page.title} ${h.title}`))) {
        headings.push({ href: docHref(page.slug, h.id), page, heading: h.title });
      }
    }
  }
  return [...pages, ...headings].slice(0, 12);
}

export function DocsSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navId = useId();
  const listId = useId();

  // close the mobile drawer on navigation
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const hits = useMemo(() => search(query), [query]);
  const current = DOC_PAGES.find((p) => docHref(p.slug) === pathname);

  useHotkey(
    "/",
    () => {
      setOpen(true);
      // the drawer may need a frame to un-hide on mobile
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    { description: "search the docs", group: "docs" },
  );

  const go = (href: string) => {
    setQuery("");
    inputRef.current?.blur();
    router.push(href);
  };

  return (
    <div className="lg:sticky lg:top-(--nav-h) lg:h-[calc(100dvh-var(--nav-h))] lg:overflow-y-auto lg:py-8 lg:pr-6">
      {/* mobile toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={navId}
        className="flex w-full items-center justify-between border-hard bg-paper px-3 py-2.5 font-mono text-[13px] lowercase lg:hidden"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="text-ink-3">docs /</span>
          <span className="truncate text-ink">{current ? (current.nav ?? current.title) : "menu"}</span>
        </span>
        <span aria-hidden className="text-ink-3">{open ? "close ×" : "menu ≡"}</span>
      </button>

      <div id={navId} className={cn("mt-2 border-hard bg-paper p-3 lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0", !open && "hidden")}>
        <div className="relative">
          <label htmlFor={`${listId}-q`} className="sr-only">
            search the docs
          </label>
          <input
            ref={inputRef}
            id={`${listId}-q`}
            type="search"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="search docs"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (query) setQuery("");
                else e.currentTarget.blur();
                e.preventDefault();
              } else if (e.key === "ArrowDown" && hits.length) {
                setActive((a) => (a + 1) % hits.length);
                e.preventDefault();
              } else if (e.key === "ArrowUp" && hits.length) {
                setActive((a) => (a - 1 + hits.length) % hits.length);
                e.preventDefault();
              } else if (e.key === "Enter" && hits[active]) {
                go(hits[active].href);
                e.preventDefault();
              }
            }}
            className="h-9 w-full border-hard bg-surface pr-9 pl-3 font-mono text-[13px] text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-offset-0 focus:outline-accent [&::-webkit-search-cancel-button]:hidden"
          />
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>

        {query ? (
          <div className="mt-4">
            {hits.length ? (
              <ul id={listId} role="listbox" aria-label="search results" className="space-y-px">
                {hits.map((h, i) => (
                  <li key={h.href} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                    <Link
                      href={h.href}
                      onClick={() => setQuery("")}
                      onMouseEnter={() => setActive(i)}
                      className={cn(
                        "flex flex-col px-2.5 py-2 transition-colors duration-(--dur-fast)",
                        i === active ? "bg-accent-wash" : "hover:bg-surface-2",
                      )}
                    >
                      <span className={cn("text-[13.5px] text-ink", h.page.mono && !h.heading && "font-mono text-[13px]")}>
                        {h.heading ?? h.page.nav ?? h.page.title}
                      </span>
                      <span className="font-mono text-[11px] lowercase text-ink-3">
                        {h.heading ? `in ${h.page.nav ?? h.page.title}` : h.page.section}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 py-2 text-[13px] text-ink-3">
                p(match) = 0.00. try &ldquo;gate&rdquo; or &ldquo;batch&rdquo;.
              </p>
            )}
            <p className="mt-3 hidden px-1 font-mono text-[10.5px] text-ink-3 lg:block">↑↓ to move · ↵ to open · esc to clear</p>
          </div>
        ) : (
          <nav aria-label="docs" className="mt-6 space-y-7">
            {DOC_SECTIONS.map((section) => (
              <div key={section.title}>
                <div className="mb-2 flex items-center gap-2 font-mono text-[11px] lowercase tracking-wide text-ink-3">
                  <span aria-hidden className="size-1 bg-ink-3" />
                  {section.title}
                </div>
                <ul className="border-soft-l">
                  {section.pages.map((p) => {
                    const href = docHref(p.slug);
                    const isActive = pathname === href;
                    return (
                      <li key={p.slug}>
                        <Link
                          href={href}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "-ml-(--bw) flex items-center border-l-2 py-1.5 pl-3.5 transition-colors duration-(--dur-fast)",
                            p.mono ? "font-mono text-[13px]" : "text-[14px]",
                            isActive
                              ? "border-accent bg-accent-wash text-ink"
                              : "border-transparent text-ink-2 hover:border-ink-3 hover:text-ink",
                          )}
                        >
                          {p.nav ?? p.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

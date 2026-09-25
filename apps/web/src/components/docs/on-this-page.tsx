"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

interface Item {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Right-rail table of contents. Reads the rendered headings (so it can never
 * disagree with the page) and highlights the one you're reading.
 */
export function OnThisPage() {
  const pathname = usePathname();
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const root = document.querySelector("[data-doc-content]");
    if (!root) return;
    const els = [...root.querySelectorAll<HTMLElement>("h2[id], h3[id]")];
    // Heading text minus the trailing "#" anchor.
    const found = els.map((el) => ({
      id: el.id,
      text: (el.firstChild?.textContent ?? el.textContent ?? "").replace(/#$/, "").trim(),
      level: (el.tagName === "H3" ? 3 : 2) as 2 | 3,
    }));
    // Sync with the DOM after navigation; the DOM is the source of truth here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(found);
    setActive(found[0]?.id ?? null);

    const update = () => {
      // The last heading above the top ~third of the viewport is "current".
      const line = window.innerHeight * 0.3;
      let current = found[0]?.id ?? null;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      // At the very bottom, the last heading wins even if it never reaches the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = found.at(-1)?.id ?? current;
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname]);

  if (items.length < 2) return null;

  return (
    <nav aria-label="on this page" className="sticky top-(--nav-h) max-h-[calc(100dvh-var(--nav-h))] overflow-y-auto py-8">
      <div className="mb-3 font-mono text-[11px] lowercase tracking-wide text-ink-3">on this page</div>
      <ul className="space-y-px border-soft-l">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              aria-current={active === it.id ? "location" : undefined}
              className={cn(
                "-ml-(--bw) block border-l-2 py-1 text-[13px] leading-snug transition-colors duration-(--dur-fast)",
                it.level === 3 ? "pl-6" : "pl-3",
                active === it.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {it.text}
            </a>
          </li>
        ))}
      </ul>
      <a
        href="#main"
        className="mt-6 inline-block font-mono text-[11px] lowercase text-ink-3 hover:text-ink"
        onClick={(e) => {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        ↑ back to top
      </a>
    </nav>
  );
}

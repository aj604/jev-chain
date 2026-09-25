"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { HotkeysProvider, useHotkey } from "@/lib/hotkeys";
import { toggleTheme } from "@/lib/theme";
import { KeyDialog } from "./key-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";

interface ShellApi {
  openKeyDialog: () => void;
  openShortcuts: () => void;
}

const ShellContext = createContext<ShellApi | null>(null);

/** Open app-wide dialogs from anywhere: `const { openKeyDialog } = useShell()`. */
export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [keyOpen, setKeyOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const api = useMemo<ShellApi>(
    () => ({ openKeyDialog: () => setKeyOpen(true), openShortcuts: () => setHelpOpen(true) }),
    [],
  );

  return (
    <HotkeysProvider>
      <ShellContext.Provider value={api}>
        <GlobalHotkeys onHelp={() => setHelpOpen((o) => !o)} />
        {children}
        <KeyDialog open={keyOpen} onClose={() => setKeyOpen(false)} />
        <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      </ShellContext.Provider>
    </HotkeysProvider>
  );
}

function GlobalHotkeys({ onHelp }: { onHelp: () => void }) {
  const router = useRouter();
  useHotkey("?", onHelp, { description: "show keyboard shortcuts", group: "general" });
  useHotkey("t", toggleTheme, { description: "toggle light / dark", group: "general" });
  useHotkey("g h", () => router.push("/"), { description: "go home", group: "navigation" });
  useHotkey("g s", () => router.push("/studio"), { description: "go to studio", group: "navigation" });
  useHotkey("g e", () => router.push("/examples"), { description: "go to examples", group: "navigation" });
  useHotkey("g d", () => router.push("/docs"), { description: "go to docs", group: "navigation" });
  return null;
}

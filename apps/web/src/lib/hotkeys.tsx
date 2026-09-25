"use client";

/**
 * A small, solid keyboard-shortcut system.
 *
 *   useHotkey("mod+k", open, { description: "open palette" });
 *   useHotkey("g s", () => router.push("/studio"), { description: "go to studio", group: "navigation" });
 *
 * - `mod` is ⌘ on macOS and Ctrl elsewhere.
 * - Space-separated steps form a sequence ("g s"), typed within 1s.
 * - Plain-key shortcuts are ignored while typing in inputs; combos with
 *   mod/ctrl/meta/alt still fire (pass `allowInInputs` to override).
 * - Everything registered with a `description` shows up in the `?` dialog.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

// ── pure core ───────────────────────────────────────────────────────────────

export interface Step {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface Stroke {
  key: string;
  code: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  plus: "+",
};

export function parseCombo(combo: string): Step[] {
  return combo
    .trim()
    .split(/\s+/)
    .map((chunk) => {
      // allow "shift+plus" style but also a bare "+"
      const parts = chunk === "+" ? ["+"] : chunk.toLowerCase().split("+");
      const step: Step = { key: "", mod: false, ctrl: false, meta: false, alt: false, shift: false };
      for (const part of parts) {
        if (part === "mod") step.mod = true;
        else if (part === "ctrl" || part === "control") step.ctrl = true;
        else if (part === "meta" || part === "cmd" || part === "command") step.meta = true;
        else if (part === "alt" || part === "option" || part === "opt") step.alt = true;
        else if (part === "shift") step.shift = true;
        else step.key = KEY_ALIASES[part] ?? part;
      }
      if (!step.key) throw new Error(`hotkey "${combo}" has no key`);
      return step;
    });
}

const isAlnum = (key: string) => /^[a-z0-9]$/.test(key);
const isNamed = (key: string) => key.length > 1;

export function matchesStep(step: Step, stroke: Stroke, isMac: boolean): boolean {
  const wantCtrl = step.ctrl || (step.mod && !isMac);
  const wantMeta = step.meta || (step.mod && isMac);
  if (stroke.ctrl !== wantCtrl || stroke.meta !== wantMeta || stroke.alt !== step.alt) {
    return false;
  }

  const key = stroke.key.toLowerCase();
  const keyMatches =
    key === step.key ||
    // alt/option mangles e.key on macOS ("∂" for alt+d); fall back to the physical key
    (step.alt && isAlnum(step.key) && stroke.code.toLowerCase() === (/\d/.test(step.key) ? `digit${step.key}` : `key${step.key}`));
  if (!keyMatches) return false;

  // Shift is meaningful for letters, digits and named keys. For symbols like
  // "?" it's how you type them, so we don't care.
  if (step.shift) return stroke.shift;
  if (isAlnum(step.key) || isNamed(step.key)) return !stroke.shift;
  return true;
}

export function hasModifier(steps: Step[]): boolean {
  return steps.some((s) => s.mod || s.ctrl || s.meta || s.alt);
}

const MAC_GLYPHS = { mod: "⌘", ctrl: "⌃", meta: "⌘", alt: "⌥", shift: "⇧" };
const PC_LABELS = { mod: "ctrl", ctrl: "ctrl", meta: "win", alt: "alt", shift: "shift" };
const KEY_LABELS: Record<string, string> = {
  enter: "↵",
  escape: "esc",
  " ": "space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backspace: "⌫",
  delete: "del",
  tab: "tab",
};

/** Human labels for each step, e.g. "mod+enter" → [["⌘", "↵"]]. */
export function formatCombo(combo: string, isMac: boolean): string[][] {
  const labels = isMac ? MAC_GLYPHS : PC_LABELS;
  return parseCombo(combo).map((s) => {
    const out: string[] = [];
    if (s.ctrl) out.push(labels.ctrl);
    if (s.alt) out.push(labels.alt);
    if (s.shift) out.push(labels.shift);
    if (s.mod) out.push(labels.mod);
    if (s.meta) out.push(labels.meta);
    out.push(KEY_LABELS[s.key] ?? s.key);
    return out;
  });
}

// ── platform ────────────────────────────────────────────────────────────────

function detectMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
const noopSubscribe = () => () => {};

/** false during SSR, then the real answer. */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, detectMac, () => false);
}

// ── registry + provider ─────────────────────────────────────────────────────

export interface HotkeyOptions {
  /** Shown in the shortcuts dialog. Omit to register a hidden shortcut. */
  description?: string;
  group?: string;
  enabled?: boolean;
  allowInInputs?: boolean;
  /** Default true. */
  preventDefault?: boolean;
}

export interface RegisteredHotkey {
  id: string;
  combo: string;
  description?: string;
  group: string;
}

interface Binding extends RegisteredHotkey {
  steps: Step[];
  allowInInputs: boolean;
  preventDefault: boolean;
  handler: { current: (e: KeyboardEvent) => void };
}

class HotkeyRegistry {
  private bindings = new Map<string, Binding>();
  private listeners = new Set<() => void>();
  private snapshot: RegisteredHotkey[] = [];

  add(binding: Binding) {
    this.bindings.set(binding.id, binding);
    this.emit();
  }
  remove(id: string) {
    if (this.bindings.delete(id)) this.emit();
  }
  all(): Binding[] {
    return [...this.bindings.values()];
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = this.all().map(({ id, combo, description, group }) => ({
      id,
      combo,
      description,
      group,
    }));
    for (const fn of this.listeners) fn();
  }
}

const RegistryContext = createContext<HotkeyRegistry | null>(null);

const SEQUENCE_TIMEOUT_MS = 1000;
const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "os", "capslock", "fn"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(type);
  }
  return false;
}

export function HotkeysProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new HotkeyRegistry(), []);

  useEffect(() => {
    const isMac = detectMac();
    let history: Stroke[] = [];
    let lastAt = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      if (MODIFIER_KEYS.has(e.key.toLowerCase())) return;

      const stroke: Stroke = {
        key: e.key,
        code: e.code,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
      };
      const typing = isTypingTarget(e.target);
      const strokeHasMod = stroke.ctrl || stroke.meta || stroke.alt;

      const now = performance.now();
      if (now - lastAt > SEQUENCE_TIMEOUT_MS) history = [];
      lastAt = now;
      // Keystrokes typed into a field never start or continue a sequence.
      history = typing && !strokeHasMod ? [] : [...history.slice(-3), stroke];
      const candidates = typing && !strokeHasMod ? [stroke] : history;

      const bindings = registry.all().sort((a, b) => b.steps.length - a.steps.length);
      for (const b of bindings) {
        const n = b.steps.length;
        if (n > candidates.length) continue;
        if (typing && !b.allowInInputs && !hasModifier(b.steps)) continue;
        const tail = candidates.slice(-n);
        if (!b.steps.every((step, i) => matchesStep(step, tail[i], isMac))) continue;

        if (b.preventDefault) e.preventDefault();
        history = [];
        b.handler.current(e);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry]);

  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const registry = useContext(RegistryContext);
  const id = useId();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const { description, group = "general", enabled = true, allowInInputs = false, preventDefault = true } = options;

  useEffect(() => {
    if (!registry || !enabled) return;
    registry.add({
      id,
      combo,
      steps: parseCombo(combo),
      description,
      group,
      allowInInputs,
      preventDefault,
      handler: handlerRef,
    });
    return () => registry.remove(id);
  }, [registry, id, combo, description, group, enabled, allowInInputs, preventDefault]);
}

/** Every currently registered shortcut (for help UIs). */
export function useHotkeyList(): RegisteredHotkey[] {
  const registry = useContext(RegistryContext);
  return useSyncExternalStore(
    registry?.subscribe ?? noopSubscribe,
    registry?.getSnapshot ?? emptyList,
    emptyList,
  );
}
const EMPTY: RegisteredHotkey[] = [];
const emptyList = () => EMPTY;

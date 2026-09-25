"use client";

import { Dialog } from "@/components/ui/dialog";
import { KbdCombo } from "@/components/ui/kbd";
import { useHotkeyList } from "@/lib/hotkeys";

const GROUP_ORDER = ["general", "navigation"];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hotkeys = useHotkeyList().filter((h) => h.description);

  const groups = new Map<string, typeof hotkeys>();
  for (const h of hotkeys) groups.set(h.group, [...(groups.get(h.group) ?? []), h]);
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="keyboard shortcuts"
      description="fewer clicks, more chains. these work anywhere outside a text field."
    >
      <div className="space-y-5">
        {ordered.map(([group, items]) => (
          <section key={group}>
            <h3 className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{group}</h3>
            <ul className="border-soft-t">
              {items.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-4 border-soft-b py-2 text-sm">
                  <span className="text-ink-2">{h.description}</span>
                  <KbdCombo combo={h.combo} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

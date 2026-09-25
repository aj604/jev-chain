"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}

/** An in-app confirm (never window.confirm). Escape or the backdrop cancels. */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  return (
    <Dialog
      open={request !== null}
      onClose={onClose}
      title={request?.title ?? ""}
      className="w-[min(26rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            keep it
          </Button>
          <button
            type="button"
            onClick={() => {
              request?.onConfirm();
              onClose();
            }}
            className="inline-flex h-7 items-center gap-2 border-(length:--bw) border-fail bg-fail px-2.5 font-mono text-xs lowercase text-paper transition-[transform,box-shadow] duration-(--dur-fast) ease-snap hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[2px_2px_0_0_var(--ink)] active:translate-0 active:shadow-none"
          >
            {request?.confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-2">{request?.body}</div>
    </Dialog>
  );
}

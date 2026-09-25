"use client";

import { useEffect, useState } from "react";
import { useShell } from "@/components/shell/shell-provider";
import { Button } from "@/components/ui/button";
import type { RunIssue } from "@/lib/trace/run-error";

/**
 * The button that fixes a run issue: add a key (or rehearse without one), or
 * retry (after a cooldown for 429s).
 */
export function IssueActions({ issue, onRetry, onRehearse }: { issue: RunIssue | null; onRetry?: () => void; onRehearse?: () => void }) {
  const { openKeyDialog } = useShell();
  if (!issue?.action) return null;
  if (issue.action === "add-key") {
    return (
      <>
        <Button variant="accent" size="sm" onClick={openKeyDialog}>
          add a key
        </Button>
        {onRehearse && (
          <Button variant="outline" size="sm" onClick={onRehearse}>
            rehearse without one
          </Button>
        )}
      </>
    );
  }
  if (!onRetry) return null;
  return <RetryButton key={`${issue.kind}-${issue.retryAfterMs ?? 0}`} waitMs={issue.retryAfterMs ?? 0} onRetry={onRetry} />;
}

function RetryButton({ waitMs, onRetry }: { waitMs: number; onRetry: () => void }) {
  const [until] = useState(() => Date.now() + waitMs);
  const [left, setLeft] = useState(() => Math.ceil(waitMs / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 250);
    return () => clearTimeout(t);
  }, [left, until]);
  return (
    <Button variant="outline" size="sm" onClick={onRetry} disabled={left > 0}>
      {left > 0 ? `cooling down · ${left}s` : "pull it again"}
    </Button>
  );
}

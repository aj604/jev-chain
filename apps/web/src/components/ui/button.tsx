import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "solid" | "accent" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
  "group/btn relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-mono lowercase tracking-tight select-none " +
  "transition-[transform,box-shadow,background-color,color,border-color] duration-(--dur-fast) ease-snap " +
  "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

// The raw lift: hover nudges up-left and drops a hard ink shadow; press lands it.
const lift =
  "hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[2px_2px_0_0_var(--ink)] " +
  "active:translate-x-0 active:translate-y-0 active:shadow-none";

const variants: Record<ButtonVariant, string> = {
  solid: cn("border-hard bg-ink text-paper", lift),
  accent: cn("border-hard bg-accent text-accent-ink", lift),
  outline: cn("border-hard bg-paper text-ink", lift),
  ghost: "border-(length:--bw) border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-[13px]",
  lg: "h-11 px-5 text-sm",
  icon: "size-8 p-0 text-[13px]",
};

export function buttonClasses({
  variant = "outline",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

type Shared = { variant?: ButtonVariant; size?: ButtonSize; children?: ReactNode };

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: Shared & ComponentProps<"button">) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}

/** Same look, but a Next <Link>. External hrefs get rel/target automatically. */
export function ButtonLink({
  variant,
  size,
  className,
  href,
  external,
  ...props
}: Shared & ComponentProps<typeof Link> & { external?: boolean }) {
  const isExternal = external ?? (typeof href === "string" && /^https?:\/\//.test(href));
  return (
    <Link
      href={href}
      className={buttonClasses({ variant, size, className })}
      {...(isExternal ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      {...props}
    />
  );
}

import Link, { type LinkProps } from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const baseStyles =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--home-accent)] text-[var(--home-on-accent)] hover:bg-[var(--home-accent-hover)] active:bg-[var(--home-accent-hover)]",
  secondary:
    "border border-[var(--kavero-border-strong)] bg-[var(--kavero-surface)] text-[var(--kavero-text-primary)] hover:bg-[var(--kavero-hover)]",
  ghost: "text-[var(--kavero-text-secondary)] hover:bg-[var(--kavero-surface)] hover:text-[var(--kavero-text-primary)]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-6 text-base",
};

type StyleProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

type ButtonProps = ComponentProps<"button"> & StyleProps;

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}

type ButtonLinkProps = LinkProps &
  StyleProps & {
    children: ReactNode;
    className?: string;
  };

export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}

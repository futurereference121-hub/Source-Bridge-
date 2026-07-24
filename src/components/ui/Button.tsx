import Link from "next/link";
import { type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-electric text-white hover:bg-electric-hover border border-transparent rounded-[5px]",
  secondary:
    "bg-navy text-white hover:bg-navy-mid border border-transparent rounded-[5px]",
  ghost: "bg-transparent text-foreground hover:bg-stone border border-transparent rounded-[5px]",
  outline:
    "bg-transparent text-foreground border border-navy/20 hover:border-navy hover:bg-surface rounded-[5px]",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-4 text-xs tracking-wide",
  md: "h-11 px-6 text-sm tracking-wide",
  lg: "h-12 px-8 text-sm tracking-[0.08em] uppercase",
};

type CommonProps = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
};

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
  type?: never;
  disabled?: boolean;
  onClick?: never;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );

  if ("href" in props && props.href) {
    const { href, disabled, ...rest } = props;
    if (disabled) {
      return (
        <span className={cn(classes, "opacity-50 pointer-events-none")} {...rest}>
          {children}
        </span>
      );
    }
    return (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }

  const buttonProps = props as ButtonAsButton;
  return (
    <button className={classes} {...buttonProps}>
      {children}
    </button>
  );
}

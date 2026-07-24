import Link from "next/link";
import { type ButtonHTMLAttributes, type ReactNode } from "react";

type CommonProps = {
  children: ReactNode;
  className?: string;
  showArrow?: boolean;
};

type AsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type AsLink = CommonProps & {
  href: string;
  type?: never;
  disabled?: boolean;
};

export type SecondaryButtonProps = AsButton | AsLink;

function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function SecondaryButton({
  children,
  className,
  showArrow = true,
  ...props
}: SecondaryButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-navy transition-colors hover:bg-stone disabled:pointer-events-none disabled:opacity-50",
    className,
  );

  const content = (
    <>
      <span className="text-left leading-tight">{children}</span>
      {showArrow ? (
        <span className="text-lg font-semibold leading-none" aria-hidden="true">
          ›
        </span>
      ) : null}
    </>
  );

  if ("href" in props && props.href) {
    const { href, disabled } = props;
    if (disabled) {
      return <span className={cn(classes, "opacity-50")}>{content}</span>;
    }
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  const buttonProps = props as AsButton;
  return (
    <button className={classes} {...buttonProps}>
      {content}
    </button>
  );
}

"use client";

import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

type SharedProps = {
  children: ReactNode;
  className?: string;
};

type LinkProps = SharedProps & {
  href: string;
  onClick?: never;
  disabled?: never;
  type?: never;
};

type NativeButtonProps = SharedProps &
  Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onClick" | "disabled" | "type" | "aria-label"
  > & {
    href?: never;
  };

const BASE_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(103,232,249,0.16)] transition hover:bg-cyan-200 hover:shadow-[0_0_30px_rgba(103,232,249,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07101d] disabled:cursor-not-allowed disabled:opacity-55";

function mergeClassName(className?: string) {
  return className
    ? `${BASE_CLASS} ${className}`
    : BASE_CLASS;
}

export default function PrimaryButton(
  props: LinkProps | NativeButtonProps
) {
  if ("href" in props && props.href) {
    const {
      href,
      children,
      className,
    } = props;

    return (
      <Link
        href={href}
        className={mergeClassName(className)}
      >
        {children}
      </Link>
    );
  }

  const {
    children,
    className,
    type = "button",
    ...buttonProps
  } = props;

  return (
    <button
      type={type}
      className={mergeClassName(className)}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

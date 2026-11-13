import type { ComponentProps } from "react";

// Repository-owned shadcn-style button with native button semantics.
export function Button({ className, variant = "default", type = "button", ...props }: ComponentProps<"button"> & {
  variant?: "default" | "secondary" | "destructive";
}) {
  const appearance = { default: "", secondary: "secondary", destructive: "danger" }[variant];
  return <button type={type} className={[appearance, className].filter(Boolean).join(" ")} {...props} />;
}

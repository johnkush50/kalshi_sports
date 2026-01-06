import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-blue-600 text-white",
        secondary: "border-transparent bg-gray-700 text-gray-200",
        success: "border-transparent bg-green-600 text-white",
        warning: "border-transparent bg-yellow-600 text-white",
        destructive: "border-transparent bg-red-600 text-white",
        outline: "border-gray-600 text-gray-300",
        stale: "border-transparent bg-gray-600 text-gray-400",
        fresh: "border-transparent bg-green-900 text-green-300",
        signal: "border-transparent bg-purple-600 text-white",
        mono: "border-transparent bg-orange-600 text-white",
        jump: "border-transparent bg-cyan-600 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

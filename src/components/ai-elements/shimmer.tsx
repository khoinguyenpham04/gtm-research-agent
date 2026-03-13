"use client";

import type { CSSProperties, ElementType } from "react";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { memo } from "react";

const shimmerComponents = {
  div: motion.div,
  p: motion.p,
  span: motion.span,
} as const;

export interface TextShimmerProps {
  children?: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const MotionComponent =
    typeof Component === "string"
      ? shimmerComponents[Component as keyof typeof shimmerComponents] ??
        shimmerComponents.span
      : shimmerComponents.span;
  const content = children ?? "\u00a0";
  const dynamicSpread = Math.max(content.length, 4) * spread;

  return (
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={{
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {content}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);

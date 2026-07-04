"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import type { MotionStyle } from "motion/react";

interface TooltipContextType {
  setContent: (content: string, description?: string) => void;
  setIsActive: (active: boolean) => void;
}

const TooltipContext = createContext<TooltipContextType | null>(null);

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function FloatingTooltipProvider({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springConfig = { damping: 25, stiffness: 300 };
  const smoothX = useSpring(x, springConfig);
  const smoothY = useSpring(y, springConfig);

  const velocityX = useVelocity(smoothX);
  const velocityY = useVelocity(smoothY);

  const scaleX = useTransform(velocityX, [-1000, 0, 1000], [0.9, 1, 1.15]);
  const scaleY = useTransform(velocityY, [-1000, 0, 1000], [1.15, 1, 0.9]);
  const skewX = useTransform(velocityX, [-1000, 0, 1000], [-3, 0, 3]);
  const skewY = useTransform(velocityY, [-1000, 0, 1000], [-3, 0, 3]);

  const borderRadius = useTransform([velocityX, velocityY], ([vx, vy]) => {
    const velocity = Math.sqrt((vx as number) ** 2 + (vy as number) ** 2);
    const radius = 8 + Math.min(velocity / 80, 16);
    return `${radius}px`;
  });

  const [isActive, setIsActive] = useState(false);
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const getZoom = () => {
      const computedZoom = window.getComputedStyle(document.documentElement).zoom;
      return computedZoom ? parseFloat(computedZoom) : 1;
    };

    const handleMouseMove = (event: MouseEvent) => {
      const zoom = getZoom();
      x.set(event.clientX / zoom);
      y.set(event.clientY / zoom);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [x, y]);

  const handleSetContent = (newContent: string, newDescription?: string) => {
    setContent(newContent);
    setDescription(newDescription || "");
  };

  return (
    <TooltipContext.Provider value={{ setContent: handleSetContent, setIsActive }}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isActive && content && (
              <motion.div
                className="pointer-events-none fixed z-[100]"
                style={{ top: smoothY, left: smoothX }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                <motion.div
                  layout
                  className={joinClasses(
                    "ml-4 mt-4 border border-white/10 bg-black/70 px-4 py-3 text-sm font-medium text-white shadow-[0_18px_60px_rgb(0_0_0_/_0.45),inset_0_1px_0_rgb(255_255_255_/_0.08)] backdrop-blur-2xl",
                    className,
                  )}
                  style={
                    {
                      scaleX,
                      scaleY,
                      skewX,
                      skewY,
                      borderRadius,
                    } as MotionStyle
                  }
                  transition={{
                    layout: {
                      type: "spring",
                      damping: 25,
                      stiffness: 400,
                    },
                  }}
                >
                  <motion.div
                    key={content}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                    className="flex flex-col gap-1"
                  >
                    <span className="whitespace-nowrap font-semibold">{content}</span>
                    {description && (
                      <span className="max-w-[28ch] whitespace-normal text-sm leading-snug text-white/70">
                        {description}
                      </span>
                    )}
                  </motion.div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </TooltipContext.Provider>
  );
}

export function FloatingTooltipTrigger({
  children,
  content,
  description,
}: {
  children: ReactNode;
  content: string;
  description?: string;
}) {
  const context = useContext(TooltipContext);

  if (!context) {
    throw new Error("FloatingTooltipTrigger must be used within FloatingTooltipProvider");
  }

  const { setContent, setIsActive } = context;

  return (
    <div
      onMouseEnter={() => {
        setContent(content, description);
        setIsActive(true);
      }}
      onMouseLeave={() => setIsActive(false)}
    >
      {children}
    </div>
  );
}

export const FloatingTooltip = {
  Provider: FloatingTooltipProvider,
  Trigger: FloatingTooltipTrigger,
};

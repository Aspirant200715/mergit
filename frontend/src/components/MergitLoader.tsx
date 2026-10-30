import type { JSX } from "react";
import { MergitSymbol } from "./MergitLogo";

export interface MergitLoaderProps {
  /** Width and height of the box in px. The mark fills 80% of it; the pills travel outside the mark. Default 32. */
  size?: number;
  /** Announced to screen readers. Default "Loading". */
  label?: string;
  className?: string;
  /** Hide it from screen readers, for when a parent already announces the wait (a nested status is read twice). */
  decorative?: boolean;
}

/** Loading indicator: the colour logo's pills slide in, grip the Ethereum symbol, hold, release (1.6 s loop).
 *  With prefers-reduced-motion: reduce it shows the still symbol. */
export function MergitLoader({ size = 32, label = "Loading", className, decorative }: MergitLoaderProps): JSX.Element {
  return (
    <span
      className={`mg-loader${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      {...(decorative ? { "aria-hidden": true } : { role: "status", "aria-label": label })}
    >
      <MergitSymbol size={Math.round(size * 0.8)} motion="loop" />
    </span>
  );
}

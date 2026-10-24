// Mergit loading animation. Paths match 01-logo/symbol.svg and wordmark.svg in the Mergit brand kit.
// The two pills slide in from the left and right, grip the Ethereum symbol, hold, release; 1.6 s per loop.
// Drawn in currentColor. With prefers-reduced-motion: reduce it shows the still symbol.
import type { JSX } from "react";

const CSS =
  "@media (prefers-reduced-motion:no-preference){.mergit-loader-t{animation:mergit-loader-t 1.6s infinite}.mergit-loader-b{animation:mergit-loader-b 1.6s infinite}.mergit-loader-e{animation:mergit-loader-e 1.6s infinite}}@keyframes mergit-loader-t{0%{transform:translate(-56px,-50px);opacity:0;animation-timing-function:cubic-bezier(.2,.7,.3,1)}30%{transform:translate(0,-50px);opacity:1;animation-timing-function:cubic-bezier(.6,0,.2,1)}44%{transform:translate(0,0);opacity:1}74%{transform:translate(0,0);opacity:1;animation-timing-function:cubic-bezier(.6,0,.2,1)}86%{transform:translate(0,-50px);opacity:1;animation-timing-function:cubic-bezier(.5,0,.75,.3)}100%{transform:translate(-56px,-50px);opacity:0}}@keyframes mergit-loader-b{0%{transform:translate(56px,50px);opacity:0;animation-timing-function:cubic-bezier(.2,.7,.3,1)}30%{transform:translate(0,50px);opacity:1;animation-timing-function:cubic-bezier(.6,0,.2,1)}44%{transform:translate(0,0);opacity:1}74%{transform:translate(0,0);opacity:1;animation-timing-function:cubic-bezier(.6,0,.2,1)}86%{transform:translate(0,50px);opacity:1;animation-timing-function:cubic-bezier(.5,0,.75,.3)}100%{transform:translate(56px,50px);opacity:0}}@keyframes mergit-loader-e{0%,26%{opacity:.3}44%,74%{opacity:1}90%,100%{opacity:.3}}";

export interface MergitLoaderProps {
  /** Width and height in px. Default 32. */
  size?: number;
  /** Announced to screen readers. Default "Loading". */
  label?: string;
  className?: string;
}

export function MergitLoader({ size = 32, label = "Loading", className }: MergitLoaderProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-36 -36 328 328"
      fill="currentColor"
      className={className}
      role="status"
      aria-label={label}
      focusable="false"
    >
      <style>{CSS}</style>
      <path
        className="mergit-loader-t"
        d="M52 16L180 16A36 36 0 0 1 180 88L175.17 88A8 8 0 0 1 168.31 84.13L141.69 39.95A16 16 0 0 0 114.28 39.95L87.66 84.13A8 8 0 0 1 80.8 88L52 88A36 36 0 0 1 52 16Z"
      />
      <path
        className="mergit-loader-b"
        d="M76 240L204 240A36 36 0 0 0 204 168L179.99 168A8 8 0 0 0 173.47 171.37L141.03 217.05A16 16 0 0 1 114.94 217.05L82.52 171.37A8 8 0 0 0 76 168A36 36 0 0 0 76 240Z"
      />
      <path
        className="mergit-loader-e"
        d="M127.99 48.21L176.97 129.48L127.99 158.43L79.01 129.48ZM79.01 138.77L127.99 167.71L176.99 138.77L127.99 207.79Z"
      />
    </svg>
  );
}

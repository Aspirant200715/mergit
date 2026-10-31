export type Device = "desktop" | "ios" | "android";
export type Browser = "chrome" | "edge" | "firefox" | "brave" | "opera" | "safari" | "other";
export type Environment = { device: Device; browser: Browser };

/**
 * What the person is browsing with, to word the MetaMask guide for them. Only the wording changes: install links are
 * always MetaMask's own download page, which sends each browser to the right store itself.
 * Brave has to say so itself (`navigator.brave`); its user agent is Chrome's.
 */
export function detectEnvironment(userAgent: string, isBrave = false): Environment {
  const device: Device = /iPhone|iPad|iPod/.test(userAgent) ? "ios" : /Android/.test(userAgent) ? "android" : "desktop";
  // Order matters: Edge and Opera also contain "Chrome", and Chrome also contains "Safari".
  const browser: Browser = isBrave
    ? "brave"
    : /Edg\//.test(userAgent)
      ? "edge"
      : /OPR\/|Opera/.test(userAgent)
        ? "opera"
        : /Firefox\/|FxiOS/.test(userAgent)
          ? "firefox"
          : /Chrome\/|CriOS/.test(userAgent)
            ? "chrome"
            : /Safari\//.test(userAgent)
              ? "safari"
              : "other";
  return { device, browser };
}

export function currentEnvironment(): Environment {
  const brave = (navigator as unknown as { brave?: unknown }).brave !== undefined;
  return detectEnvironment(navigator.userAgent, brave);
}

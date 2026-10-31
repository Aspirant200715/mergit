import { describe, expect, it } from "vitest";
import { detectEnvironment } from "./environment";

const UA = {
  chrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  opera:
    "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

describe("detectEnvironment", () => {
  it("names the desktop browsers, checking the more specific ones first (Edge and Opera also say Chrome)", () => {
    expect(detectEnvironment(UA.chrome)).toEqual({ device: "desktop", browser: "chrome" });
    expect(detectEnvironment(UA.edge)).toEqual({ device: "desktop", browser: "edge" });
    expect(detectEnvironment(UA.opera)).toEqual({ device: "desktop", browser: "opera" });
    expect(detectEnvironment(UA.firefox)).toEqual({ device: "desktop", browser: "firefox" });
    expect(detectEnvironment(UA.safari)).toEqual({ device: "desktop", browser: "safari" });
  });

  it("knows Brave only when the browser says so, because its user agent looks like Chrome", () => {
    expect(detectEnvironment(UA.chrome, true)).toEqual({ device: "desktop", browser: "brave" });
  });

  it("tells phones from computers", () => {
    expect(detectEnvironment(UA.iphone).device).toBe("ios");
    expect(detectEnvironment(UA.android).device).toBe("android");
  });

  it("does not guess when it does not recognise the browser", () => {
    expect(detectEnvironment("SomethingNew/1.0")).toEqual({ device: "desktop", browser: "other" });
    expect(detectEnvironment("")).toEqual({ device: "desktop", browser: "other" });
  });
});

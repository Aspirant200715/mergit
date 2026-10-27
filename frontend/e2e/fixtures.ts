import { test as base, type BrowserContext } from "@playwright/test";

const DEMO_ADDRESS = "0x6E2d4A9c51b07f3e9d28c4a16b0e7f2c3d119A0b";

/** Sign the context in (as the Connect window stores a session) and skip the landing intro, before any page
 *  script runs. */
export async function seedSession(context: BrowserContext, address: string = DEMO_ADDRESS) {
  const session = JSON.stringify({ address, method: "browser", since: 0 });
  await context.addInitScript((s) => {
    localStorage.setItem("mergit-session", s);
    sessionStorage.setItem("mergit-intro-seen", "1");
  }, session);
}

/** Tests that run against the dashboard start signed in. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await seedSession(context);
    await use(context);
  },
});

export { expect } from "@playwright/test";

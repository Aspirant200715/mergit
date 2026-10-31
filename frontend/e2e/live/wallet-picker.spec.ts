import { expect, test } from "@playwright/test";
import { installWallet, mockBackend } from "./fake";

/** The wallet picker: MetaMask works, anything else is "soon" with a Notify me that counts who wants it. */

const everything = { wallet: true, github: true, google: true, email: true };

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    sessionStorage.setItem("mergit-intro-seen", "1");
  });
});

const openPicker = async (page: import("@playwright/test").Page) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  return page.getByRole("group", { name: "Choose a wallet" });
};

test("with MetaMask installed the picker offers it, and says the other wallets are coming", async ({
  page,
  context,
}) => {
  await installWallet(context);
  await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  await expect(picker.getByRole("button", { name: /MetaMask/ })).toContainText("Detected");
  await expect(picker.getByRole("button", { name: /Other wallets/ })).toContainText("Soon");
});

test("without MetaMask the row becomes an Install link to MetaMask, and says to reload afterwards", async ({
  page,
  context,
}) => {
  await installWallet(context, { absent: true });
  await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  const install = picker.getByRole("link", { name: /MetaMask/ });
  await expect(install).toContainText("Install");
  await expect(install).toHaveAttribute("href", "https://metamask.io/download/");
  await expect(install).toHaveAttribute("target", "_blank");
  await expect(install).toHaveAttribute("rel", /noopener/);
  await expect(picker).toContainText("reload this page");
});

test("MetaMask is used even when another wallet owns window.ethereum", async ({ page, context }) => {
  await installWallet(context, { decoyDefault: true });
  const calls = await mockBackend(page, { providers: everything });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /MetaMask/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  const verify = calls.find((c) => c.path === "/v0/auth/verify");
  expect((verify?.body as { message: string }).message).toContain("Chain ID: 84532");
  const signed = await page.evaluate(
    () => (window as unknown as { __fakeWallet: { state: { signed: string[] } } }).__fakeWallet.state.signed,
  );
  expect(signed).toHaveLength(1); // MetaMask signed it; the decoy would have refused
});

test("Other wallets: pick the ones you want, press Notify me, and the server is told which", async ({
  page,
  context,
}) => {
  await installWallet(context);
  const calls = await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /Other wallets/ }).click();
  await expect(page.getByRole("heading", { name: "More wallets are coming soon" })).toBeVisible();

  const coindcx = page.getByRole("button", { name: "CoinDCX" });
  await coindcx.click();
  await expect(coindcx).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Trust Wallet" }).click();
  await page.getByRole("button", { name: "Trust Wallet" }).click(); // and changes their mind
  await page.getByRole("button", { name: "Notify me" }).click();

  await expect(page.getByRole("status")).toContainText("We will tell you when it is ready");
  await expect(page.getByRole("button", { name: "Notify me" })).toHaveCount(0);
  const sent = calls.filter((c) => c.path === "/v0/wallet-interest");
  expect(sent).toHaveLength(1);
  const body = sent[0]?.body as { wallets: string[]; token: string };
  expect(body.wallets).toEqual(["coindcx"]);
  expect(body.token).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
});

test("Notify me with nothing picked asks to pick a wallet instead of counting a vote for nothing", async ({
  page,
  context,
}) => {
  await installWallet(context);
  const calls = await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /Other wallets/ }).click();
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("alert")).toContainText("Pick at least one wallet");
  expect(calls.some((c) => c.path === "/v0/wallet-interest")).toBe(false);
});

test("Back to wallets returns to the list", async ({ page, context }) => {
  await installWallet(context);
  await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /Other wallets/ }).click();
  await page.getByRole("button", { name: "Back to wallets" }).click();
  await expect(page.getByRole("group", { name: "Choose a wallet" })).toBeVisible();
});

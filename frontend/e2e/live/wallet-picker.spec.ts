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

test("without MetaMask the row offers a guide, and the guide uses MetaMask's own download page", async ({
  page,
  context,
}) => {
  await installWallet(context, { absent: true });
  await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  const row = picker.getByRole("button", { name: /MetaMask/ });
  await expect(row).toContainText("Set up");
  await row.click();

  await expect(page.getByRole("heading", { name: "Set up MetaMask in a few minutes" })).toBeVisible();
  await expect(page.getByText("Add MetaMask to Chrome")).toBeVisible();
  const download = page.getByRole("link", { name: /Open MetaMask's download page/ });
  await expect(download).toHaveAttribute("href", "https://metamask.io/download/");
  await expect(download).toHaveAttribute("target", "_blank");
  await expect(download).toHaveAttribute("rel", /noopener/);
  // The safety warning is in front of them before they create anything.
  await expect(page.getByText(/Mergit and MetaMask will never ask you for it/)).toBeVisible();
  await expect(page.getByText(/start free with GitHub, Google or email/)).toBeVisible();

  await page.getByRole("button", { name: "Back to wallets" }).click();
  await expect(page.getByRole("group", { name: "Choose a wallet" })).toBeVisible();
});

test("after installing, the reload button brings the wallet list back open", async ({ page, context }) => {
  await installWallet(context, { absent: true });
  await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /MetaMask/ }).click();
  await page.getByRole("button", { name: /reload this page/ }).click();
  await expect(page.getByRole("group", { name: "Choose a wallet" })).toBeVisible();
  // It reopens once: a later visit starts with the list closed.
  await page.reload();
  await expect(page.getByRole("group", { name: "Choose a wallet" })).toHaveCount(0);
});

test("when MetaMask appears while the guide is open, the guide says so and offers Connect", async ({
  page,
  context,
}) => {
  await installWallet(context, { absent: true });
  await mockBackend(page, { me: null, providers: everything });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /MetaMask/ }).click();
  await expect(page.getByText("MetaMask is installed and ready.")).toHaveCount(0);

  await page.evaluate(() => {
    const info = { uuid: "late-install", name: "MetaMask", icon: "data:,", rdns: "io.metamask" };
    const provider = { request: () => Promise.resolve(null) };
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info, provider } }));
  });
  await expect(page.getByText("MetaMask is installed and ready.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect MetaMask" })).toBeVisible();
  await expect(page.getByRole("button", { name: /reload this page/ })).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });

  test("the guide is about the MetaMask app and opens Mergit inside it", async ({ page, context }) => {
    await installWallet(context, { absent: true });
    await mockBackend(page, { me: null, providers: everything });
    const picker = await openPicker(page);
    await picker.getByRole("button", { name: /MetaMask/ }).click();
    await expect(page.getByRole("heading", { name: "Set up MetaMask on your phone" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open MetaMask in the App Store" })).toHaveAttribute(
      "href",
      "https://apps.apple.com/us/app/metamask-blockchain-wallet/id1438144202",
    );
    await expect(page.getByRole("link", { name: "Open Mergit in MetaMask" })).toHaveAttribute(
      "href",
      "https://link.metamask.io/dapp/localhost:5174",
    );
    await expect(page.getByRole("button", { name: /reload this page/ })).toHaveCount(0);
  });
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

  // Not getByRole("status") alone: the toast container is a second, empty status region on every page.
  await expect(page.getByRole("status").filter({ hasText: "We will tell you when it is ready" })).toBeVisible();
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

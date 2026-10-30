import { expect, test } from "@playwright/test";
import { seedSession } from "../fixtures";
import { installWallet, ME, mockBackend, OTHER } from "./fake";

test("signs in with a wallet and shows the address", async ({ page, context }) => {
  await installWallet(context);
  const calls = await mockBackend(page);
  await page.goto("/app");
  const dialog = page.getByRole("dialog", { name: "Connect to Mergit" });
  await expect(dialog.getByRole("button", { name: /WalletConnect/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(dialog).toBeHidden();
  const verify = calls.find((c) => c.path === "/v0/auth/verify");
  expect((verify?.body as { message: string }).message).toContain("Chain ID: 84532");
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mergit-session") ?? "{}") as { address: string },
  );
  expect(stored.address).toBe(ME);
});

test("signs out when the wallet account changes", async ({ page, context }) => {
  await installWallet(context);
  await mockBackend(page);
  await page.goto("/app");
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(page.getByRole("dialog", { name: "Connect to Mergit" })).toBeHidden();
  await page.evaluate((other) => {
    (window as unknown as { __fakeWallet: { switchAccount: (a: string) => void } }).__fakeWallet.switchAccount(other);
  }, OTHER);
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem("mergit-session"))).toBeNull();
});

test("wallet page shows testnet balances, free credits and faucets", async ({ page, context }) => {
  await seedSession(context, ME);
  await installWallet(context);
  await mockBackend(page, {
    ethWei: 25n * 10n ** 16n,
    usdcUnits: 12_500_000n,
    credits: { granted: "5000000", spent: "2000000", remaining: "3000000", plans_today: 1 },
  });
  await page.goto("/app/wallet");
  await expect(page.getByTestId("usdc-balance")).toHaveText("12.50");
  await expect(page.getByTestId("eth-balance")).toHaveText("0.2500");
  await expect(page.getByTestId("credits-remaining")).toHaveText("3.00");
  await expect(page.getByText("testnet funds only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Get test USDC" })).toHaveAttribute("href", "https://faucet.circle.com");
});

test("wallet page asks to switch when the wallet is on another chain", async ({ page, context }) => {
  await seedSession(context, ME);
  await installWallet(context, { chainId: 1 });
  await mockBackend(page);
  await page.goto("/app/wallet");
  await expect(page.getByText("Switch to Base Sepolia")).toBeVisible();
  await page.getByRole("button", { name: "Switch network" }).click();
  await expect(page.getByText("Switch to Base Sepolia")).toBeHidden();
});

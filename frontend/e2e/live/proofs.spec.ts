import { readFileSync, existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedSession } from "../fixtures";
import { installWallet, ME, mockBackend, storeCalls } from "./fake";

const VECTORS = new URL("../../../spec/vectors/", import.meta.url);
const vector = (name: string) =>
  JSON.parse(readFileSync(new URL(`${name}.json`, VECTORS), "utf8")) as {
    bundle: { receipt: { root: `0x${string}`; body_hash: `0x${string}`; header: { task_id: `0x${string}` } } };
  };
type Receipt = {
  root: `0x${string}`;
  terminal_hash: `0x${string}`;
  body_hash: `0x${string}`;
  header: { task_id: `0x${string}`; phi_hash: `0x${string}` };
};
/** The on-chain commitment for a vector's receipt, as ReceiptRegistry and Escrow would return it. */
const committedFor = (r: Receipt) => ({
  [r.header.task_id]: {
    agentId: 1n,
    root: r.root,
    terminalHash: r.terminal_hash,
    bodyHash: r.body_hash,
    costMicros: 2400n,
    phiHash: r.header.phi_hash,
  },
});
const WASM_BUILT = existsSync(new URL("../../src/verifier/pkg/mergit_verifier_wasm.js", import.meta.url));

test.beforeEach(async ({ context }) => {
  await seedSession(context, ME);
  await installWallet(context);
});

test("proofs list shows receipts committed on chain", async ({ page }) => {
  const r = vector("valid_three_steps").bundle.receipt;
  await mockBackend(page, {
    commitments: [
      { taskId: r.header.task_id, agentId: 7n, root: r.root, bodyHash: r.body_hash, costMicros: 2400n, block: 42 },
    ],
  });
  await page.goto("/app/proofs");
  const row = page.getByRole("row", { name: new RegExp(r.header.task_id.slice(0, 10)) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Agent 7");
  await expect(row).toContainText("$0.0024");
});

test("proofs list says when nothing is committed yet", async ({ page }) => {
  await mockBackend(page, { commitments: [] });
  await page.goto("/app/proofs");
  await expect(page.getByText("No receipts committed yet")).toBeVisible();
});

test("proof detail says when nothing is committed on chain for the task", async ({ page }) => {
  await mockBackend(page);
  await page.goto(`/app/proofs/0x${"12".repeat(32)}`);
  await expect(page.getByText("No receipt is committed on chain for this task")).toBeVisible();
});

test("proof detail says when the store has no body for the committed hash", async ({ page }) => {
  const r = vector("valid_three_steps").bundle.receipt;
  await mockBackend(page, { committed: committedFor(r as unknown as Receipt) });
  await page.goto(`/app/proofs/${r.header.task_id}`);
  await expect(page.getByText("The receipt store has no body for this task")).toBeVisible();
});

test("proof detail fetches the bundle by the committed body hash, never by task id", async ({ page }) => {
  const v = vector("valid_three_steps");
  const r = v.bundle.receipt;
  await mockBackend(page, {
    committed: committedFor(r as unknown as Receipt),
    bundles: { [r.body_hash]: JSON.stringify(v.bundle) },
  });
  await page.goto(`/app/proofs/${r.header.task_id}`);
  await expect(
    page.getByText(WASM_BUILT ? "Verified, unattested (development key)" : "The in-browser verifier is not built"),
  ).toBeVisible();
  // React's development StrictMode runs effects twice; what matters is that every read is by the committed hash.
  expect(storeCalls.length).toBeGreaterThan(0);
  expect(new Set(storeCalls)).toEqual(new Set([`/v0/bundles/${r.body_hash}`]));
});

test("proof detail shows unattested (development key) and the verifier result", async ({ page }) => {
  test.skip(
    !WASM_BUILT,
    "needs the WASM verifier: wasm-pack build verifier/wasm --target web --out-dir ../../frontend/src/verifier/pkg",
  );
  const v = vector("valid_three_steps");
  const task = v.bundle.receipt.header.task_id;
  await mockBackend(page, {
    committed: committedFor(v.bundle.receipt as unknown as Receipt),
    bundles: { [v.bundle.receipt.body_hash]: JSON.stringify(v.bundle) },
  });
  await page.goto(`/app/proofs/${task}`);
  await expect(page.getByText("Verified, unattested (development key)")).toBeVisible();
  await expect(page.getByText("The task's check passed")).toBeVisible();
});

test("tampered proof shows invalid with reasons", async ({ page }) => {
  test.skip(!WASM_BUILT, "needs the WASM verifier");
  const v = vector("root_mismatch");
  const task = v.bundle.receipt.header.task_id;
  await mockBackend(page, {
    committed: committedFor(v.bundle.receipt as unknown as Receipt),
    bundles: { [v.bundle.receipt.body_hash]: JSON.stringify(v.bundle) },
  });
  await page.goto(`/app/proofs/${task}`);
  await expect(page.getByText("Invalid receipt")).toBeVisible();
  await expect(page.getByText(/ROOT_MISMATCH/)).toBeVisible();
});

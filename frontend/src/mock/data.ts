/*
 * Demo data for the dashboard. Nothing here is measured: every number is a
 * placeholder until the runtime and indexer exist. Swap these for API calls.
 */

export type AgentKind = "Planner" | "Research" | "Coder" | "Tester" | "Reviewer" | "Proof";
export type Status = "Completed" | "Verified" | "Running" | "Waiting" | "Failed" | "Neutral";
export type AppMark = "GH" | "SL" | "LN" | "NO";

export const CHAIN_LABEL = "L2 testnet";

export const me = {
  name: "Alex",
  initials: "AC",
  address: "0x6E2d…9A0b",
  addressLong: "0x6E2d 4A9c … 9A0b",
  repo: "acme/billing",
};

/* ---------- Overview ---------- */

export const overviewStats = [
  { label: "Runs", value: "24", sub: "+12% vs last week", trend: [8, 10, 9, 13, 12, 16, 15, 19, 24] },
  { label: "Success rate", value: "75%", sub: "18 of 24 completed", trend: [60, 62, 58, 66, 70, 68, 72, 74, 75] },
  { label: "Time saved", value: "42h", sub: "Across all runs", trend: [5, 9, 12, 16, 21, 25, 30, 36, 42] },
];

export type RunRow = {
  id: string;
  title: string;
  source: string;
  status: Status;
  agents: AgentKind[];
  apps: AppMark[];
  started: string;
};

export const runs: RunRow[] = [
  { id: "RUN-2048", title: "Fix authentication bug", source: "Slack #backend", status: "Completed", agents: ["Planner", "Research", "Coder", "Tester"], apps: ["GH", "SL", "LN"], started: "12m ago" },
  { id: "RUN-2047", title: "Implement CSV import validation", source: "Dashboard", status: "Running", agents: ["Planner", "Coder", "Tester"], apps: ["GH"], started: "2h ago" },
  { id: "RUN-2046", title: "Add webhook retry with backoff", source: "GitHub issue #212", status: "Waiting", agents: ["Planner", "Coder", "Reviewer"], apps: ["GH"], started: "3h ago" },
  { id: "RUN-2045", title: "Code review for PR #134", source: "Dashboard", status: "Failed", agents: ["Planner", "Reviewer"], apps: ["GH"], started: "5h ago" },
  { id: "RUN-2044", title: "Write incident note for checkout outage", source: "Slack #incidents", status: "Completed", agents: ["Research", "Proof"], apps: ["SL", "NO"], started: "1d ago" },
  { id: "RUN-2043", title: "Research and summarise rate limits", source: "Dashboard", status: "Completed", agents: ["Research"], apps: ["GH"], started: "1d ago" },
];

export const approvals = [
  { id: "a1", tool: "github.open_pull_request", summary: 'Open PR "Add token-bucket rate limit" on acme/billing', expires: 7 },
  { id: "a2", tool: "linear.create_issue", summary: 'File BIL-232 "CSV import skips rows" in Billing', expires: 9 },
];

export const activity = [
  { day: "Mon", completed: 9, failed: 1 },
  { day: "Tue", completed: 12, failed: 0 },
  { day: "Wed", completed: 7, failed: 2 },
  { day: "Thu", completed: 15, failed: 1 },
  { day: "Fri", completed: 11, failed: 0 },
  { day: "Sat", completed: 4, failed: 0 },
  { day: "Sun", completed: 6, failed: 1 },
];

/* ---------- Run workspace ---------- */

export type FlowNode = { key: string; agent: AgentKind; name: string; sub: string; duration: string };

export const runDetail = {
  id: "RUN-2048",
  title: "Fix authentication bug",
  summary: "Started 12m ago from Slack #backend by Priya N. 6 tasks, 3 in parallel, 2m 14s.",
  nodes: [
    { key: "p", agent: "Planner", name: "Planner", sub: "Split into 5 tasks", duration: "9s" },
    { key: "r", agent: "Research", name: "Research", sub: "Traced the auth flow", duration: "42s" },
    { key: "c", agent: "Coder", name: "Coder", sub: "Patched session check", duration: "1m 27s" },
    { key: "t", agent: "Tester", name: "Tester", sub: "47 tests passed", duration: "38s" },
    { key: "v", agent: "Reviewer", name: "Reviewer", sub: "Approved the diff", duration: "12s" },
    { key: "g", agent: "Proof", name: "Proof", sub: "Hashed and settled", duration: "6s" },
  ] satisfies FlowNode[],
  edges: [
    ["p", "r"],
    ["p", "c"],
    ["p", "t"],
    ["r", "v"],
    ["c", "v"],
    ["t", "v"],
    ["v", "g"],
  ] as const,
  log: [
    { t: "00:09", agent: "Research", tool: "slack.read_thread", detail: "#backend, 14 messages" },
    { t: "00:31", agent: "Research", tool: "github.read_file", detail: "src/auth/session.ts" },
    { t: "01:12", agent: "Coder", tool: "github.commit", detail: "fix/session-null-check +18 −6" },
    { t: "01:58", agent: "Tester", tool: "code_exec", detail: "pytest, 47 passed" },
    { t: "02:14", agent: "Proof", tool: "settle", detail: `6 receipts committed on ${CHAIN_LABEL}` },
  ] satisfies { t: string; agent: AgentKind; tool: string; detail: string }[],
};

export const nodeDetail: Record<
  string,
  { title: string; time: string; summary: string; tools: { icon: "github" | "search" | "file"; name: string; detail: string }[]; meta: [string, string][]; result: string }
> = {
  p: { title: "Planner", time: "9s", summary: "Read the Slack report and split it into five tasks, three of which can run in parallel.", tools: [{ icon: "file", name: "Slack", detail: "Read the #backend report" }], meta: [["Model", "Claude Sonnet 5"], ["Attempt", "1 of 3"], ["Tokens", "3.1k"], ["Cost", "$0.004"]], result: "Task graph sent to 5 agents" },
  r: { title: "Research agent", time: "42s", summary: "Read the #backend thread and traced the login flow. getSession() returns null for expired cookies, so the guard redirects before refresh runs.", tools: [{ icon: "github", name: "GitHub", detail: "Read 3 repository files" }, { icon: "search", name: "Web search", detail: "Session refresh patterns" }, { icon: "file", name: "Notion", detail: "Auth design doc" }], meta: [["Model", "Claude Haiku 4.5"], ["Attempt", "1 of 3"], ["Tokens", "14.2k"], ["Cost", "$0.012"]], result: "Findings saved to task output" },
  c: { title: "Code agent", time: "1m 27s", summary: "Refreshes the session before redirecting when a cookie is present, and adds a regression test for expired cookies.", tools: [{ icon: "github", name: "GitHub", detail: "Committed fix/session-null-check" }], meta: [["Model", "Claude Sonnet 5"], ["Attempt", "1 of 3"], ["Tokens", "22.8k"], ["Cost", "$0.041"]], result: "Patch committed, +18 −6" },
  t: { title: "QA agent", time: "38s", summary: "Ran the full suite against the patch. All 47 tests pass, including the new expired-cookie case.", tools: [{ icon: "file", name: "code_exec", detail: "pytest, 47 passed" }], meta: [["Model", "Llama 3.3 70B"], ["Attempt", "1 of 3"], ["Tokens", "6.4k"], ["Cost", "$0.003"]], result: "47 of 47 tests passed" },
  v: { title: "Review agent", time: "12s", summary: "Checked the diff against the findings. The change is scoped to the session guard and the new test covers it.", tools: [{ icon: "github", name: "GitHub", detail: "Reviewed PR #134" }], meta: [["Model", "Claude Sonnet 5"], ["Attempt", "1 of 3"], ["Tokens", "8.9k"], ["Cost", "$0.016"]], result: "Diff approved" },
  g: { title: "Proof", time: "6s", summary: "Hashed each task's receipt and committed the Merkle root. Evidence stays off chain.", tools: [{ icon: "file", name: "ReceiptRegistry", detail: "Committed 6 receipts" }], meta: [["Model", "None"], ["Attempt", "1 of 3"], ["Tokens", "0"], ["Cost", "$0.000"]], result: "6 receipts committed" },
};

/* ---------- Agents and leaderboard ---------- */

export type Agent = {
  kind: AgentKind;
  name: string;
  description: string;
  tags: string[];
  category: "Coding" | "Research" | "Testing" | "Writing";
  address: string;
  success: number;
  tasks: number;
  proofs: number;
  model: string;
  median: string;
  density: string;
  trend: number[];
};

export const agents: Agent[] = [
  { kind: "Coder", name: "Code agent", description: "Fixes bugs and ships features with tests.", tags: ["Coding", "GitHub", "Testing"], category: "Coding", address: "0x12ab…89cd", success: 97, tasks: 248, proofs: 230, model: "Claude Sonnet 5", median: "1m 12s", density: "4.9", trend: [3, 4, 4, 5, 6, 7] },
  { kind: "Research", name: "Research agent", description: "Reads threads, repos and docs to find the cause.", tags: ["Research", "Web search"], category: "Research", address: "0x34cd…12ef", success: 94, tasks: 186, proofs: 172, model: "Claude Haiku 4.5", median: "38s", density: "4.8", trend: [3, 3, 4, 5, 5, 6] },
  { kind: "Tester", name: "QA agent", description: "Writes and runs tests, checks every claim.", tags: ["Testing", "QA"], category: "Testing", address: "0x56ef…34ab", success: 92, tasks: 142, proofs: 138, model: "Llama 3.3 70B", median: "51s", density: "4.6", trend: [2, 3, 3, 4, 4, 5] },
  { kind: "Planner", name: "Planner", description: "Turns one sentence into a task graph.", tags: ["Planning", "Routing"], category: "Coding", address: "0x78ab…56cd", success: 98, tasks: 312, proofs: 120, model: "Claude Sonnet 5", median: "6s", density: "4.5", trend: [4, 3, 4, 4, 5, 5] },
  { kind: "Reviewer", name: "Review agent", description: "Reviews every diff before a PR opens.", tags: ["Review", "Security"], category: "Coding", address: "0x9cde…78ef", success: 90, tasks: 128, proofs: 104, model: "Claude Sonnet 5", median: "29s", density: "4.4", trend: [3, 3, 3, 4, 4, 4] },
  { kind: "Proof", name: "Docs agent", description: "Writes incident notes and release summaries.", tags: ["Writing", "Notion"], category: "Writing", address: "0xb1a2…c3d4", success: 91, tasks: 96, proofs: 92, model: "Claude Haiku 4.5", median: "51s", density: "4.3", trend: [2, 2, 3, 3, 4, 4] },
];

/** Leaderboard order differs from the directory: Planner ranks by density, not task count. */
export const leaderboard: (Agent & { lbSuccess: number; lbTasks: number })[] = [
  { ...agents[0], lbSuccess: 97, lbTasks: 248 },
  { ...agents[1], lbSuccess: 94, lbTasks: 186 },
  { ...agents[2], lbSuccess: 92, lbTasks: 142 },
  { ...agents[3], lbSuccess: 90, lbTasks: 128 },
  { ...agents[4], lbSuccess: 89, lbTasks: 110 },
  { ...agents[5], lbSuccess: 91, lbTasks: 96 },
];

/* ---------- Proof ---------- */

export const proof = {
  id: "#1840",
  artifactHash: "0x8f2a7c31…d4e9f2b1",
  artifactHashFull: "0x8f2a7c31b04e9a6d215c7f0e83a9d4e9f2b1",
  facts: [
    ["Transaction", "0xa9c3…08d2", "tx"],
    ["Block", "18,431,190", "mono"],
    ["Chain", CHAIN_LABEL, "text"],
    ["Contract", "ReceiptRegistry 0x4B1e…02aF", "mono"],
    ["Confirmations", "1,204", "mono"],
    ["Settled", "41s after the task finished", "text"],
  ] as [string, string, "tx" | "mono" | "text"][],
  timeline: [
    ["Task done", "14:02:11"],
    ["Hashed", "14:02:12"],
    ["Queued", "14:02:12"],
    ["Confirmed", "14:02:52"],
  ],
  checks: ["Output admits no failure", "Every URL came from a tool", "Files really changed", "Tests ran in this task"],
  diff: [
    [11, " ", "export async function requireSession(req: Request) {"],
    [12, " ", '  const cookie = req.headers.get("cookie");'],
    [13, "-", "  const session = await getSession(req);"],
    [14, "-", "  if (!session) return null;"],
    [13, "+", "  let session = await getSession(req);"],
    [14, "+", "  if (!session && cookie) {"],
    [15, "+", "    session = await refreshSession(cookie);"],
    [16, "+", "  }"],
    [17, "+", '  if (!session) return redirect("/login");'],
    [18, " ", "  return session.user;"],
    [19, " ", "}"],
  ] as [number, " " | "+" | "-", string][],
  testDiff: [
    [1, "+", 'test("refreshes an expired session before redirecting", async () => {'],
    [2, "+", '  const req = mockRequest({ cookie: "sid=expired" });'],
    [3, "+", "  expect(await requireSession(req)).toEqual(user);"],
    [4, "+", "});"],
  ] as [number, "+", string][],
  canonical: [
    "{",
    '  "task": "RUN-2048/t3",',
    '  "agent": "0x12ab…89cd",',
    '  "files_changed": ["src/auth/session.ts", "tests/session.test.ts"],',
    '  "tests": { "ran": 47, "passed": 47 },',
    '  "pr": "acme/web#134",',
    '  "sha256": "0x8f2a7c31…d4e9f2b1"',
    "}",
  ],
  toolResults: [
    ["github.read_file", "src/auth/session.ts", "ok"],
    ["github.commit", "fix/session-null-check +18 −6", "ok"],
    ["code_exec", "pytest, 47 passed", "ok"],
    ["github.open_pull_request", "acme/web#134", "ok"],
  ],
};

/* ---------- New run ---------- */

export const draftPlan: { agent: AgentKind; task: string; tools: string; gate?: boolean }[] = [
  { agent: "Planner", task: "Plan the work from the Slack report", tools: "plan" },
  { agent: "Research", task: "Read the thread and locate the bug", tools: "slack.read_thread, github.read_file" },
  { agent: "Coder", task: "Fix it with a regression test", tools: "code_exec, github.commit" },
  { agent: "Tester", task: "Run the full test suite", tools: "code_exec" },
  { agent: "Reviewer", task: "Open the PR and file BIL-231", tools: "github.open_pull_request", gate: true },
  { agent: "Proof", task: "Reply in the thread and settle proofs", tools: "slack.reply_in_thread" },
];

export const defaultPrompt =
  "The invoice total in #backend is off by the tax amount for EU customers. Find the cause in acme/billing, fix it with a test, open a PR and reply in the thread with the link.";

export const askBefore = [
  { label: "Opening a pull request", on: true },
  { label: "Posting in Slack", on: true },
  { label: "Filing Linear issues", on: false },
  { label: "Running code", on: false },
];

export const templates = ["Fix a bug from Slack", "Triage issues into Linear", "Write an incident note"];

/* ---------- Integrations ---------- */

export const integrations = [
  { mark: "GH", github: true, name: "GitHub", description: "Read repos, commit on branches, open and update PRs.", connected: true, tools: "21 tools", calls: "1,284 calls this month" },
  { mark: "SL", github: false, name: "Slack", description: "Read the thread a bug is reported in and reply there.", connected: false, tools: "5 tools", calls: "Not connected" },
  { mark: "LN", github: false, name: "Linear", description: "File issues, move them through states, comment outcomes.", connected: false, tools: "6 tools", calls: "Not connected" },
  { mark: "NO", github: false, name: "Notion", description: "Write the incident note the fix is explained in.", connected: true, tools: "4 tools", calls: "231 calls this month" },
];

export const githubPermissions: [string, string, "Write" | "Read" | "None"][] = [
  ["contents", "Read files and commit on mergit/* branches", "Write"],
  ["pull_requests", "Open and update pull requests", "Write"],
  ["issues", "Comment on the issue that started a run", "Write"],
  ["metadata", "List the repositories you selected", "Read"],
  ["workflows", "Never requested", "None"],
];

export const toolCalls: { mark: AppMark; tool: string; ref: string; ok: boolean; when: string }[] = [
  { mark: "GH", tool: "github.open_pull_request", ref: "acme/web#134", ok: true, when: "2h" },
  { mark: "NO", tool: "notion.create_page", ref: "Incident note, checkout", ok: true, when: "5h" },
  { mark: "GH", tool: "github.commit", ref: "fix/session-null-check", ok: true, when: "5h" },
  { mark: "GH", tool: "github.read_file", ref: "src/auth/session.ts", ok: true, when: "6h" },
  { mark: "LN", tool: "linear.create_issue", ref: "BIL-229, triaged from #212", ok: true, when: "1d" },
  { mark: "SL", tool: "slack.reply_in_thread", ref: "Refused, Slack not connected", ok: false, when: "1d" },
];

/* ---------- Wallet ---------- */

export const wallet = {
  balance: "4.812",
  unit: "ETH",
  identity: {
    name: "Alex's agent team",
    did: "did:mergit:0x6E2d…9A0b",
    stats: [
      ["Value density", "4.8"],
      ["Tasks", "124"],
      ["Proofs", "118"],
      ["Chain", "L2"],
    ],
    note: "Registered at block 18,204,113. It cannot be transferred, and value density only moves when an audited receipt settles.",
  },
  outbox: [
    ["Settled", "1,842", "var(--mint)"],
    ["Pending", "2", "var(--azure)"],
    ["Dead-lettered", "3", "var(--red)"],
  ],
  contracts: [
    ["Identity", "0x9A41…e7C2"],
    ["ReceiptRegistry", "0x4B1e…02aF"],
    ["ReputationAnchor", "0xC7d3…51b9"],
  ],
  lag: [42, 38, 51, 40, 36, 44, 39, 47, 41, 35, 38, 43],
  settlements: [
    { agent: "Reviewer", task: "Reply in #backend thread", block: "18,431,207", tx: "0x7b2d…4e91", settled: true, when: "17m" },
    { agent: "Coder", task: "PR #134, fix auth flow", block: "18,431,201", tx: "0x30af…1c77", settled: true, when: "18m" },
    { agent: "Tester", task: "Test results, 47 passed", block: "18,431,190", tx: "0xa9c3…08d2", settled: true, when: "19m" },
    { agent: "Proof", task: "Incident note, checkout", block: "18,431,181", tx: "0x5e16…bb3a", settled: true, when: "19m" },
    { agent: "Planner", task: "Plan for RUN-2047", block: "18,431,176", tx: "0x2c90…7a14", settled: true, when: "2h" },
    { agent: "Research", task: "Located the import bug", block: "pending", tx: "queued", settled: false, when: "40s" },
  ] satisfies { agent: AgentKind; task: string; block: string; tx: string; settled: boolean; when: string }[],
};

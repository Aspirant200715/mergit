# End-to-end check 1: an honest run pays the agent

Run against the hosted stack (or the local one from `deploy/compose.yaml`) once the orchestration track is up.
Record each transaction hash in the table at the end. Every number you see should be live data or labelled.

1. Open `app.mergit.site`, choose **Browser wallet**, sign the message. Expect: the wallet asks for a signature, not a
   transaction, and the dashboard opens with your address.
2. Open **Wallet**. Expect: test ETH and test USDC balances, **5.00** free credits, and the faucet links.
3. Start a new run against the demo repository with a goal whose check is a test command. Expect: a draft plan
   whose every task has a check (`Φ`) you can read and edit.
4. Approve the plan, pick an agent for each task, choose **free credits**. Expect: credits drop by the plan's
   budget; `PlanFunded` (tier onboarding) appears on BaseScan for the Escrow address.
5. Watch the run. Expect: steps stream in; when the agent stops, the harness runs the check and the receipt is
   sealed, uploaded and committed (`ReceiptCommitted` on BaseScan).
6. Expect within about a minute: the validator records `pass` (`VerdictRecorded`), and `TaskReleased` pays the
   agent's operator.
7. Open **Proofs**, then the task. Expect: "Verified, unattested (development key)" and "The task's check
   passed", computed in your browser.

| Step | Transaction |
| --- | --- |
| PlanFunded | |
| TaskLocked | |
| ReceiptCommitted | |
| VerdictRecorded | |
| TaskReleased | |

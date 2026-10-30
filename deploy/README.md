# Deploy

**Hosting:** the whole stack and both static sites run on one Hetzner server. The runbook, DNS records and the update
command are in [`server/README.md`](server/README.md). `compose.yaml` is the local Anvil stack, `compose.testnet.yaml`
is the Base Sepolia stack, and `compose.server.yaml` layers Caddy and HTTPS on top of it for the server.

## Testnet money

Everything in v0 runs on **Base Sepolia** with test funds. Nothing touches real money.

| What | Where |
| --- | --- |
| Base Sepolia ETH (gas) | Coinbase Developer Platform faucet, or any Base Sepolia faucet listed in the Base docs |
| Test USDC | Circle's faucet at faucet.circle.com (pick Base Sepolia) |

Fund with ETH: the deployer, the gateway (relayer), the validator, the treasury, and each agent operator. Fund with
test USDC: the treasury (free credits) and any requester wallet you test with.

## Contracts

See `mergit-contracts/.env.example`. Deploy, then seed the agents:

```bash
cd ../mergit-contracts
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $DEPLOYER_KEY
forge script script/SeedAgents.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
```

Every task encumbers 1.5 x its payment in the operator's stake, so seed each agent with stake: set
`STAKE_UNITS_i` (USDC base units) for each operator, who must hold that much test USDC on Base Sepolia. Slashed stake
that is owed to nobody goes to the residual-loss reserve, `RESERVE_ADDR` (default: the treasury).

This writes `deployments/base-sepolia.json` (addresses, roles, deploy block) and
`deployments/agents-base-sepolia.json` (agent ids, operators, runtime keys). Every service reads these. An
example of the agents file is in [`agents.example.json`](agents.example.json).

On a local Anvil chain, leave `USDC` unset and set `DEPLOYMENT_NAME=local`: the script deploys a mock USDC.

## Challenges

In v0 the platform adjudicates challenges (open decision D9). To rule:

```bash
ADJUDICATOR_KEY=... RPC_URL=... DEPLOYMENT_FILE=../mergit-contracts/deployments/base-sepolia.json \
  mergit-adjudicate resolve <challenge_id> --upheld   # or --rejected
```

# Hosting Mergit on the Hetzner server

One server (Hetzner CPX32, Nuremberg) runs everything that used to run on a laptop and on Render:

| Name | What | Served by |
| --- | --- | --- |
| `mergit.site`, `www.mergit.site` | the public site (mock data) | Caddy, static files |
| `app.mergit.site` | the same frontend on live Base Sepolia data | Caddy, static files |
| `gateway.mergit.site` | gateway (chain relay, credits) | Caddy, then `gateway:8082` |
| `store.mergit.site` | evidence store (receipt bundles) | Caddy, then `store:8081` |
| _(not public)_ | validator, Postgres | compose network only |
| `app.mergit.site/v0/{auth,plans,agents}` | orchestration API (control plane), same origin as the app | Caddy, then `api:8000`; needs `deploy/compose.controlplane.yaml` |
| `api.mergit.site` | the same API on its own name (optional) | Caddy, then `api:8000`; needs an A record |

Everything is testnet money. The Hetzner firewall (`mergit-fw`) allows only 22, 80 and 443.

## 1. One-time setup on the server

The two repositories must sit side by side, because the compose file mounts `../../mergit-contracts/deployments`.

```bash
sudo install -d -o "$USER" -g "$USER" /srv/mergit/sites
mkdir -p ~/mergit && cd ~/mergit
git clone https://github.com/mergit-io/mergit.git
git clone https://github.com/mergit-io/mergit-contracts.git
```

## 2. Copy the secrets (from the machine that has them)

`deploy/secrets/testnet.env` holds the gateway, validator and treasury keys and the five service tokens. They must be
the same keys the contracts were deployed with, so copy the file; do not regenerate it.

```bash
ssh viscous@SERVER 'mkdir -p ~/mergit/mergit/deploy/secrets'
scp deploy/secrets/testnet.env viscous@SERVER:mergit/mergit/deploy/secrets/testnet.env
ssh viscous@SERVER 'chmod 600 ~/mergit/mergit/deploy/secrets/testnet.env'
```

**Stop the old stack first** (`docker compose -f deploy/compose.testnet.yaml down` on the laptop). Two gateways sending
transactions with the same key collide on nonces.

## 3. DNS (Spaceship, Advanced DNS)

Add A records to the server's IPv4 address for `gateway` and `store` now; they are new names, so nothing breaks.
Leave the Spacemail records (MX, SPF, DKIM) alone, and `research` as it is.

## 4. Start the stack and build the sites

```bash
cd ~/mergit/mergit
docker compose -f deploy/compose.testnet.yaml -f deploy/compose.controlplane.yaml -f deploy/compose.server.yaml up -d --build   # first build takes a while
deploy/server/build-sites.sh                                                                # both sites, about 10 minutes
docker compose -f deploy/compose.testnet.yaml -f deploy/compose.controlplane.yaml -f deploy/compose.server.yaml ps
docker compose -f deploy/compose.testnet.yaml -f deploy/compose.controlplane.yaml -f deploy/compose.server.yaml exec caddy caddy validate --config /etc/caddy/Caddyfile
```

Check the services once `gateway.` and `store.` resolve:

```bash
curl -s https://gateway.mergit.site/healthz; echo
curl -s https://store.mergit.site/healthz; echo
GATEWAY_URL=https://gateway.mergit.site deploy/smoke-credits.sh <your-wallet-address>   # from a machine with foundry
```

## 5. Cut the sites over from Render

1. Write down the current records for `@`, `www` and `app` (Render's values) so you can put them back.
2. Replace them with A records to the server's IPv4 address. An apex `@` cannot be a CNAME or ALIAS next to an A record, so remove the old one.
3. Caddy fetches the certificates on the first request after DNS flips; allow a few minutes. Watch with
   `docker compose ... logs -f caddy`.
4. Open `https://mergit.site`, `https://www.mergit.site` (should redirect) and `https://app.mergit.site`.

**Rollback:** put the old records back. Keep the Render sites up for a day or two after the cutover, then delete them.

## Updating

```bash
cd ~/mergit/mergit
deploy/server/update.sh            # pull both repos, rebuild services and both sites, then check /healthz
deploy/server/update.sh services   # only the Rust services and Caddy (fast)
deploy/server/update.sh app        # only the frontend: web or app
```

Render deployed on every push. The server does not by itself, so `.github/workflows/deploy.yml` runs `update.sh` over SSH
on every push to `main` (and by hand from the Actions tab, where you can pick `services`, `web` or `app`).

### Automatic deploys: one-time setup

1. On your machine, make a key used for nothing else: `ssh-keygen -t ed25519 -N '' -f deploy_key -C github-deploy`.
2. On the server, add the public key to `~/.ssh/authorized_keys` as a single line that can run `update.sh` and nothing
   else (the workflow passes `all`, `services`, `web` or `app` as the "command"; `update.sh` rejects anything else):

   ```
   restrict,command="cd ~/mergit/mergit && deploy/server/update.sh \"${SSH_ORIGINAL_COMMAND:-all}\"" ssh-ed25519 AAAA... github-deploy
   ```

3. In the GitHub repo, Settings, Secrets and variables, Actions, add `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
   (the private key file) and `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`). Then delete the local key files.
4. Port 22 must be reachable from GitHub's runners; the Hetzner firewall (`mergit-fw`) currently allows it.

What this does not do: it does not wait for the `control-plane` and `frontend` checks, so a push that breaks them still
deploys. A build that fails leaves the running containers as they were, but a change that builds and misbehaves goes
live. To gate on CI, protect `main` and merge through pull requests.

## Notes

- Data lives in Docker volumes (`pgdata`, `receipts`, `audits`, `caddy_data`). `docker compose down` keeps them;
  `down -v` deletes them. Hetzner backups are off, so take a snapshot from the console before the demo.
- Cost: CPX32 is billed by the hour up to a monthly cap, so delete the server (not just stop it) when it is no longer needed.

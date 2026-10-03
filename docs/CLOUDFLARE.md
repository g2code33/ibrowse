# Cloudflare Pages deployment

Yayra's PWA is deployed as a static Cloudflare Pages project. The deploy is terminal-first and the GitHub release workflow deploys the same `dist/` bundle on every push to `main` when the Cloudflare secrets are configured.

## One-time terminal setup

```bash
export CLOUDFLARE_API_TOKEN='paste-your-token-in-your-shell-only'
export CLOUDFLARE_ACCOUNT_ID='your-account-id'
export CLOUDFLARE_PROJECT_NAME='yayra'

npm ci
npx --yes wrangler@4 pages project create "$CLOUDFLARE_PROJECT_NAME" --production-branch main
npm run deploy:cloudflare
```

If the Pages project already exists, skip the `pages project create` command. The token needs Pages edit/deploy permission for the account. Do not commit these values or put them in chat.

## Local terminal deploy

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
export CLOUDFLARE_PROJECT_NAME='yayra'
npm run deploy:cloudflare
```

## GitHub Actions secrets

Add the same three values in the repository's **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PROJECT_NAME`

The `cloudflare-pages` job downloads the exact web bundle produced by the `web` job and runs `wrangler pages deploy` on every `main` push. If credentials are not configured, the workflow records a warning and does not claim that a deployment happened.

# Cloudflare Pages: terminal-only setup

Yayra uses a static Cloudflare Pages project. The setup, first deployment, and GitHub Actions secret configuration can all be run from a terminal. No Cloudflare Pages dashboard project creation or GitHub settings clicks are required.

## 1. Authenticate in the terminal

Use Wrangler if this machine is not authenticated yet:

```bash
npx --yes wrangler@4 login
npx --yes wrangler@4 whoami
```

For the local deploy and GitHub Actions, use a scoped Cloudflare API token with Pages edit/deploy access for the target account. Keep it in the shell environment only:

```bash
export CLOUDFLARE_API_TOKEN='paste-the-token-here-in-your-terminal-only'
export CLOUDFLARE_ACCOUNT_ID='your-account-id'
export CLOUDFLARE_PROJECT_NAME='yayra'
```

The setup command can discover `CLOUDFLARE_ACCOUNT_ID` when the token has access to exactly one account. Set it explicitly when the token can access more than one account.

## 2. Create, deploy, and configure GitHub Actions from the terminal

Run this from the repository root:

```bash
npm ci
npm run setup:cloudflare
```

The command is idempotent. It will:

1. Create the Pages project if it does not exist, with `main` as its production branch.
2. Build the PWA into `dist/`.
3. Deploy `dist/` to the `main` Pages deployment.
4. Set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_PROJECT_NAME` as GitHub Actions secrets using `gh`.

If `CLOUDFLARE_API_TOKEN` is not already exported, the Bash wrapper prompts for it with hidden input. The setup command never prints the token or writes it to the repository. It requires GitHub CLI authentication:

```bash
gh auth login
gh auth status
```

To use a different project name without editing files:

```bash
CLOUDFLARE_PROJECT_NAME='another-pages-name' npm run setup:cloudflare
```

## 3. Terminal-only redeploys

After the project exists, a local production deployment is:

```bash
npm run deploy:cloudflare
```

The command requires the same three environment variables:

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
export CLOUDFLARE_PROJECT_NAME='yayra'
npm run deploy:cloudflare
```

## 4. GitHub Actions behavior

Every push to `main` builds the PWA, Android, Linux, and Windows artifacts. When the three Cloudflare secrets are present, the release workflow deploys the exact web bundle from the PWA build job to the Pages `main` branch. If the secrets are absent, the workflow records a warning instead of falsely claiming that a deployment occurred.

Verify the configured secrets without revealing their values:

```bash
gh secret list --repo "$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
```

Verify the live deployment from the terminal:

```bash
curl --fail --silent --show-error "https://${CLOUDFLARE_PROJECT_NAME}.pages.dev/" >/dev/null
echo 'Cloudflare Pages is reachable'
```

Never commit `.env` files, tokens, private keys, or credentials.

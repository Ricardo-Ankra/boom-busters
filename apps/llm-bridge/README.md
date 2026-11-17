# llm-bridge: Claude calls on your subscription, from your PC

The deployed app on Vercel normally calls Anthropic with the API key stored in
Settings → Connections, and pays per token. With this bridge running on your PC,
the deployed app sends its Anthropic calls here instead, and they run on your
Claude subscription through the Claude Agent SDK (decision 469).

You keep working in the deployed web app as before. Nothing else changes:

- **PC on, bridge running:** Anthropic calls go to your PC and cost nothing per
  token. The cost ledger books them at $0 and labels them `billing: subscription`.
- **PC off, asleep, or offline:** the run parks. Nothing falls back to the API
  key. The dossier runner shows a "Waiting for your PC" card with a **Resume**
  button; the other runners stop the stage with the reason, and you run it again
  once the PC is back.
- **Plan limit spent, or extra usage about to start:** the run parks the same
  way. The bridge stops a call rather than run into paid extra usage.
- **Settings → Connections → Verify** and the model list still use the stored
  API key, as before.
- OpenAI and Google calls are unchanged.

> **Personal, single-user use only.** The token below is tied to your own
> Claude account and plan. Do not share it, do not put it on Vercel or any
> other server, and do not let anyone else use the app through it. Anthropic's
> terms ask developers building products on the Agent SDK to use API keys, and
> they may act on misuse without notice. Your plan's limits are also shared
> with your own Claude Code use, so a big run can use up hours of your coding
> allowance.

## One-time setup

### 1. Generate the subscription token

In a terminal, run:

```bash
claude setup-token
```

Approve access in the browser. The token prints in the terminal and lasts one
year. It is not saved anywhere, so copy it straight into step 2.

### 2. Put it in `apps/llm-bridge/.env`

Copy [.env.example](.env.example) to `apps/llm-bridge/.env`. The file is
git-ignored and must never be committed. Fill in:

```dotenv
CLAUDE_CODE_OAUTH_TOKEN="the token from step 1"
LLM_BRIDGE_SECRET="a long random value, see below"
```

Generate the secret with `openssl rand -base64 32`. The same value goes on
Vercel in step 4.

Do **not** set `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` here or anywhere
in the bridge's environment. Claude Code uses either one ahead of your
subscription and bills the API, so the bridge refuses to start if it finds one.

### 3. Start the bridge and open it to the internet with Tailscale Funnel

From the repo root:

```bash
pnpm --filter @boom-busters/llm-bridge start
```

It listens on `127.0.0.1:8787` only. To reach it from Vercel, install
[Tailscale](https://tailscale.com/download), sign in, then run:

```bash
tailscale funnel --bg 8787
```

The first time, Tailscale asks you to approve Funnel for the machine in its admin
console. The command prints your public address, which looks like
`https://your-pc.your-tailnet.ts.net`.

### 4. Tell Vercel where the bridge is

In the Vercel project, under Settings → Environment Variables, for
**Production**:

| Name                | Value                                        |
| ------------------- | -------------------------------------------- |
| `LLM_BRIDGE_URL`    | the Funnel address from step 3               |
| `LLM_BRIDGE_SECRET` | the same secret as in `apps/llm-bridge/.env` |

Then redeploy. Never add `CLAUDE_CODE_OAUTH_TOKEN` to Vercel: the app refuses
to boot with it there.

To go back to the API key, remove both variables from Vercel and redeploy.

### 5. Keep it running

The bridge and Funnel need to be running whenever you want subscription
billing. `tailscale funnel --bg` survives restarts on its own. To start the
bridge when you sign in to Windows, create a Task Scheduler task that runs
`pnpm --filter @boom-busters/llm-bridge start` in the repo folder at log on.
Set Windows sleep to "Never" while the PC is plugged in, or runs will park
whenever it sleeps.

## What the bridge allows Claude to do

Nothing but write text. Every call runs with:

- no tools (no shell, files or web);
- no settings, `CLAUDE.md`, skills, hooks or MCP servers loaded from disk;
- one turn, no saved session, and an empty working folder;
- a child environment built from an allow-list. It holds the token and the few
  variables a process needs to start, and never `ANTHROPIC_API_KEY`, the
  database URL or any other secret.

Requests must carry an HMAC signature made with `LLM_BRIDGE_SECRET` and a
timestamp less than five minutes old. Anything else is refused before it is
read. The bridge logs which task ran and how long it took. It never logs a
prompt, an answer or the token.

## Development

```bash
pnpm --filter @boom-busters/llm-bridge test       # unit tests, Agent SDK mocked
pnpm --filter @boom-busters/llm-bridge typecheck
```

The tests never call Claude. The adapter on the app side lives in
`packages/providers/src/llm/subscription-bridge.ts`, and the shared wire format
in `packages/providers/src/llm/bridge-protocol.ts`.

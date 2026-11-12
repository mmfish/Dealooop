# Connecting Claude Desktop (local)

The founder's (and later the creator's) personal agent is Claude Desktop talking to this
repository's local MCP server over stdio. Nothing needs a public address or OAuth, and the server
makes no Anthropic API calls: the Claude in the window is the agent. The public deployment uses
the OAuth-protected `/mcp` endpoint instead (SPEC §15).

## Setup

```bash
nvm use
npm run mcp:config -- --role founder --user summer --name "Summer"           # print the entry
npm run mcp:config -- --role founder --user summer --name "Summer" --install # merge it into Claude Desktop's config, with a backup
```

Then quit Claude Desktop completely (⌘Q) and reopen it. In a new chat, the "+" menu →
Connectors should list **dealoop-founder**.

The server uses `data/dealoop.sqlite`, the same file as the local web server on port 3200, so the
platform pages show what Claude does.

## Identity

On a local machine the person who started the process is the owner, so the role and user come
from the config entry's `env` (`DEALOOP_ROLE`, `DEALOOP_USER_ID`, `DEALOOP_USER_NAME`). A
founder sees only their own campaigns' reports. A creator window gets creator tools only.

## Tools (founder)

| Tool | What it does |
|---|---|
| `get_my_identity` | Role, user, the platform's date |
| `post_campaign` | Claude passes the founder's messages verbatim and, for every value, the words it came from. The platform checks each value against those words (`judgeExtraction`); anything missing or not stated comes back as the question to ask. `preview: true` first, then `preview: false` after the founder agrees. Retrying returns the same campaign. |
| `list_my_campaigns`, `list_open_campaigns` | Lists |
| `campaign_report` | Sign-ups, budget committed, price changes, top creators, deals, recent activity; after closing, what was paid and the average cost per sign-up |

## Troubleshooting

- Logs: `tail -n 50 -f ~/Library/Logs/Claude/mcp*.log` (`mcp-server-dealoop-founder.log` has the
  server's own stderr, including "Dealoop MCP ready").
- Run the server by hand to see errors: `DEALOOP_ROLE=founder node --experimental-transform-types mcp/stdio.ts`
  (it then waits for protocol input on stdin; Ctrl-C to stop).
- After changing Node versions, rerun `--install`: the entry stores the absolute path to `node`.

## Still to decide

Two Claude windows for the demo (founder and top creator): one Claude Desktop loads every
configured server into every chat, so the creator needs either a second machine against a shared
database, or a second client (for example Claude Code with its own MCP entry) on this machine.

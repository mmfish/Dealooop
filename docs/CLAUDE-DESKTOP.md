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
| `list_creator_questions` | Questions creators asked that the brief does not answer; that creator has not joined yet |
| `answer_creator_question` | `preview: true` with a wording, show it to the founder; then `preview: false` with the same wording, the founder's messages, and the exact words in which they approved. The creator then joins with that wording. |
| `campaign_report` | Sign-ups, budget committed, price changes, top creators, deals, recent activity; after closing, what was paid and the average cost per sign-up |

## Private deal tools (both roles; demo beat 6)

| Tool | Who | What it does |
|---|---|---|
| `open_private_deal` | creator | Opens a negotiation on a campaign and makes the first proposal. Needs the creator's track record (the platform checks it) and their lowest deal price in their own words (`limit_price_dollars` + `limit_price_quote` + `owner_messages`). |
| `join_campaign` | creator | Joins a campaign at the public price (agreeing a deal joins too) |
| `list_deal_negotiations`, `read_deal_negotiation` | both | Whose turn it is, the terms on the table, the conversation and the public facts |
| `deal_move` | both | Propose, accept or reject. The founder passes their own limit (price and number of sign-ups) on their first move. |

Each owner's limit is held only in their own server process and never written to the database.
A move past it comes back as `needs_your_owner` with the question to ask; Claude calls again with
the owner's reply, and only words that state the new number, or say yes to the terms just asked
about, widen it. `core/negotiation.ts` judges every move: two rounds at most, the founder's last
reply cannot counter, and a message that reveals the sender's limit is refused.

Yi's window: `npm run mcp:config -- --role creator --user yi --name "Yi"`. One Claude Desktop
loads every configured server into every chat, so Yi's server must not be installed next to
Summer's in the same app (see below).

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

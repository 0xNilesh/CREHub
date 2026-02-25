# MetaMask MCP Server

Connect Claude.ai to your MetaMask wallet. Ask Claude to check balances, sign messages, send transactions, manage tokens, and switch networks — all confirmed through MetaMask popups in your browser.

## How It Works

```
Claude.ai  ──HTTPS──►  ngrok tunnel  ──►  MCP server (localhost:3000)
                                                    │
                                               WebSocket
                                                    │
                                          bridge tab (your browser)
                                                    │
                                             window.ethereum
                                                    │
                                               MetaMask 🦊
```

1. The MCP server runs locally and exposes a `/mcp` HTTP endpoint.
2. ngrok makes that endpoint reachable from the internet so Claude.ai can connect to it.
3. You open a bridge page (`http://localhost:3000`) in the same browser where MetaMask is installed. That tab relays commands from Claude to your wallet.
4. Every sensitive action (send tx, sign message, etc.) still requires **your approval in MetaMask** — Claude never touches your keys.

---

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- [MetaMask](https://metamask.io) browser extension
- [ngrok](https://ngrok.com) (free account is enough)

---

## Installation

```bash
git clone <repo>
cd metamask-mcp
npm install
```

---

## Running

### 1. Start the MCP server

```bash
npm run dev
```

You'll see:

```
=======================================================
 MetaMask MCP Server
=======================================================
 Local:        http://localhost:3000
 MCP endpoint: http://localhost:3000/mcp
 ...
```

### 2. Expose it with ngrok

In a separate terminal:

```bash
ngrok http 3000
```

Copy the HTTPS forwarding URL, e.g.:

```
https://abc123.ngrok-free.app
```

### 3. Add as a Connector on Claude.ai

1. Go to **https://claude.ai/customize/connectors**
2. Click **Add connector**
3. Enter the URL: `https://abc123.ngrok-free.app/mcp`
4. Save

### 4. Open the bridge page

In the **same browser where MetaMask is installed**, open:

```
http://localhost:3000
```

You'll see a status page. Click **Connect MetaMask** to authorize.
Keep this tab open — it must stay connected for Claude to reach your wallet.

### 5. Chat on Claude.ai

Start a conversation. Claude now has access to your MetaMask. Try:

> *"What's my ETH balance?"*
> *"Sign the message: Hello from Claude"*
> *"What network am I on?"*
> *"Add the Polygon network to MetaMask"*

---

## Available Tools

### Connection & Status

| Tool | Description |
|------|-------------|
| `metamask_bridge_status` | Check if the browser bridge is connected. Call this first if something seems wrong. |
| `metamask_connect` | Request wallet access — triggers the MetaMask connection popup. |
| `metamask_get_accounts` | List connected accounts (no popup). |

### Network

| Tool | Description |
|------|-------------|
| `metamask_get_chain` | Get the current network name and chain ID. |
| `metamask_switch_chain` | Switch to a different network (e.g. Polygon, Arbitrum). |
| `metamask_add_chain` | Add a custom network to MetaMask. |

**`metamask_add_chain` parameters:**
- `chain_id` — numeric chain ID, e.g. `137`
- `name` — display name, e.g. `"Polygon Mainnet"`
- `rpc_url` — RPC endpoint URL
- `symbol` — native token symbol, e.g. `"MATIC"`
- `explorer_url` *(optional)* — block explorer URL

**Common chain IDs:**

| Network | Chain ID |
|---------|----------|
| Ethereum | 1 |
| Polygon | 137 |
| Arbitrum One | 42161 |
| Base | 8453 |
| Optimism | 10 |
| BNB Chain | 56 |
| Avalanche | 43114 |
| Sepolia (testnet) | 11155111 |

### Native Token (ETH / MATIC / etc.)

| Tool | Description |
|------|-------------|
| `metamask_get_balance` | Get ETH (or native token) balance of any address. |
| `metamask_send_transaction` | Send ETH or call a contract. Shows MetaMask confirmation popup. |
| `metamask_get_receipt` | Check if a submitted transaction was confirmed. |
| `metamask_estimate_gas` | Estimate gas cost for a transaction. |
| `metamask_gas_price` | Get current network gas price in Gwei. |

### ERC-20 Tokens

| Tool | Description |
|------|-------------|
| `metamask_watch_token` | Add a token to MetaMask's token list. |
| `metamask_get_token_info` | Read token name, symbol, and decimals from any contract. |
| `metamask_get_token_balance` | Get ERC-20 balance of any address. Returns human-readable amount. |
| `metamask_transfer_token` | Send ERC-20 tokens. Shows MetaMask confirmation popup. |
| `metamask_approve_token` | Approve a spender (DEX/protocol) to use your tokens. |
| `metamask_get_token_allowance` | Check how much a spender is approved to spend. |

### Signing & Advanced

| Tool | Description |
|------|-------------|
| `metamask_sign_message` | Sign a plain-text message (EIP-191). |
| `metamask_sign_typed_data` | Sign EIP-712 structured data (permits, Seaport orders, etc.). |
| `metamask_call` | Read-only contract call (view/pure functions, no gas). |

---

## Example Conversations

**Check balances:**
> "What's my ETH balance on the current network?"
> "How many USDC do I have? The contract is 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

**Add a token:**
> "Add LINK token to MetaMask. Contract is 0x514910771AF9Ca656af840dff83E8264EcF986CA, 18 decimals."

**Send tokens:**
> "Send 5 USDC to 0xRecipient... (USDC contract: 0xA0b8...)"

**Approve a DEX:**
> "Approve Uniswap v3 router (0xE592427A0AEce92De3Edee1F18E0157C05861564) to spend 100 USDC."

**Switch network and check:**
> "Switch to Polygon and check my MATIC balance."

**Add a custom chain:**
> "Add Arbitrum One to MetaMask with RPC https://arb1.arbitrum.io/rpc"

**Sign a message:**
> "Sign the message 'I agree to the terms of service' with my wallet."

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on |

```bash
PORT=8080 npm run dev
```

---

## Building for Production

```bash
npm run build     # compiles TypeScript to dist/
npm start         # runs compiled output
```

For persistent deployment you can use [PM2](https://pm2.keymetrics.io/):

```bash
npm run build
pm2 start dist/index.js --name metamask-mcp
```

---

## Security Notes

- **Your private keys never leave MetaMask.** Claude only sends RPC method names and parameters to the bridge page, which calls `window.ethereum`. MetaMask handles all signing.
- Every transaction and signing request shows a **MetaMask confirmation popup** — you always have final say.
- The bridge page runs on `localhost` and is not exposed to the internet. Only the MCP `/mcp` endpoint is public via ngrok.
- ngrok URLs are ephemeral by default. Restart ngrok → update the connector URL on Claude.ai.
- If you stop the bridge tab, Claude's wallet tools will return a "bridge not connected" error until you reopen it.

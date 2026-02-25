import express, { Request, Response } from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3002;

// ─── Browser WebSocket Bridge ─────────────────────────────────────────────────
// bridge.html (opened in user's MetaMask browser) connects here.
// MCP tool calls relay commands through this socket to reach window.ethereum.

let bridgeSocket: WebSocket | null = null;
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function callMetaMask<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(
      new Error(
        "Browser bridge not connected. " +
          `Open http://localhost:${PORT} in your MetaMask browser first, then try again.`
      )
    );
  }

  const id = randomUUID();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          "MetaMask request timed out (30s). " +
            "The user may not have confirmed the MetaMask popup."
        )
      );
    }, 30_000);

    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v as T); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });

    bridgeSocket!.send(JSON.stringify({ id, method, params }));
  });
}

// ─── MCP Server factory ───────────────────────────────────────────────────────
// A new McpServer is created per client session (required by the SDK).

function createMcpServer(): McpServer {
  const mcp = new McpServer({
    name: "metamask-mcp",
    version: "1.0.0",
  });

  // ── bridge_status ──────────────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_bridge_status",
    {
      description:
        "Check if the browser bridge (MetaMask tab) is connected. " +
        "Always call this first to verify setup before using other tools.",
    },
    async () => {
      const connected = bridgeSocket?.readyState === WebSocket.OPEN;
      return ok({
        connected,
        message: connected
          ? "Bridge is connected. MetaMask tools are ready."
          : `Bridge not connected. Open http://localhost:${PORT} in the browser where MetaMask is installed and keep that tab open.`,
      });
    }
  );

  // ── metamask_connect ───────────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_connect",
    {
      description:
        "Request MetaMask account access. " +
        "This triggers the MetaMask connection popup in the user's browser.",
    },
    async () => {
      const accounts = await callMetaMask<string[]>("eth_requestAccounts");
      return ok({ accounts, primary_account: accounts[0] ?? null });
    }
  );

  // ── metamask_get_accounts ──────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_get_accounts",
    { description: "Get the currently connected MetaMask accounts (no popup)." },
    async () => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      return ok({ accounts, primary_account: accounts[0] ?? null });
    }
  );

  // ── metamask_get_chain ─────────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_get_chain",
    { description: "Get the current blockchain network MetaMask is connected to." },
    async () => {
      const hex = await callMetaMask<string>("eth_chainId");
      const id = parseInt(hex, 16);
      return ok({ chain_id: id, chain_id_hex: hex, network: networkName(id) });
    }
  );

  // ── metamask_get_balance ───────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_get_balance",
    {
      description: "Get the ETH (or native token) balance of an address.",
      inputSchema: {
        address: z
          .string()
          .optional()
          .describe("Address to check. Defaults to the connected account."),
      },
    },
    async ({ address }) => {
      let addr = address;
      if (!addr) {
        const accounts = await callMetaMask<string[]>("eth_accounts");
        if (!accounts.length)
          throw new Error("No accounts connected. Call metamask_connect first.");
        addr = accounts[0];
      }
      const hex = await callMetaMask<string>("eth_getBalance", [addr, "latest"]);
      const balanceEth = Number(BigInt(hex)) / 1e18;
      return ok({
        address: addr,
        balance_eth: balanceEth,
        balance_wei: BigInt(hex).toString(),
      });
    }
  );

  // ── metamask_send_transaction ──────────────────────────────────────────────
  mcp.registerTool(
    "metamask_send_transaction",
    {
      description:
        "Send ETH or interact with a contract. " +
        "MetaMask will show a confirmation popup before sending.",
      inputSchema: {
        to: z.string().describe("Recipient or contract address (0x…)"),
        value_eth: z
          .number()
          .optional()
          .describe("Amount of ETH to send, e.g. 0.01. Omit for pure contract calls."),
        data: z
          .string()
          .optional()
          .describe("Hex-encoded calldata for contract calls, e.g. 0xa9059cbb…"),
        gas: z
          .string()
          .optional()
          .describe("Gas limit in hex. MetaMask will estimate if omitted."),
      },
    },
    async ({ to, value_eth, data, gas }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      if (!accounts.length)
        throw new Error("No accounts connected. Call metamask_connect first.");

      const tx: Record<string, string> = { from: accounts[0], to };
      if (value_eth) tx.value = "0x" + BigInt(Math.round(value_eth * 1e18)).toString(16);
      if (data) tx.data = data;
      if (gas) tx.gas = gas;

      const hash = await callMetaMask<string>("eth_sendTransaction", [tx]);
      return ok({
        tx_hash: hash,
        from: accounts[0],
        to,
        status: "submitted — call metamask_get_receipt to check confirmation",
      });
    }
  );

  // ── metamask_get_receipt ───────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_get_receipt",
    {
      description: "Get the receipt of a submitted transaction. Returns null while pending.",
      inputSchema: {
        tx_hash: z.string().describe("Transaction hash (0x…)"),
      },
    },
    async ({ tx_hash }) => {
      const receipt = await callMetaMask("eth_getTransactionReceipt", [tx_hash]);
      return ok({ receipt });
    }
  );

  // ── metamask_sign_message ──────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_sign_message",
    {
      description:
        "Sign a plain-text message (EIP-191 personal_sign). " +
        "MetaMask will show a signing popup.",
      inputSchema: {
        message: z.string().describe("Human-readable message to sign."),
        address: z
          .string()
          .optional()
          .describe("Address to sign with. Defaults to the primary connected account."),
      },
    },
    async ({ message, address }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      if (!accounts.length)
        throw new Error("No accounts connected. Call metamask_connect first.");
      const signer = address ?? accounts[0];
      const msgHex = "0x" + Buffer.from(message, "utf8").toString("hex");
      const signature = await callMetaMask<string>("personal_sign", [msgHex, signer]);
      return ok({ signature, message, signer });
    }
  );

  // ── metamask_sign_typed_data ───────────────────────────────────────────────
  mcp.registerTool(
    "metamask_sign_typed_data",
    {
      description:
        "Sign EIP-712 structured typed data (used for permit signatures, gasless approvals, " +
        "Seaport orders, etc.). MetaMask will show a structured signing popup.",
      inputSchema: {
        typed_data: z
          .string()
          .describe(
            "JSON string of the EIP-712 object with fields: domain, types, primaryType, message."
          ),
        address: z
          .string()
          .optional()
          .describe("Signing address. Defaults to primary account."),
      },
    },
    async ({ typed_data, address }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      if (!accounts.length)
        throw new Error("No accounts connected. Call metamask_connect first.");
      JSON.parse(typed_data); // validate JSON early and throw a helpful error
      const signer = address ?? accounts[0];
      const sig = await callMetaMask<string>("eth_signTypedData_v4", [signer, typed_data]);
      return ok({ signature: sig, signer });
    }
  );

  // ── metamask_switch_chain ──────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_switch_chain",
    {
      description:
        "Switch MetaMask to a different network. " +
        "Call metamask_add_chain first if the network is not already in MetaMask.",
      inputSchema: {
        chain_id: z
          .number()
          .describe(
            "Chain ID to switch to. " +
              "Common values: 1=Ethereum, 137=Polygon, 42161=Arbitrum, 8453=Base, 10=Optimism, 56=BNB Chain"
          ),
      },
    },
    async ({ chain_id }) => {
      const hex = "0x" + chain_id.toString(16);
      try {
        await callMetaMask("wallet_switchEthereumChain", [{ chainId: hex }]);
      } catch (e: unknown) {
        const msg = (e as Error).message ?? "";
        if (msg.includes("4902"))
          throw new Error(
            `Chain ${chain_id} is not in MetaMask yet. Use metamask_add_chain to add it first.`
          );
        throw e;
      }
      return ok({ switched_to: chain_id, network: networkName(chain_id) });
    }
  );

  // ── metamask_add_chain ─────────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_add_chain",
    {
      description: "Add a custom network to MetaMask. MetaMask will prompt the user to approve.",
      inputSchema: {
        chain_id: z.number().describe("Chain ID, e.g. 137 for Polygon"),
        name: z.string().describe("Network name, e.g. 'Polygon Mainnet'"),
        rpc_url: z.string().describe("RPC endpoint URL"),
        symbol: z.string().describe("Native token symbol, e.g. MATIC or ETH"),
        explorer_url: z
          .string()
          .optional()
          .describe("Block explorer URL, e.g. https://polygonscan.com"),
      },
    },
    async ({ chain_id, name, rpc_url, symbol, explorer_url }) => {
      const params: Record<string, unknown> = {
        chainId: "0x" + chain_id.toString(16),
        chainName: name,
        rpcUrls: [rpc_url],
        nativeCurrency: { name: symbol, symbol, decimals: 18 },
      };
      if (explorer_url) params.blockExplorerUrls = [explorer_url];
      await callMetaMask("wallet_addEthereumChain", [params]);
      return ok({ added: true, chain_id, name });
    }
  );

  // ── metamask_call ──────────────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_call",
    {
      description:
        "Execute a read-only contract call (eth_call). " +
        "No transaction is sent, no gas is used, no popup. " +
        "Use for view/pure functions.",
      inputSchema: {
        to: z.string().describe("Contract address"),
        data: z
          .string()
          .describe("ABI-encoded calldata hex (4-byte selector + encoded params)"),
      },
    },
    async ({ to, data }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      const from = accounts[0] ?? "0x0000000000000000000000000000000000000000";
      const result = await callMetaMask<string>("eth_call", [{ from, to, data }, "latest"]);
      return ok({
        result_hex: result,
        note: "Raw ABI-encoded output. Decode based on the function's return type.",
      });
    }
  );

  // ── metamask_estimate_gas ──────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_estimate_gas",
    {
      description: "Estimate the gas cost of a transaction.",
      inputSchema: {
        to: z.string().describe("Recipient or contract address"),
        data: z.string().optional().describe("Calldata hex"),
        value_eth: z.number().optional().describe("ETH value to send"),
      },
    },
    async ({ to, data, value_eth }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      const tx: Record<string, string> = { to };
      if (accounts[0]) tx.from = accounts[0];
      if (data) tx.data = data;
      if (value_eth) tx.value = "0x" + BigInt(Math.round(value_eth * 1e18)).toString(16);
      const gasHex = await callMetaMask<string>("eth_estimateGas", [tx]);
      return ok({ gas_estimate: parseInt(gasHex, 16), gas_hex: gasHex });
    }
  );

  // ── metamask_gas_price ─────────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_gas_price",
    { description: "Get the current network gas price." },
    async () => {
      const hex = await callMetaMask<string>("eth_gasPrice");
      const wei = parseInt(hex, 16);
      return ok({ gas_price_gwei: wei / 1e9, gas_price_wei: wei });
    }
  );

  // ── metamask_watch_token ───────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_watch_token",
    {
      description:
        "Add an ERC-20 token to MetaMask's token list so it shows in the wallet UI. " +
        "MetaMask will ask the user to confirm. " +
        "You need the contract address, symbol, and decimals.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 contract address (0x…)"),
        symbol: z.string().describe("Token symbol, e.g. USDC, LINK, WETH"),
        decimals: z.number().int().describe("Token decimals, e.g. 18 for WETH, 6 for USDC"),
        image: z
          .string()
          .optional()
          .describe("URL of the token logo image (optional)"),
      },
    },
    async ({ token_address, symbol, decimals, image }) => {
      const options: Record<string, unknown> = {
        address: token_address,
        symbol,
        decimals,
      };
      if (image) options.image = image;

      const added = await callMetaMask<boolean>("wallet_watchAsset", [
        { type: "ERC20", options },
      ]);
      return ok({ added, token_address, symbol, decimals });
    }
  );

  // ── metamask_get_token_info ────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_get_token_info",
    {
      description:
        "Read the name, symbol, and decimals of any ERC-20 token contract. " +
        "No transaction, no popup.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 contract address (0x…)"),
      },
    },
    async ({ token_address }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      const from = accounts[0] ?? "0x0000000000000000000000000000000000000000";

      const [nameHex, symbolHex, decimalsHex] = await Promise.all([
        callMetaMask<string>("eth_call", [
          { from, to: token_address, data: ERC20.name },
          "latest",
        ]),
        callMetaMask<string>("eth_call", [
          { from, to: token_address, data: ERC20.symbol },
          "latest",
        ]),
        callMetaMask<string>("eth_call", [
          { from, to: token_address, data: ERC20.decimals },
          "latest",
        ]),
      ]);

      return ok({
        token_address,
        name: decodeString(nameHex),
        symbol: decodeString(symbolHex),
        decimals: decodeUint(decimalsHex),
      });
    }
  );

  // ── metamask_get_token_balance ─────────────────────────────────────────────
  mcp.registerTool(
    "metamask_get_token_balance",
    {
      description:
        "Get the ERC-20 token balance of any address. " +
        "Returns both the raw amount and the human-readable amount (adjusted for decimals). " +
        "No transaction, no popup.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 contract address (0x…)"),
        wallet_address: z
          .string()
          .optional()
          .describe("Wallet to check. Defaults to the connected MetaMask account."),
      },
    },
    async ({ token_address, wallet_address }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      const holder = wallet_address ?? accounts[0];
      if (!holder) throw new Error("No accounts connected. Call metamask_connect first.");

      // balanceOf(address) + decimals() in parallel
      const [balanceHex, decimalsHex] = await Promise.all([
        callMetaMask<string>("eth_call", [
          {
            from: holder,
            to: token_address,
            data: ERC20.balanceOf(holder),
          },
          "latest",
        ]),
        callMetaMask<string>("eth_call", [
          { from: holder, to: token_address, data: ERC20.decimals },
          "latest",
        ]),
      ]);

      const decimals = decodeUint(decimalsHex);
      const rawBig = BigInt(balanceHex);
      const humanAmount = Number(rawBig) / 10 ** decimals;

      return ok({
        token_address,
        wallet_address: holder,
        balance_raw: rawBig.toString(),
        balance: humanAmount,
        decimals,
      });
    }
  );

  // ── metamask_transfer_token ────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_transfer_token",
    {
      description:
        "Transfer ERC-20 tokens to another address. " +
        "MetaMask will show a confirmation popup before sending.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 contract address (0x…)"),
        to: z.string().describe("Recipient wallet address (0x…)"),
        amount: z
          .number()
          .describe(
            "Human-readable amount to send, e.g. 10.5 for 10.5 USDC. " +
              "The tool will fetch decimals and convert automatically."
          ),
      },
    },
    async ({ token_address, to, amount }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      if (!accounts.length)
        throw new Error("No accounts connected. Call metamask_connect first.");

      // Fetch decimals first so we can encode the exact amount
      const decimalsHex = await callMetaMask<string>("eth_call", [
        { from: accounts[0], to: token_address, data: ERC20.decimals },
        "latest",
      ]);
      const decimals = decodeUint(decimalsHex);
      const amountRaw = BigInt(Math.round(amount * 10 ** decimals));

      const data = ERC20.transfer(to, amountRaw);
      const hash = await callMetaMask<string>("eth_sendTransaction", [
        { from: accounts[0], to: token_address, data },
      ]);

      return ok({
        tx_hash: hash,
        from: accounts[0],
        to,
        token_address,
        amount_sent: amount,
        amount_raw: amountRaw.toString(),
        status: "submitted — call metamask_get_receipt to check confirmation",
      });
    }
  );

  // ── metamask_approve_token ─────────────────────────────────────────────────
  mcp.registerTool(
    "metamask_approve_token",
    {
      description:
        "Approve a spender (e.g. a DEX or DeFi protocol) to spend ERC-20 tokens on your behalf. " +
        "MetaMask will show a confirmation popup.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 contract address (0x…)"),
        spender: z.string().describe("Address to approve as spender (0x…)"),
        amount: z
          .number()
          .optional()
          .describe(
            "Amount to approve in human-readable units. " +
              "Omit or pass a very large number for unlimited approval."
          ),
        unlimited: z
          .boolean()
          .optional()
          .describe("Set to true to approve the maximum uint256 amount (unlimited)."),
      },
    },
    async ({ token_address, spender, amount, unlimited }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      if (!accounts.length)
        throw new Error("No accounts connected. Call metamask_connect first.");

      let amountRaw: bigint;
      if (unlimited || amount === undefined) {
        amountRaw = 2n ** 256n - 1n; // max uint256
      } else {
        const decimalsHex = await callMetaMask<string>("eth_call", [
          { from: accounts[0], to: token_address, data: ERC20.decimals },
          "latest",
        ]);
        const decimals = decodeUint(decimalsHex);
        amountRaw = BigInt(Math.round(amount * 10 ** decimals));
      }

      const data = ERC20.approve(spender, amountRaw);
      const hash = await callMetaMask<string>("eth_sendTransaction", [
        { from: accounts[0], to: token_address, data },
      ]);

      return ok({
        tx_hash: hash,
        token_address,
        spender,
        approved_amount: unlimited ? "unlimited (max uint256)" : amount,
        status: "submitted — call metamask_get_receipt to check confirmation",
      });
    }
  );

  // ── metamask_get_token_allowance ───────────────────────────────────────────
  mcp.registerTool(
    "metamask_get_token_allowance",
    {
      description:
        "Check how many tokens a spender is approved to use from an owner's account (ERC-20 allowance). " +
        "No transaction, no popup.",
      inputSchema: {
        token_address: z.string().describe("ERC-20 contract address (0x…)"),
        spender: z.string().describe("Spender address to check (0x…)"),
        owner: z
          .string()
          .optional()
          .describe("Token owner address. Defaults to connected account."),
      },
    },
    async ({ token_address, spender, owner }) => {
      const accounts = await callMetaMask<string[]>("eth_accounts");
      const tokenOwner = owner ?? accounts[0];
      if (!tokenOwner) throw new Error("No accounts connected. Call metamask_connect first.");

      const [allowanceHex, decimalsHex] = await Promise.all([
        callMetaMask<string>("eth_call", [
          {
            from: tokenOwner,
            to: token_address,
            data: ERC20.allowance(tokenOwner, spender),
          },
          "latest",
        ]),
        callMetaMask<string>("eth_call", [
          { from: tokenOwner, to: token_address, data: ERC20.decimals },
          "latest",
        ]),
      ]);

      const decimals = decodeUint(decimalsHex);
      const rawBig = BigInt(allowanceHex);
      const maxUint256 = 2n ** 256n - 1n;
      const isUnlimited = rawBig === maxUint256;

      return ok({
        token_address,
        owner: tokenOwner,
        spender,
        allowance_raw: rawBig.toString(),
        allowance: isUnlimited ? "unlimited" : Number(rawBig) / 10 ** decimals,
        decimals,
        is_unlimited: isUnlimited,
      });
    }
  );

  return mcp;
}

// ─── ERC-20 ABI encoding helpers ──────────────────────────────────────────────
// Minimal ABI encoding without external dependencies.

function padLeft(hex: string, bytes = 32): string {
  return hex.replace(/^0x/, "").padStart(bytes * 2, "0");
}

function encodeAddress(addr: string): string {
  return padLeft(addr.toLowerCase().replace(/^0x/, ""));
}

function encodeUint256(value: bigint): string {
  return padLeft(value.toString(16));
}

const ERC20 = {
  // Selectors
  name:     "0x06fdde03",
  symbol:   "0x95d89b41",
  decimals: "0x313ce567",

  balanceOf: (addr: string) =>
    "0x70a08231" + encodeAddress(addr),

  transfer: (to: string, amount: bigint) =>
    "0xa9059cbb" + encodeAddress(to) + encodeUint256(amount),

  approve: (spender: string, amount: bigint) =>
    "0x095ea7b3" + encodeAddress(spender) + encodeUint256(amount),

  allowance: (owner: string, spender: string) =>
    "0xdd62ed3e" + encodeAddress(owner) + encodeAddress(spender),
};

/** Decode ABI-encoded uint256 / uint8 from a hex result */
function decodeUint(hex: string): number {
  const clean = hex.replace(/^0x/, "");
  if (!clean || clean === "0".repeat(clean.length)) return 0;
  return Number(BigInt("0x" + clean));
}

/** Decode ABI-encoded string from an eth_call result */
function decodeString(hex: string): string {
  try {
    const data = hex.replace(/^0x/, "");
    if (data.length < 128) return "";
    // bytes 32-63: string length
    const len = parseInt(data.slice(64, 128), 16);
    // bytes 64+: string content
    const strHex = data.slice(128, 128 + len * 2);
    return Buffer.from(strHex, "hex").toString("utf8");
  } catch {
    return "";
  }
}

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();

// CORS — allow Claude.ai and ngrok origins to connect
app.use(
  cors({
    origin: "*",
    allowedHeaders: ["Content-Type", "mcp-session-id"],
    exposedHeaders: ["mcp-session-id"],
  })
);
app.use(express.json());

// Bridge page — user opens this in their MetaMask browser
app.get("/", (_req: Request, res: Response) => {
  const html = readFileSync(join(__dirname, "../public/bridge.html"), "utf-8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ─── MCP endpoint ─────────────────────────────────────────────────────────────
// Claude.ai connects here with GET (SSE stream) and POST (tool calls).
// Supports multiple concurrent sessions.

const sessions = new Map<string, StreamableHTTPServerTransport>();

app.all("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    // Existing session — route to the right transport
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Session not found. Please reconnect." });
      return;
    }
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // No session ID — this must be the initial POST to create a new session
  if (req.method !== "POST") {
    res.status(400).json({ error: "Expected POST for session initialization." });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
      log(`New MCP session: ${id}`);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
      log(`Session closed: ${transport.sessionId}`);
    }
  };

  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ─── HTTP + WebSocket servers ─────────────────────────────────────────────────

const httpServer = createServer(app);

// WebSocket path for the browser bridge
const wss = new WebSocketServer({ server: httpServer, path: "/bridge-ws" });

wss.on("connection", (ws) => {
  log("Browser bridge connected");
  bridgeSocket = ws;

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        id: string;
        result?: unknown;
        error?: string;
      };
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    } catch (e) {
      log("Bridge parse error: " + e);
    }
  });

  ws.on("close", () => {
    log("Browser bridge disconnected");
    bridgeSocket = null;
    // Reject any in-flight requests
    for (const [id, p] of pending) {
      p.reject(new Error("Bridge disconnected while waiting for MetaMask response."));
      pending.delete(id);
    }
  });

  ws.on("error", (err) => log("WebSocket error: " + err.message));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  log("");
  log("=".repeat(55));
  log(" MetaMask MCP Server");
  log("=".repeat(55));
  log(` Local:       http://localhost:${PORT}`);
  log(` MCP endpoint: http://localhost:${PORT}/mcp`);
  log("");
  log(" Setup steps:");
  log(` 1. Run:  ngrok http ${PORT}`);
  log(`    Copy the HTTPS URL, e.g. https://abc123.ngrok-free.app`);
  log(` 2. Go to https://claude.ai/customize/connectors`);
  log(`    Add connector URL: https://abc123.ngrok-free.app/mcp`);
  log(` 3. Open  http://localhost:${PORT}  in your MetaMask browser tab`);
  log(`    Keep that tab open.`);
  log(" 4. Start chatting on Claude.ai — MetaMask tools are ready!");
  log("=".repeat(55));
  log("");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function log(msg: string) {
  process.stderr.write(`${msg}\n`);
}

function networkName(id: number): string {
  const names: Record<number, string> = {
    1: "Ethereum Mainnet",
    5: "Goerli Testnet",
    11155111: "Sepolia Testnet",
    137: "Polygon Mainnet",
    80001: "Polygon Mumbai Testnet",
    42161: "Arbitrum One",
    421614: "Arbitrum Sepolia",
    10: "Optimism",
    11155420: "Optimism Sepolia",
    8453: "Base",
    84532: "Base Sepolia",
    56: "BNB Smart Chain",
    43114: "Avalanche C-Chain",
    1337: "Localhost",
    31337: "Hardhat",
  };
  return names[id] ?? `Unknown Network (chainId: ${id})`;
}

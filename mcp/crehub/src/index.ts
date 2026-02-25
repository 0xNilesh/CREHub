import express, { Request, Response } from "express";
import cors from "cors";
import { createServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { z } from "zod";

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND_URL = "http://localhost:4000";
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const PORT = 3002;

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowIOField {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface Workflow {
  workflowId: string;
  name: string;
  description: string;
  category: string;
  pricePerInvocation: string;
  creatorAddress: string;
  inputs: WorkflowIOField[];
  outputs: WorkflowIOField[];
  active: boolean;
}

interface SearchResult extends Workflow {
  score: number;
}

interface PaymentDetails {
  network: string;
  chainId: number;
  payTo: string;
  amount: string;
  token: string;
}

// ─── Backend fetch helper ─────────────────────────────────────────────────────

async function backendGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function formatPrice(weiStr: string): string {
  return `$${(Number(weiStr) / 1_000_000).toFixed(4)}`;
}

// ─── Param extraction from natural language ───────────────────────────────────
// Matches intent text against a workflow's input schema to extract typed values.
// Addresses (0x + 40 hex) and numbers are extracted positionally by type.
// Token symbols (ETH, USDC, WBTC, etc.) are extracted for symbol-typed inputs.

function extractParams(
  intent: string,
  inputs: WorkflowIOField[]
): { extracted: Record<string, string>; missing: string[] } {
  const extracted: Record<string, string> = {};
  const missing: string[] = [];

  const addresses = intent.match(/0x[a-fA-F0-9]{40,}/g) ?? [];
  const numbers   = intent.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  const symbols   = intent.match(/\b[A-Z]{2,6}\b/g) ?? [];

  let addrIdx = 0;
  let numIdx  = 0;
  let symIdx  = 0;

  for (const input of inputs) {
    const n = input.name.toLowerCase();

    const isAddress =
      input.type === "address" ||
      n.includes("address") ||
      n.includes("wallet") ||
      n.includes("account");

    const isNumber =
      input.type === "number" ||
      n.includes("amount") ||
      n.includes("value") ||
      n.includes("limit") ||
      n.includes("threshold") ||
      n.includes("count");

    const isSymbol =
      n.includes("symbol") ||
      n.includes("token") ||
      n.includes("asset") ||
      n.includes("pair");

    if (isAddress) {
      if (addrIdx < addresses.length) {
        extracted[input.name] = addresses[addrIdx++];
      } else if (input.required) {
        missing.push(input.name);
      }
    } else if (isSymbol) {
      if (symIdx < symbols.length) {
        extracted[input.name] = symbols[symIdx++];
      } else if (input.required) {
        missing.push(input.name);
      }
    } else if (isNumber) {
      if (numIdx < numbers.length) {
        extracted[input.name] = numbers[numIdx++];
      } else if (input.required) {
        missing.push(input.name);
      }
    } else if (input.required) {
      // String or unknown type — Claude will need to fill this in
      missing.push(input.name);
    }
  }

  return { extracted, missing };
}

// ─── MCP Server factory ───────────────────────────────────────────────────────
// A new McpServer is created per client session (required by the SDK).

function createMcpServer(): McpServer {
  const mcp = new McpServer({
    name: "crehub-marketplace",
    version: "1.0.0",
  });

  // ── list_workflows ──────────────────────────────────────────────────────────
  mcp.registerTool(
    "list_workflows",
    {
      description:
        "List all active workflows on the CREHub marketplace. " +
        "Returns workflow ID, name, description, category, and price in USDC. " +
        "Use this to browse available on-chain Chainlink CRE workflows.",
    },
    async () => {
      const workflows = await backendGet<Workflow[]>("/api/workflows");
      return ok(
        workflows.map((w) => ({
          workflowId: w.workflowId,
          name: w.name,
          description: w.description,
          category: w.category,
          pricePerInvocation: w.pricePerInvocation,
          price: formatPrice(w.pricePerInvocation),
        }))
      );
    }
  );

  // ── search_workflows ────────────────────────────────────────────────────────
  mcp.registerTool(
    "search_workflows",
    {
      description:
        "Semantically search CREHub workflows by intent or description. " +
        "Returns scored results (0–1) — higher score means better match. " +
        "Use this to find workflows matching a user's goal before triggering.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Natural language search query, e.g. 'monitor Aave health factor' or 'get ETH/USD price'"
          ),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default 5, max 20)"),
      },
    },
    async ({ query, limit = 5 }) => {
      const results = await backendGet<SearchResult[]>(
        `/api/workflows/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 20)}`
      );
      return ok(
        results.map((w) => ({
          workflowId: w.workflowId,
          name: w.name,
          description: w.description,
          category: w.category,
          score: w.score,
          price: formatPrice(w.pricePerInvocation),
        }))
      );
    }
  );

  // ── get_workflow_detail ─────────────────────────────────────────────────────
  mcp.registerTool(
    "get_workflow_detail",
    {
      description:
        "Get full details of a CREHub workflow including its input schema, output schema, " +
        "price, and creator address. Call this before triggering to know exactly what " +
        "parameters to pass and what output fields to expect.",
      inputSchema: {
        workflowId: z
          .string()
          .describe("Workflow ID, e.g. 'wf_hf_monitor_01'"),
      },
    },
    async ({ workflowId }) => {
      const w = await backendGet<Workflow>(`/api/workflows/${workflowId}`);
      return ok({
        workflowId: w.workflowId,
        name: w.name,
        description: w.description,
        category: w.category,
        creatorAddress: w.creatorAddress,
        price: formatPrice(w.pricePerInvocation),
        priceRaw: w.pricePerInvocation,
        inputs: w.inputs,
        outputs: w.outputs,
      });
    }
  );

  // ── discover_workflow ───────────────────────────────────────────────────────
  mcp.registerTool(
    "discover_workflow",
    {
      description:
        "Natural language workflow discovery — the smart entry point. " +
        "Takes a user intent, finds the best matching workflow via semantic search, " +
        "auto-extracts parameters from the intent, and returns everything needed to trigger it. " +
        "Always call this first when the user describes what they want to do. " +
        "If missingRequired is empty the workflow is ready to trigger immediately.",
      inputSchema: {
        intent: z
          .string()
          .describe(
            "What the user wants to do, e.g. 'check Aave health factor for wallet 0x1234...' " +
            "or 'get current ETH/USD price' or 'monitor low balance for 0xabc...'"
          ),
      },
    },
    async ({ intent }) => {
      // Step 1: Semantic search — find top 3 candidates
      const results = await backendGet<SearchResult[]>(
        `/api/workflows/search?q=${encodeURIComponent(intent)}&limit=3`
      );

      if (!results.length) {
        return ok({
          found: false,
          message: "No matching workflows found on the CREHub marketplace.",
        });
      }

      // Step 2: Pick best match (openclaw rule: any score > 0 is acceptable)
      const best = results[0];

      // Step 3: Fetch full schema for input extraction
      const detail = await backendGet<Workflow>(`/api/workflows/${best.workflowId}`);

      // Step 4: Extract typed params from intent
      const { extracted, missing } = extractParams(intent, detail.inputs);

      const ready = missing.length === 0;

      return ok({
        found: true,
        workflowId: detail.workflowId,
        name: detail.name,
        description: detail.description,
        score: best.score,
        price: formatPrice(detail.pricePerInvocation),
        priceRaw: detail.pricePerInvocation,
        usdcAddress: USDC_ADDRESS,
        inputs: detail.inputs,
        outputs: detail.outputs,
        extractedParams: extracted,
        missingRequired: missing,
        ready,
        nextStep: ready
          ? `Call trigger_workflow with workflowId="${detail.workflowId}" and params=${JSON.stringify(extracted)}.`
          : `Ask the user for: ${missing.join(", ")}. Then call trigger_workflow.`,
      });
    }
  );

  // ── trigger_workflow ────────────────────────────────────────────────────────
  mcp.registerTool(
    "trigger_workflow",
    {
      description:
        "Execute a CREHub workflow with automatic x402 USDC payment handling.\n\n" +
        "Two-phase flow:\n" +
        "  Phase 1 — call WITHOUT paymentTxHash:\n" +
        "    Returns { needsPayment: true, payTo, amount, amountHuman, usdcAddress }.\n" +
        "    → Use MetaMask MCP: call metamask_transfer_token(usdcAddress, payTo, amountHuman)\n" +
        "    → That returns a txHash after the user approves in MetaMask.\n\n" +
        "  Phase 2 — call WITH paymentTxHash from MetaMask:\n" +
        "    Returns { success, output, settlementTx } — the actual workflow result.\n\n" +
        `USDC token address (Sepolia): ${USDC_ADDRESS}`,
      inputSchema: {
        workflowId: z.string().describe("Workflow ID to execute"),
        params: z
          .record(z.string())
          .describe(
            "Input parameters as key-value pairs matching the workflow's input schema. " +
            "Use extractedParams from discover_workflow or get_workflow_detail inputs as a guide."
          ),
        paymentTxHash: z
          .string()
          .optional()
          .describe(
            "USDC transfer tx hash returned by metamask_transfer_token (Phase 2 only). " +
            "Omit on the first call to get payment details."
          ),
      },
    },
    async ({ workflowId, params, paymentTxHash }) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (paymentTxHash) {
        headers["X-Payment"] = paymentTxHash;
      }

      const res = await fetch(`${BACKEND_URL}/api/trigger/${workflowId}`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });

      // Phase 1: payment required
      if (res.status === 402) {
        const body = (await res.json()) as {
          paymentDetails?: PaymentDetails;
          error?: string;
        };
        const details = body.paymentDetails;

        if (!details) {
          return ok({ success: false, error: body.error ?? "Payment required but no details returned" });
        }

        return ok({
          needsPayment: true,
          workflowId,
          payTo: details.payTo,
          usdcAddress: USDC_ADDRESS,
          amount: details.amount,
          amountHuman: (Number(details.amount) / 1_000_000).toFixed(6),
          network: details.network,
          chainId: details.chainId,
          nextStep:
            `Call metamask_transfer_token with ` +
            `token_address="${USDC_ADDRESS}", ` +
            `to="${details.payTo}", ` +
            `amount=${(Number(details.amount) / 1_000_000).toFixed(6)}. ` +
            `Then call trigger_workflow again with the returned txHash as paymentTxHash.`,
        });
      }

      if (!res.ok) {
        const text = await res.text();
        return ok({ success: false, error: `Gateway error ${res.status}: ${text}` });
      }

      // Phase 2: execution result
      const result = (await res.json()) as {
        success: boolean;
        output?: Record<string, unknown>;
        error?: string;
        settlementTx?: string;
      };

      return ok({
        success: result.success,
        output: result.output ?? null,
        error: result.error ?? null,
        settlementTx: result.settlementTx ?? null,
        settlementExplorer: result.settlementTx
          ? `https://sepolia.etherscan.io/tx/${result.settlementTx}`
          : null,
      });
    }
  );

  // ── get_executions ──────────────────────────────────────────────────────────
  mcp.registerTool(
    "get_executions",
    {
      description:
        "Get CREHub workflow execution history. Optionally filter by workflow ID. " +
        "Returns paginated results with status, pricePaid, output, and settlement info.",
      inputSchema: {
        workflowId: z
          .string()
          .optional()
          .describe("Filter by specific workflow ID (optional)"),
        limit: z
          .number()
          .optional()
          .describe("Results per page (default 10, max 50)"),
        page: z.number().optional().describe("Page number (default 1)"),
      },
    },
    async ({ workflowId, limit = 10, page = 1 }) => {
      let path = `/api/executions?page=${page}&limit=${Math.min(limit, 50)}`;
      if (workflowId) path += `&workflowId=${encodeURIComponent(workflowId)}`;
      const result = await backendGet<unknown>(path);
      return ok(result);
    }
  );

  // ── get_execution ───────────────────────────────────────────────────────────
  mcp.registerTool(
    "get_execution",
    {
      description:
        "Get details of a single CREHub workflow execution by ID. " +
        "Returns full output, price paid, settlement transaction, and status.",
      inputSchema: {
        executionId: z.string().describe("Execution ID to look up"),
      },
    },
    async ({ executionId }) => {
      const result = await backendGet<unknown>(`/api/executions/${executionId}`);
      return ok(result);
    }
  );

  return mcp;
}

// ─── Express app + MCP session management ────────────────────────────────────
// Matches the MetaMask MCP pattern: one McpServer per session.

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map<string, StreamableHTTPServerTransport>();

app.all("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Session not found. Please reconnect." });
      return;
    }
    await transport.handleRequest(req, res, req.body);
    return;
  }

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

// ─── Start ────────────────────────────────────────────────────────────────────

const httpServer = createServer(app);

httpServer.listen(PORT, "0.0.0.0", () => {
  log("");
  log("=".repeat(55));
  log(" CREHub Marketplace MCP Server");
  log("=".repeat(55));
  log(` Local:    http://localhost:${PORT}`);
  log(` MCP:      http://localhost:${PORT}/mcp`);
  log(` Backend:  ${BACKEND_URL}`);
  log("=".repeat(55));
  log("");
  log(" 7 tools available:");
  log("  • list_workflows       — browse all workflows");
  log("  • search_workflows     — semantic search");
  log("  • get_workflow_detail  — full input/output schema");
  log("  • discover_workflow    — NL intent → best match + params");
  log("  • trigger_workflow     — execute with x402 payment flow");
  log("  • get_executions       — execution history");
  log("  • get_execution        — single execution result");
  log("");
  log(" Connect to Claude.ai via ngrok:");
  log("  ngrok http 3001");
  log("  → Add https://<id>.ngrok.io/mcp as a connector");
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

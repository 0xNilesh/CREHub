/**
 * POST /api/agent/run
 *
 * Server-Sent Events endpoint that runs one CREHub workflow execution:
 *   search → select → USDC payment → result
 *
 * Body: { workflowId: string, params: Record<string, string> }
 * Stream: SSE events (see AgentEvent type below)
 *
 * Requires in .env.local (server-side, never exposed to browser):
 *   AGENT_PRIVATE_KEY=0x...
 *   AGENT_WALLET_ADDRESS=0x...
 */
import {
	createPublicClient,
	createWalletClient,
	http,
	parseAbi,
	formatUnits,
	type Hex,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentEvent =
	| { type: 'step';          message: string }
	| { type: 'sub';           message: string }
	| { type: 'payment';       amount: string; amountWei: string; payTo: string }
	| { type: 'balance';       usd: string; sufficient: boolean }
	| { type: 'tx_broadcast';  txHash: string }
	| { type: 'tx_confirmed';  txHash: string }
	| { type: 'retrying' }
	| { type: 'result';        success: boolean; output: Record<string, unknown> | null; settlementTx?: string; pricePaid: string; error?: string }
	| { type: 'error';         message: string }
	| { type: 'done' }

// ─── USDC ABI ─────────────────────────────────────────────────────────────────

const USDC_ABI = parseAbi([
	'function balanceOf(address owner) view returns (uint256)',
	'function transfer(address to, uint256 amount) returns (bool)',
])

const USDC_ADDRESS = (process.env.USDC_ADDRESS ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Hex

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
	const { workflowId, params } = (await request.json()) as {
		workflowId: string
		params: Record<string, string>
	}

	const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
	const RPC     = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
	const PK      = (process.env.AGENT_PRIVATE_KEY ?? '') as Hex
	const ADDR    = (process.env.AGENT_WALLET_ADDRESS ?? '') as Hex

	const encoder = new TextEncoder()

	const stream = new ReadableStream({
		async start(ctrl) {
			const emit = (ev: AgentEvent) => {
				ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
			}

			try {
				// ── Validate agent wallet ─────────────────────────────────────────
				if (!PK || !PK.startsWith('0x')) {
					emit({ type: 'error', message: 'AGENT_PRIVATE_KEY not set — add it to frontend/.env.local' })
					emit({ type: 'done' })
					ctrl.close()
					return
				}

				const account     = privateKeyToAccount(PK)
				const agentAddr   = ADDR || account.address as Hex
				const transport   = http(RPC)
				const publicClient  = createPublicClient({ chain: sepolia, transport })
				const walletClient  = createWalletClient({ account, chain: sepolia, transport })

				const triggerUrl = `${BACKEND}/api/trigger/${workflowId}`
				const body       = JSON.stringify(params)
				const hdrs       = { 'Content-Type': 'application/json' }

				emit({ type: 'step', message: `Triggering ${workflowId}` })
				emit({ type: 'sub',  message: `params: ${JSON.stringify(params)}` })

				// ── Step 1: probe (expect 402) ────────────────────────────────────
				const r1 = await fetch(triggerUrl, { method: 'POST', headers: hdrs, body })

				if (r1.status === 200) {
					const data = await r1.json() as Record<string, unknown>
					const output = data.output as Record<string, unknown> ?? null
					emit({ type: 'result', success: true, output, settlementTx: data.settlementTx as string, pricePaid: '$0.00' })
					emit({ type: 'done' })
					ctrl.close()
					return
				}

				if (r1.status !== 402) {
					emit({ type: 'error', message: `Unexpected status ${r1.status}: ${await r1.text()}` })
					emit({ type: 'done' })
					ctrl.close()
					return
				}

				// ── Step 2: parse payment details ─────────────────────────────────
				const { paymentDetails } = await r1.json() as {
					paymentDetails: { payTo: string; amount: string; token: string }
				}
				const amtWei   = BigInt(paymentDetails.amount)
				const priceUsd = `$${Number(formatUnits(amtWei, 6)).toFixed(4)}`

				emit({ type: 'payment', amount: priceUsd, amountWei: paymentDetails.amount, payTo: paymentDetails.payTo })

				// ── Step 3: check USDC balance ────────────────────────────────────
				const rawBal = (await publicClient.readContract({
					address: USDC_ADDRESS,
					abi: USDC_ABI,
					functionName: 'balanceOf',
					args: [agentAddr],
				})) as bigint
				const usdBal   = `$${Number(formatUnits(rawBal, 6)).toFixed(4)}`
				const sufficient = rawBal >= amtWei
				emit({ type: 'balance', usd: usdBal, sufficient })

				if (!sufficient) {
					emit({ type: 'error', message: `Insufficient USDC: ${usdBal} available, need ${priceUsd}. Get Sepolia USDC at https://faucet.circle.com` })
					emit({ type: 'done' })
					ctrl.close()
					return
				}

				// ── Step 4: broadcast USDC transfer ───────────────────────────────
				const txHash = await walletClient.writeContract({
					address: USDC_ADDRESS,
					abi: USDC_ABI,
					functionName: 'transfer',
					args: [paymentDetails.payTo as Hex, amtWei],
					account,
					chain: sepolia,
				})
				emit({ type: 'tx_broadcast', txHash })

				await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })
				emit({ type: 'tx_confirmed', txHash })

				// ── Step 5: retry with payment proof ──────────────────────────────
				emit({ type: 'retrying' })
				const r2 = await fetch(triggerUrl, {
					method: 'POST',
					headers: { ...hdrs, 'X-Payment': txHash },
					body,
				})
				const result = await r2.json() as Record<string, unknown>
				const output = result.output as Record<string, unknown> ?? null
				emit({
					type:         'result',
					success:      result.success as boolean ?? false,
					output,
					settlementTx: result.settlementTx as string | undefined,
					pricePaid:    priceUsd,
					error:        result.error as string | undefined,
				})

			} catch (e) {
				emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
			}

			emit({ type: 'done' })
			ctrl.close()
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type':  'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'Connection':    'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	})
}

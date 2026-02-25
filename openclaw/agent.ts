#!/usr/bin/env bun
/**
 * CREHub Openclaw Agent — GPT-4o powered autonomous agent
 *
 * Discovers and triggers Chainlink CRE workflows from the CREHub marketplace,
 * paying per execution with USDC micropayments on Ethereum Sepolia.
 *
 * Usage:
 *   bun run openclaw/agent.ts "check Aave health factor for 0x1234..."
 *   bun run openclaw/agent.ts          ← interactive TUI (arrow-key menu)
 *
 * Env:  openclaw/.env  (copy from openclaw/.env.example)
 */
import OpenAI from 'openai'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import type { Hex } from 'viem'

import {
	createAgentClients,
	checkUsdcBalance,
	checkEthBalance,
	sendUsdcTransfer,
	formatUsdcWei,
} from './agent-skills'

// ─── Load .env ────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))

const loadDotEnv = () => {
	try {
		const text = readFileSync(join(__dir, '.env'), 'utf-8')
		for (const line of text.split('\n')) {
			const t = line.trim()
			if (!t || t.startsWith('#')) continue
			const eq = t.indexOf('=')
			if (eq < 0) continue
			const key = t.slice(0, eq).trim()
			const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
			if (!process.env[key]) process.env[key] = val
		}
	} catch {
		// no .env file — rely on shell environment
	}
}

loadDotEnv()

// Normalize private key: auto-prepend 0x if missing (some wallets export without it)
const _rawPk = process.env.AGENT_PRIVATE_KEY ?? ''
const _normalizedPk = _rawPk && !_rawPk.startsWith('0x') ? `0x${_rawPk}` : _rawPk

const ENV = {
	openaiKey:    process.env.OPENAI_API_KEY ?? '',
	privateKey:   _normalizedPk as Hex,
	walletAddr:   (process.env.AGENT_WALLET_ADDRESS ?? '') as Hex,
	backendUrl:   process.env.BACKEND_URL    ?? 'http://localhost:4000',
	frontendUrl:  process.env.FRONTEND_URL   ?? 'http://localhost:3000',
	sepoliaRpc:   process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
	usdcAddress:  (process.env.USDC_ADDRESS   ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Hex,
}

// ─── ANSI palette ─────────────────────────────────────────────────────────────

const A = {
	reset:   '\x1b[0m',
	bold:    '\x1b[1m',
	dim:     '\x1b[2m',
	cyan:    '\x1b[36m',
	green:   '\x1b[32m',
	yellow:  '\x1b[33m',
	red:     '\x1b[31m',
	blue:    '\x1b[34m',
	magenta: '\x1b[35m',
	gray:    '\x1b[90m',
	white:   '\x1b[97m',
	bCyan:   '\x1b[96m',
	bGreen:  '\x1b[92m',
}

const paint = (code: string, s: string) => `${code}${s}${A.reset}`
const bold  = (s: string) => paint(A.bold,    s)
const dim   = (s: string) => paint(A.dim,     s)
const cyan  = (s: string) => paint(A.cyan,    s)
const bCyan = (s: string) => paint(A.bCyan,   s)
const green = (s: string) => paint(A.green,   s)
const bGrn  = (s: string) => paint(A.bGreen,  s)
const yell  = (s: string) => paint(A.yellow,  s)
const red   = (s: string) => paint(A.red,     s)
const gray  = (s: string) => paint(A.gray,    s)
const mag   = (s: string) => paint(A.magenta, s)

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = {
	banner() {
		console.log('')
		console.log(bold(bCyan('  CREHub Agent ')) + dim(' [GPT-4o + Openclaw + x402]'))
		console.log(cyan('  ' + '─'.repeat(42)))
	},
	step:   (s: string) => console.log(`${cyan('→')} ${s}`),
	sub:    (s: string) => console.log(`  ${gray('↳')} ${s}`),
	ok:     (s: string) => console.log(`${bGrn('✓')} ${s}`),
	warn:   (s: string) => console.log(`${yell('⚠')} ${s}`),
	err:    (s: string) => console.log(`${red('✗')} ${s}`),
	kv:     (k: string, v: string) => {
		const pad = k.padEnd(14)
		console.log(`   ${bold(pad)} ${dim(':')} ${v}`)
	},
	divider: () => console.log(dim('  ' + '─'.repeat(42))),
	nl: () => console.log(''),
}

// ─── Load SKILL.md ────────────────────────────────────────────────────────────
// Priority: 1) backend GET /skill.md  2) local file
// The frontend is NOT required — only the backend needs to be running.

async function loadSkillMd(): Promise<string> {
	log.step('Fetching SKILL.md...')
	try {
		const res = await fetch(`${ENV.backendUrl}/skill.md`, { signal: AbortSignal.timeout(3000) })
		if (res.ok) {
			log.sub('from backend  ' + dim(ENV.backendUrl + '/skill.md'))
			return await res.text()
		}
	} catch { /* fall through to local file */ }
	// Fallback: read from the local openclaw/ directory
	const local = readFileSync(join(__dir, 'SKILL.md'), 'utf-8')
	log.sub('from local file  ' + dim(join(__dir, 'SKILL.md')))
	return local
}

// ─── Agent wallet clients (lazy) ──────────────────────────────────────────────

let _clients: ReturnType<typeof createAgentClients> | null = null

function clients() {
	if (!_clients) {
		if (!ENV.privateKey || !ENV.privateKey.startsWith('0x')) {
			throw new Error(
				'AGENT_PRIVATE_KEY not set.\n' +
				'  Copy openclaw/.env.example → openclaw/.env and fill in your keys.',
			)
		}
		_clients = createAgentClients(ENV.privateKey, ENV.sepoliaRpc)
	}
	return _clients
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function toolSearchWorkflows(query: string, limit = 5): Promise<string> {
	log.step(`Searching: ${bold('"' + query + '"')}`)
	const url = `${ENV.backendUrl}/api/workflows/search?q=${encodeURIComponent(query)}&limit=${limit}`
	const res = await fetch(url)
	const data = await res.json() as Record<string, unknown>[]
	if (!data.length) {
		log.sub('no results')
		return '[]'
	}
	for (const wf of data) {
		const score = ((wf.score as number) ?? 0).toFixed(2)
		const price = formatUsdcWei(wf.pricePerInvocation as string)
		log.sub(`${bold(wf.workflowId as string)}  score:${cyan(score)}  ${yell(price)}`)
	}
	return JSON.stringify(data)
}

async function toolGetWorkflowDetail(workflowId: string): Promise<string> {
	log.step(`Detail: ${bold(workflowId)}`)
	const res = await fetch(`${ENV.backendUrl}/api/workflows/${workflowId}`)
	if (!res.ok) return JSON.stringify({ error: `Not found: ${workflowId}` })
	return JSON.stringify(await res.json())
}

async function toolCheckUsdcBalance(address: string): Promise<string> {
	log.step(`USDC balance: ${dim(address.slice(0, 10) + '...')}`)
	try {
		const bal = await checkUsdcBalance(clients().publicClient, ENV.usdcAddress, address as Hex)
		log.sub(`${bold(bal.usd)} USDC`)
		return JSON.stringify({ address, raw: bal.raw.toString(), usd: bal.usd })
	} catch (e) {
		return JSON.stringify({ error: String(e) })
	}
}

async function toolCheckEthBalance(address: string): Promise<string> {
	log.step(`ETH balance: ${dim(address.slice(0, 10) + '...')}`)
	try {
		const bal = await checkEthBalance(clients().publicClient, address as Hex)
		const eth = Number(bal.formatted).toFixed(6)
		log.sub(`${bold(eth)} ETH`)
		return JSON.stringify({ address, raw: bal.raw.toString(), eth })
	} catch (e) {
		return JSON.stringify({ error: String(e) })
	}
}

async function toolTriggerWorkflow(workflowId: string, params: Record<string, unknown>): Promise<string> {
	const safeParams = params && typeof params === 'object' ? params : {}
	log.step(`Trigger ${bold(workflowId)}  ${gray(JSON.stringify(safeParams))}`)
	const url  = `${ENV.backendUrl}/api/trigger/${workflowId}`
	const body = JSON.stringify(safeParams)
	const hdrs = { 'Content-Type': 'application/json' }

	// ── Step 1: probe (expect 402) ────────────────────────────────────────────
	const r1 = await fetch(url, { method: 'POST', headers: hdrs, body })

	if (r1.status === 200) {
		// rare: workflow free or already paid
		return JSON.stringify(await r1.json())
	}
	if (r1.status !== 402) {
		return JSON.stringify({ error: `Unexpected ${r1.status}: ${await r1.text()}` })
	}

	// ── Step 2: parse payment details ─────────────────────────────────────────
	const { paymentDetails } = await r1.json() as {
		paymentDetails: { payTo: string; amount: string; token: string }
	}
	const amtWei   = BigInt(paymentDetails.amount)
	const priceUsd = formatUsdcWei(paymentDetails.amount)
	log.sub(`402 Payment required — ${bold(priceUsd)} USDC`)

	// ── Step 3: check balance ─────────────────────────────────────────────────
	try {
		const { publicClient, walletClient } = clients()
		const agentAddr = (ENV.walletAddr || walletClient.account!.address) as Hex
		const bal = await checkUsdcBalance(publicClient, ENV.usdcAddress, agentAddr)

		if (bal.raw < amtWei) {
			log.sub(red(`Insufficient USDC: ${bal.usd} < ${priceUsd}`))
			return JSON.stringify({
				error: `Insufficient USDC. Have ${bal.usd}, need ${priceUsd}. ` +
				       `Get Sepolia USDC: https://faucet.circle.com`,
			})
		}
		log.sub(`USDC balance: ${bold(bal.usd)}  ✓`)

		// ── Step 4: broadcast transfer ────────────────────────────────────────
		log.sub('Broadcasting USDC transfer...')
		const txHash = await sendUsdcTransfer(
			walletClient,
			publicClient,
			ENV.usdcAddress,
			paymentDetails.payTo as Hex,
			amtWei,
		)
		log.sub(`Confirmed: ${cyan(txHash)}`)

		// ── Step 5: retry with payment proof ──────────────────────────────────
		log.sub('Retrying with X-Payment...')
		const r2 = await fetch(url, {
			method: 'POST',
			headers: { ...hdrs, 'X-Payment': txHash },
			body,
		})
		const result = await r2.json() as Record<string, unknown>
		return JSON.stringify({ ...result, paymentTxHash: txHash, pricePaid: priceUsd })

	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		log.err(`Payment: ${msg}`)
		return JSON.stringify({ error: `Payment failed: ${msg}` })
	}
}

// ─── OpenAI tools schema ──────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: 'search_workflows',
			description:
				'Search CREHub marketplace for workflows matching a natural language query. ' +
				'Returns workflow IDs, descriptions, prices, and input/output schemas. ' +
				'Always call this first to discover what capabilities are available.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Natural language search query, e.g. "aave health factor", "ETH USD price", "gas estimate"',
					},
					limit: {
						type: 'number',
						description: 'Max results (default 5, max 10)',
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_workflow_detail',
			description: 'Fetch full details for a workflow — input schema, output schema, price, creator address.',
			parameters: {
				type: 'object',
				properties: {
					workflowId: {
						type: 'string',
						description: 'Workflow ID from search results, e.g. "wf_hf_monitor_01"',
					},
				},
				required: ['workflowId'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'check_usdc_balance',
			description:
				'Check Sepolia USDC balance for a wallet. ' +
				'Use before triggering to confirm the agent has enough USDC to pay.',
			parameters: {
				type: 'object',
				properties: {
					address: { type: 'string', description: 'Ethereum wallet address' },
				},
				required: ['address'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'check_eth_balance',
			description: 'Check Sepolia ETH balance (needed for gas fees).',
			parameters: {
				type: 'object',
				properties: {
					address: { type: 'string', description: 'Ethereum wallet address' },
				},
				required: ['address'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'trigger_workflow',
			description:
				'Trigger a CRE workflow from CREHub. Handles x402 USDC payment automatically: ' +
				'sends 402 probe → pays USDC on Sepolia → retries with X-Payment header. ' +
				'Returns the workflow output, settlement tx, and price paid.',
			parameters: {
				type: 'object',
				properties: {
					workflowId: {
						type: 'string',
						description: 'Workflow ID to trigger, e.g. "wf_hf_monitor_01"',
					},
					params: {
						type: 'object',
						description:
							'Workflow input parameters. Keys must match the workflow inputs[].name fields exactly.',
						additionalProperties: true,
					},
				},
				required: ['workflowId', 'params'],
			},
		},
	},
]

// ─── Agentic loop ─────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: ENV.openaiKey })

interface RunResult {
	output:       Record<string, unknown> | null
	settlementTx: string | undefined
	pricePaid:    string | undefined
	agentText:    string
}

async function runAgent(userQuery: string, skillMd: string): Promise<RunResult> {
	console.log(`${dim('Query:')} ${bold('"' + userQuery + '"')}`)
	log.nl()

	const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content:
				`You are an autonomous CREHub agent. You discover and execute Chainlink CRE workflows to answer the user's query.\n\n` +
				`SKILL.md (your capability guide):\n${skillMd}\n\n` +
				`Agent wallet: ${ENV.walletAddr || '(not configured — set AGENT_WALLET_ADDRESS)'}\n\n` +
				`STRICT RULES — follow exactly:\n` +
				`1. ALWAYS call search_workflows first.\n` +
				`2. Pick the workflow with the HIGHEST score — any score > 0 is acceptable. Do NOT require score > 0.5.\n` +
				`3. Build params from the workflow's inputs[].name fields using values from the user query.\n` +
				`4. IMMEDIATELY call trigger_workflow — NEVER ask for user confirmation. NEVER explain and wait.\n` +
				`5. trigger_workflow handles x402 USDC payment fully automatically — just call it.\n` +
				`6. pricePerInvocation is in USDC wei (6 decimals): 10000 = $0.01 USDC.\n` +
				`7. After trigger: report the output fields. Do NOT invent values.\n` +
				`8. If no workflow matches at all (empty results), say so clearly.\n`,
		},
		{ role: 'user', content: userQuery },
	]

	let finalOutput:   Record<string, unknown> | null = null
	let settlementTx:  string | undefined
	let pricePaid:     string | undefined
	let agentText    = ''
	let searchedOnce = false  // true once search_workflows has been called
	let triggeredOnce = false // true once trigger_workflow has been called (success OR failure)

	for (let turn = 0; turn < 12; turn++) {
		const res = await openai.chat.completions.create({
			model:       'gpt-4o',
			messages,
			tools:       TOOLS,
			tool_choice: 'auto',
		})
		const choice = res.choices[0]
		const msg    = choice.message
		messages.push(msg)

		// ── GPT-4o returned text (no tool call) ──────────────────────────────
		if (!msg.tool_calls || msg.tool_calls.length === 0) {
			agentText = msg.content ?? ''

			// Nudge only when: search was done, trigger was NOT yet attempted,
			// and we haven't reached the turn limit.
			// Do NOT nudge if trigger already ran (even if it failed) — that means
			// there's a real error (missing key, insufficient balance, etc.).
			if (!triggeredOnce && searchedOnce && turn < 10) {
				log.sub(dim('(nudging agent to trigger…)'))
				messages.push({
					role:    'user',
					content: 'You have found matching workflows. Do NOT ask for confirmation. Call trigger_workflow RIGHT NOW with the best workflow and the params derived from the original query.',
				})
				agentText = ''
				continue
			}

			// True final answer
			break
		}

		// ── Execute tool calls ────────────────────────────────────────────────
		for (const tc of msg.tool_calls) {
			const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
			let toolResult: string

			switch (tc.function.name) {
				case 'search_workflows':
					toolResult   = await toolSearchWorkflows(args.query as string, args.limit as number | undefined)
					searchedOnce = true
					break
				case 'get_workflow_detail':
					toolResult = await toolGetWorkflowDetail(args.workflowId as string)
					break
				case 'check_usdc_balance':
					toolResult = await toolCheckUsdcBalance(args.address as string)
					break
				case 'check_eth_balance':
					toolResult = await toolCheckEthBalance(args.address as string)
					break
				case 'trigger_workflow': {
					toolResult    = await toolTriggerWorkflow(
						args.workflowId as string,
						args.params as Record<string, unknown>,
					)
					triggeredOnce = true  // mark as attempted regardless of outcome
					try {
						const parsed = JSON.parse(toolResult) as Record<string, unknown>
						if (parsed.success && parsed.output) {
							finalOutput  = parsed.output as Record<string, unknown>
							settlementTx = parsed.settlementTx as string | undefined
							pricePaid    = parsed.pricePaid as string | undefined
						}
					} catch { /* ignore parse errors */ }
					break
				}
				default:
					toolResult = JSON.stringify({ error: `Unknown tool: ${tc.function.name}` })
			}

			messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
		}
	}

	return { output: finalOutput, settlementTx, pricePaid, agentText }
}

// ─── Result printer ───────────────────────────────────────────────────────────

function printResult(r: RunResult) {
	log.nl()
	log.divider()

	if (r.output) {
		console.log(bold(bGrn('✅ Result')))
		for (const [k, v] of Object.entries(r.output)) {
			log.kv(k, String(v))
		}
		log.nl()
		if (r.pricePaid) log.kv('Paid', r.pricePaid + ' USDC')
		if (r.settlementTx) {
			log.kv('Settlement', cyan(r.settlementTx))
			log.kv('Etherscan', dim(`https://sepolia.etherscan.io/tx/${r.settlementTx}`))
		}
	} else if (r.agentText) {
		console.log(bold('Agent answer:'))
		console.log(r.agentText)
	}

	log.divider()
	log.nl()
}

// ─── Interactive TUI ──────────────────────────────────────────────────────────

const SAMPLE_QUERIES = [
	'Check Aave health factor for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	'What is the current ETH/USD price from Chainlink?',
	'What is the gas price on Ethereum right now?',
	'Check wallet balance for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	'Monitor wallet activity for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	'Get Chainlink proof of reserve for WBTC',
]

// Strip ANSI escape codes (used to compute visible string width)
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

// ─── Arrow-key selection menu ────────────────────────────────────────────────
// Returns the selected query string, or '' when the user picks "custom query".

async function arrowKeyMenu(items: string[]): Promise<string> {
	// ── Non-TTY fallback (piped input, CI) ────────────────────────────────────
	if (!process.stdin.isTTY) {
		const all = [...items, 'Enter custom query']
		all.forEach((q, i) => process.stdout.write(`  ${dim(String(i + 1) + '.')} ${q}\n`))
		return new Promise<string>(resolve => {
			const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
			rl.question(cyan('\nSelect [1-' + all.length + ']: '), ans => {
				rl.close()
				const n = parseInt(ans.trim())
				resolve(n >= 1 && n <= items.length ? items[n - 1] : '')
			})
		})
	}

	// ── TTY: arrow-key menu ───────────────────────────────────────────────────
	readline.emitKeypressEvents(process.stdin)
	process.stdin.setRawMode(true)

	// items.length sample options + 1 "custom" option
	const OPTS = items.length + 1
	// total rows drawn = OPTS item rows + 1 hint row
	const ROWS = OPTS + 1
	let sel     = 0
	let painted = false

	const draw = () => {
		// On re-draw, move cursor back to top of the menu block
		if (painted) process.stdout.write(`\x1b[${ROWS}A\r`)
		painted = true

		for (let i = 0; i < OPTS; i++) {
			const active = i === sel
			const label  = i < items.length ? items[i] : '↩  Enter custom query'
			const marker = active ? cyan('▶') : ' '
			const text   = active ? bold(cyan(label)) : dim(label)
			// \x1b[K clears to end-of-line so shorter re-renders don't leave artifacts
			process.stdout.write(`  ${marker} ${text}\x1b[K\n`)
		}
		process.stdout.write(dim('  ↑↓ navigate  ↵ select  ctrl+c exit\x1b[K') + '\n')
	}

	draw()

	return new Promise<string>(resolve => {
		const onKey = (_: unknown, key: { name: string; ctrl?: boolean }) => {
			if (!key) return

			if (key.ctrl && key.name === 'c') {
				process.stdin.setRawMode(false)
				process.stdin.removeListener('keypress', onKey)
				process.stdout.write('\n')
				process.exit(0)
			}

			if (key.name === 'up')   sel = (sel - 1 + OPTS) % OPTS
			if (key.name === 'down') sel = (sel + 1) % OPTS

			if (key.name === 'return') {
				process.stdin.setRawMode(false)
				process.stdin.removeListener('keypress', onKey)

				// Erase the menu block, print the confirmed selection, then a blank line
				process.stdout.write(`\x1b[${ROWS}A\r`)
				for (let i = 0; i < ROWS; i++) process.stdout.write('\x1b[2K\n')
				process.stdout.write(`\x1b[${ROWS}A\r`)

				const isCustom = sel >= items.length
				const label    = isCustom ? 'Custom query' : items[sel]
				process.stdout.write(`  ${cyan('▶')} ${bold(label)}\n\n`)
				resolve(isCustom ? '' : items[sel])
				return
			}

			draw()
		}
		process.stdin.on('keypress', onKey)
	})
}

// ─── Simple line-input prompt (used after raw mode is off) ───────────────────

async function promptLine(prompt: string): Promise<string> {
	// Ensure stdin is readable — raw mode leaves it active but not paused,
	// however a defensive resume() prevents any edge-case hangs.
	if (process.stdin.isPaused()) process.stdin.resume()

	return new Promise<string>(resolve => {
		const rl = readline.createInterface({
			input:    process.stdin,
			output:   process.stdout,
			terminal: !!process.stdin.isTTY,
		})
		rl.question(prompt, answer => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function printWelcomeBanner() {
	// Box inner width = 45 chars. boxRow() pads content to exactly that width.
	const INNER = 45
	const boxRow = (content: string, style: (s: string) => string = s => s) => {
		const visible = stripAnsi(content).length
		const pad     = ' '.repeat(Math.max(0, INNER - visible))
		return `  ${bCyan('│')}${style(content)}${pad}${bCyan('│')}`
	}
	console.log('')
	console.log('  ' + bCyan('┌' + '─'.repeat(INNER) + '┐'))
	console.log(boxRow('  CREHub Openclaw Agent',                         s => bold(s)))
	console.log(boxRow('  GPT-4o  ·  x402 USDC  ·  Ethereum Sepolia',    s => dim(s)))
	console.log(boxRow('  Openclaw · Claude Code · Any AI Agent',         s => dim(s)))
	console.log('  ' + bCyan('└' + '─'.repeat(INNER) + '┘'))
	console.log('')
}

// ─── Interactive loop ─────────────────────────────────────────────────────────

async function runInteractive(skillMd: string): Promise<void> {
	console.clear()
	printWelcomeBanner()

	const walletInfo = ENV.walletAddr
		? cyan(ENV.walletAddr)
		: yell('not configured  (set AGENT_WALLET_ADDRESS in openclaw/.env)')
	console.log(`  ${dim('wallet  :')} ${walletInfo}`)
	console.log(`  ${dim('backend :')} ${cyan(ENV.backendUrl)}`)
	console.log('')

	while (true) {
		console.log(dim('  ' + '─'.repeat(45)))
		console.log(`  ${bold('Select a query:')}\n`)

		let query = await arrowKeyMenu(SAMPLE_QUERIES)

		// Custom query path — raw mode is already off at this point
		if (query === '') {
			query = await promptLine(cyan('  Your query: '))
			console.log('')
			if (!query) {
				console.log(yell('  Empty query — try again.\n'))
				continue
			}
		}

		log.banner()
		const result = await runAgent(query, skillMd)
		printResult(result)

		const again = await promptLine(dim('  Run another query? [Y/n]: '))
		if (again.toLowerCase() === 'n') break
		console.log('')
	}

	console.log(dim('\n  Goodbye.\n'))
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
	if (!ENV.openaiKey) {
		console.error(red('Error: OPENAI_API_KEY not set'))
		console.error(dim('  Copy openclaw/.env.example → openclaw/.env and fill in your keys.'))
		process.exit(1)
	}

	const skillMd = await loadSkillMd()
	const cliArgs  = process.argv.slice(2)

	if (cliArgs.length === 0) {
		// Interactive TUI
		await runInteractive(skillMd)
	} else {
		// Single query
		const query = cliArgs.join(' ')
		log.banner()
		const result = await runAgent(query, skillMd)
		printResult(result)
	}
}

main().catch(err => {
	console.error(red('\nFatal: ') + (err instanceof Error ? err.message : String(err)))
	process.exit(1)
})

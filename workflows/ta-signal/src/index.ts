import {
	HTTPCapability,
	HTTPClient,
	EVMClient,
	type HTTPPayload,
	decodeJson,
	handler,
	Runner,
	type Runtime,
	TxStatus,
	bytesToHex,
	prepareReportRequest,
	getNetwork,
} from '@chainlink/cre-sdk'
import { z } from 'zod'
import { encodeReport, hashOutput } from './reportEncoder'

// ─── Config ───────────────────────────────────────────────────────────────────

const configSchema = z.object({
	gatewayPublicKey: z.string(),
	workflowId: z.string(),
	taapiSecret: z.string(),
	openaiApiKey: z.string(),
	chainSelectorSepolia: z.string(),
	executorAddress: z.string(),
	gasLimit: z.number(),
	/** Set true in local-simulation to skip the on-chain write step. */
	skipOnChainWrite: z.boolean().optional(),
})

export type Config = z.infer<typeof configSchema>

// ─── Input / Output ───────────────────────────────────────────────────────────

export const inputSchema = z.object({
	symbol:   z.string().default('BTC/USDT'),
	exchange: z.string().default('binance'),
	interval: z.string().default('1h'),
})

export type WorkflowInput = z.infer<typeof inputSchema>

export interface Indicators {
	rsi:        number
	macd:       number
	macdSignal: number
	macdHist:   number
	bbUpper:    number
	bbMiddle:   number
	bbLower:    number
	price:      number
}

export interface WorkflowOutput {
	decision:   'BUY' | 'SELL' | 'HOLD'
	confidence: number
	reason:     string
	indicators: Indicators
	symbol:     string
	interval:   string
	timestamp:  string
	/** Sepolia tx hash of the CRE on-chain write, present when the broadcast step ran. */
	onChainTxHash?: string
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function encode(obj: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(obj))
}

function parseJSON(text: string): unknown {
	// Strip markdown code fences if present (```json ... ```)
	const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
	return JSON.parse(stripped)
}

// ─── TAAPI.io ─────────────────────────────────────────────────────────────────

function fetchIndicators(
	runtime: Runtime<Config>,
	http: HTTPClient,
	input: WorkflowInput,
): Indicators {
	const { taapiSecret } = runtime.config

	const body = {
		secret: taapiSecret,
		construct: {
			exchange: input.exchange,
			symbol:   input.symbol,
			interval: input.interval,
			indicators: [
				{ id: 'rsi',    indicator: 'rsi'    },
				{ id: 'macd',   indicator: 'macd'   },
				{ id: 'bbands', indicator: 'bbands' },
				{ id: 'candle', indicator: 'candle' },
			],
		},
	}

	runtime.log('[ta-signal] Calling TAAPI bulk endpoint')

	const resp = http.sendRequest(runtime, {
		url:    'https://api.taapi.io/bulk',
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body:   encode(body),
		cache_settings: { store: false },
	}).result()

	if (resp.statusCode < 200 || resp.statusCode >= 300) {
		throw new Error(`TAAPI error ${resp.statusCode}: ${new TextDecoder().decode(resp.body)}`)
	}

	const raw = parseJSON(new TextDecoder().decode(resp.body)) as {
		data: Array<{ id: string; result: Record<string, number> }>
	}

	const byId: Record<string, Record<string, number>> = {}
	for (const item of raw.data) {
		byId[item.id] = item.result
	}

	runtime.log(`[ta-signal] RSI=${byId['rsi']?.value}, MACD hist=${byId['macd']?.valueMACD}`)

	return {
		rsi:        byId['rsi']?.value           ?? 50,
		macd:       byId['macd']?.valueMACD      ?? 0,
		macdSignal: byId['macd']?.valueMACDSignal ?? 0,
		macdHist:   byId['macd']?.valueMACDHist   ?? 0,
		bbUpper:    byId['bbands']?.valueUpperBand  ?? 0,
		bbMiddle:   byId['bbands']?.valueMiddleBand ?? 0,
		bbLower:    byId['bbands']?.valueLowerBand  ?? 0,
		price:      byId['candle']?.close          ?? 0,
	}
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

function fetchDecision(
	runtime: Runtime<Config>,
	http: HTTPClient,
	input: WorkflowInput,
	ind: Indicators,
): { decision: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string } {
	const { openaiApiKey } = runtime.config

	const userMsg = `Analyze the following technical indicators for ${input.symbol} on the ${input.interval} timeframe and provide a trading signal.

Indicators:
- RSI: ${ind.rsi.toFixed(2)}
- MACD: ${ind.macd.toFixed(4)}, Signal: ${ind.macdSignal.toFixed(4)}, Histogram: ${ind.macdHist.toFixed(4)}
- Bollinger Bands: Upper=${ind.bbUpper.toFixed(2)}, Middle=${ind.bbMiddle.toFixed(2)}, Lower=${ind.bbLower.toFixed(2)}
- Current Price: ${ind.price.toFixed(2)}

Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside JSON):
{"decision":"BUY"|"SELL"|"HOLD","confidence":<0-1>,"reason":"<one sentence>"}`

	const payload = {
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content: 'You are a professional crypto technical analyst. You respond only with valid JSON as instructed.',
			},
			{ role: 'user', content: userMsg },
		],
		temperature: 0.2,
		max_tokens: 200,
	}

	runtime.log('[ta-signal] Calling OpenAI gpt-4o-mini')

	const resp = http.sendRequest(runtime, {
		url:    'https://api.openai.com/v1/chat/completions',
		method: 'POST',
		headers: {
			'Content-Type':  'application/json',
			'Authorization': `Bearer ${openaiApiKey}`,
		},
		body:   encode(payload),
		cache_settings: { store: false },
	}).result()

	if (resp.statusCode < 200 || resp.statusCode >= 300) {
		throw new Error(`OpenAI error ${resp.statusCode}: ${new TextDecoder().decode(resp.body)}`)
	}

	const json = parseJSON(new TextDecoder().decode(resp.body)) as {
		choices: Array<{ message: { content: string } }>
	}

	const content = json.choices?.[0]?.message?.content ?? ''
	runtime.log(`[ta-signal] OpenAI response: ${content}`)

	const parsed = parseJSON(content) as {
		decision: string
		confidence: number
		reason: string
	}

	const decision = (['BUY', 'SELL', 'HOLD'].includes(parsed.decision)
		? parsed.decision
		: 'HOLD') as 'BUY' | 'SELL' | 'HOLD'

	return {
		decision,
		confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
		reason:     String(parsed.reason ?? ''),
	}
}

// ─── HTTP Trigger Handler ─────────────────────────────────────────────────────

export const onHTTPTrigger = (
	runtime: Runtime<Config>,
	payload: HTTPPayload,
): WorkflowOutput => {
	runtime.log('[ta-signal] Trigger received')

	const rawInput = decodeJson(payload.input)
	const input = inputSchema.parse(rawInput)

	runtime.log(`[ta-signal] symbol=${input.symbol} exchange=${input.exchange} interval=${input.interval}`)

	const http = new HTTPClient()
	const indicators = fetchIndicators(runtime, http, input)
	const { decision, confidence, reason } = fetchDecision(runtime, http, input, indicators)

	const output: WorkflowOutput = {
		decision,
		confidence,
		reason,
		indicators,
		symbol:    input.symbol,
		interval:  input.interval,
		timestamp: new Date().toISOString(),
	}

	runtime.log(`[ta-signal] Result: ${decision} (confidence=${confidence})`)

	// ── Broadcast result hash to Sepolia via CRE Forwarder ──
	if (runtime.config.skipOnChainWrite) {
		runtime.log('[on-chain] skipOnChainWrite=true — skipping broadcast (local simulation)')
		return output
	}

	runtime.log('[on-chain] Encoding workflow report...')
	const resultHash = hashOutput(output)
	const reportPayload = encodeReport(runtime.config.workflowId, resultHash)

	runtime.log('[on-chain] Generating CRE report...')
	const reportResponse = runtime
		.report(prepareReportRequest(reportPayload))
		.result()

	runtime.log(`[on-chain] Writing to CREHubExecutor on Sepolia: ${runtime.config.executorAddress}`)
	const sepoliaNetwork = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: runtime.config.chainSelectorSepolia,
		isTestnet: true,
	})
	if (!sepoliaNetwork) {
		throw new Error(`[on-chain] Unknown chain: ${runtime.config.chainSelectorSepolia}`)
	}

	const evmClient = new EVMClient(sepoliaNetwork.chainSelector.selector)
	const writeResult = evmClient
		.writeReport(runtime, {
			receiver: runtime.config.executorAddress,
			report: reportResponse,
			gasConfig: { gasLimit: String(runtime.config.gasLimit) },
		})
		.result()

	if (writeResult.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`[on-chain] Transaction failed: ${writeResult.txStatus}`)
	}

	const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
	runtime.log(`[on-chain] ✓ Transaction confirmed: ${txHash}`)

	return { ...output, onChainTxHash: txHash }
}

// ─── Workflow Init ────────────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
	const httpCapability = new HTTPCapability()

	return [
		handler(
			httpCapability.trigger({
				authorizedKeys: [
					{
						type: 'KEY_TYPE_ECDSA_EVM',
						publicKey: config.gatewayPublicKey,
					},
				],
			}),
			onHTTPTrigger,
		),
	]
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}

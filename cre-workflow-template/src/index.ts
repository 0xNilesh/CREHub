import {
	HTTPCapability,
	HTTPClient,
	EVMClient,
	type HTTPPayload,
	type HTTPSendRequester,
	consensusIdenticalAggregation,
	decodeJson,
	handler,
	json,
	ok,
	Runner,
	type Runtime,
	TxStatus,
	bytesToHex,
	prepareReportRequest,
	getNetwork,
} from '@chainlink/cre-sdk'
import { z } from 'zod'
import { encodeReport, hashOutput } from './reportEncoder'

// ─── Config ──────────────────────────────────────────────────────────────────
// Loaded from config.json at workflow deploy/simulate time.
// Add any runtime config fields your workflow needs below.
const configSchema = z.object({
	// CREHUB GATEWAY PUBLIC KEY — only the CREHub x402 gateway can trigger
	// this workflow. Set this to the CREHub gateway's EVM address in config.json.
	gatewayPublicKey: z.string(),
	workflowId: z.string(),
	// Example: add an API URL or contract address as a runtime config field
	apiUrl: z.string(),
	// ── On-chain broadcast config (CREHubExecutor) ──
	chainSelectorSepolia: z.string(),
	executorAddress: z.string(),
	gasLimit: z.number(),
	/** Set true in local-simulation to skip the on-chain write step. */
	skipOnChainWrite: z.boolean().optional(),
})

export type Config = z.infer<typeof configSchema>

// ─── Input ───────────────────────────────────────────────────────────────────
// Must match the `inputs` array in metadata.json.
// Replace these fields with your own workflow's required inputs.
export const inputSchema = z.object({
	walletAddress: z
		.string()
		.regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address'),
	protocol: z.enum(['aave', 'compound']).default('aave'),
})

export type WorkflowInput = z.infer<typeof inputSchema>

// ─── Output ──────────────────────────────────────────────────────────────────
// Must match the `outputs` array in metadata.json.
export interface WorkflowOutput {
	healthFactor: number
	riskLevel: 'safe' | 'warning' | 'danger'
	/** Sepolia tx hash of the CRE on-chain write, present when the broadcast step ran. */
	onChainTxHash?: string
}

// ─── Pure Business Logic ─────────────────────────────────────────────────────
// Extracted so it can be unit-tested without the CRE runtime.

export const computeRiskLevel = (healthFactor: number): 'safe' | 'warning' | 'danger' => {
	if (healthFactor >= 1.5) return 'safe'
	if (healthFactor >= 1.1) return 'warning'
	return 'danger'
}

// Called in node mode via HTTPClient so every DON node runs it independently
// and results are aggregated via consensusIdenticalAggregation.
export const fetchHealthFactor = (
	sendRequester: HTTPSendRequester,
	config: Config,
	input: WorkflowInput,
): Omit<WorkflowOutput, 'onChainTxHash'> => {
	const url = `${config.apiUrl}/health-factor/${input.walletAddress}?protocol=${input.protocol}`
	const response = sendRequester.sendRequest({ url, method: 'GET' }).result()

	if (!ok(response)) {
		throw new Error(`API request failed with status: ${response.statusCode}`)
	}

	const data = json(response) as { healthFactor: number }
	const healthFactor = Number(data.healthFactor)

	if (Number.isNaN(healthFactor)) {
		throw new Error('API returned a non-numeric healthFactor')
	}

	return { healthFactor, riskLevel: computeRiskLevel(healthFactor) }
}

// ─── HTTP Trigger Handler ─────────────────────────────────────────────────────
export const onHTTPTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): WorkflowOutput => {
	runtime.log('CREHub HTTP trigger received')

	// Decode and validate the JSON input sent by the gateway
	const rawInput = decodeJson(payload.input)
	const input = inputSchema.parse(rawInput)

	runtime.log(`Input: walletAddress=${input.walletAddress} protocol=${input.protocol}`)

	// ── YOUR WORKFLOW LOGIC GOES HERE ─────────────────────────────────────────
	// Replace fetchHealthFactor with your own implementation.
	// Use HTTPClient for external API calls with consensus across DON nodes.
	// Use EVMClient for on-chain reads (e.g. Aave v3 health factor via contract call).
	const httpClient = new HTTPClient()
	const result = httpClient
		.sendRequest(runtime, fetchHealthFactor, consensusIdenticalAggregation())(
			runtime.config,
			input,
		)
		.result()

	runtime.log(`Output: healthFactor=${result.healthFactor} riskLevel=${result.riskLevel}`)

	// ── Broadcast result hash to Sepolia via CRE Forwarder ──
	if (runtime.config.skipOnChainWrite) {
		runtime.log('[on-chain] skipOnChainWrite=true — skipping broadcast (local simulation)')
		return result
	}

	runtime.log('[on-chain] Encoding workflow report...')
	const resultHash = hashOutput(result)
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

	return { ...result, onChainTxHash: txHash }
}

// ─── Workflow Init ─────────────────────────────────────────────────────────────
const initWorkflow = (config: Config) => {
	const httpCapability = new HTTPCapability()

	return [
		handler(
			httpCapability.trigger({
				// Only requests signed by the CREHub gateway private key are accepted.
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

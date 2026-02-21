import {
	HTTPCapability,
	HTTPClient,
	type HTTPPayload,
	type HTTPSendRequester,
	consensusIdenticalAggregation,
	decodeJson,
	handler,
	json,
	ok,
	Runner,
	type Runtime,
} from '@chainlink/cre-sdk'
import { z } from 'zod'

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
}

// ─── Pure Business Logic ─────────────────────────────────────────────────────
// Extracted so it can be unit-tested without the CRE runtime.

export const computeRiskLevel = (healthFactor: number): WorkflowOutput['riskLevel'] => {
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
): WorkflowOutput => {
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
	return result
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

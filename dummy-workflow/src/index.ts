import {
	HTTPCapability,
	HTTPClient,
	type HTTPPayload,
	decodeJson,
	handler,
	Runner,
	type Runtime,
} from '@chainlink/cre-sdk'
import { z } from 'zod'

// ─── Config ───────────────────────────────────────────────────────────────────
// Fields here are read from config.json at runtime.
// Add API keys, addresses, or any other secrets your workflow needs.

const configSchema = z.object({
	gatewayPublicKey: z.string(),
	workflowId: z.string(),
	// myApiKey: z.string(),
})

export type Config = z.infer<typeof configSchema>

// ─── Input Schema ─────────────────────────────────────────────────────────────
// These fields are sent by the agent in the HTTP trigger payload.

export const inputSchema = z.object({
	dummy: z.string().optional(),
})

export type WorkflowInput = z.infer<typeof inputSchema>

// ─── Output ───────────────────────────────────────────────────────────────────

export interface WorkflowOutput {
	// Add your output fields here:
	timestamp: string
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
// IMPORTANT: This function must be synchronous — no async/await.
// HTTPClient.sendRequest(...).result() is already synchronous.

export const onHTTPTrigger = (
	runtime: Runtime<Config>,
	payload: HTTPPayload,
): WorkflowOutput => {
	runtime.log('[wf_dummy_workflow_01] Trigger received')

	const rawInput = decodeJson(payload.input)
	const input = inputSchema.parse(rawInput)

	// ── Your workflow logic ──────────────────────────────────────────────────
	// Access config:   runtime.config.myApiKey
	// Outgoing HTTP:   const http = new HTTPClient()
	//                  const resp = http.sendRequest(runtime, {
	//                    url: 'https://api.example.com/data',
	//                    method: 'GET',
	//                    headers: { 'Authorization': `Bearer ${runtime.config.myApiKey}` },
	//                    cache_settings: { store: false },
	//                  }).result()
	//                  const data = JSON.parse(new TextDecoder().decode(resp.body))
	// ─────────────────────────────────────────────────────────────────────────

	return {
		timestamp: new Date().toISOString(),
	}
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

/**
 * x402 Gateway proxy.
 *
 * Forwards POST /api/trigger/:workflowId → POST {GATEWAY_URL}/trigger/:workflowId
 * Passes through X-PAYMENT, Content-Type, and JSON body.
 * Returns the gateway's response verbatim (402 or 200).
 */
import type { Request, Response } from 'express'

const GATEWAY_URL = () => process.env.GATEWAY_URL ?? 'http://localhost:8080'

export const proxyTrigger = async (req: Request, res: Response): Promise<void> => {
	const { workflowId } = req.params
	const targetUrl = `${GATEWAY_URL()}/trigger/${workflowId}`

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	}

	// Forward payment header if present
	const xPayment = req.headers['x-payment']
	if (xPayment) headers['x-payment'] = xPayment as string

	try {
		const upstream = await fetch(targetUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(req.body),
		})

		const body = await upstream.json()
		res.status(upstream.status).json(body)
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Gateway unreachable'
		res.status(502).json({ error: `Gateway error: ${msg}` })
	}
}

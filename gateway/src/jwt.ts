/**
 * ETH-signed JWT creation for CRE Gateway authentication.
 *
 * Ported from cre-sdk-typescript/packages/cre-http-trigger/src/create-jwt.ts
 * and trigger-workflow.ts. Uses viem instead of ethers.
 *
 * JWT format:
 *   Header:  { alg: "ETH", typ: "JWT" }
 *   Payload: { digest, iss, iat, exp, jti }
 *   Sig:     ECDSA/secp256k1 over "header.payload" (Ethereum signed message)
 */
import { createHash } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { type Hex, parseSignature } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import stringify from 'json-stable-stringify'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const sha256 = (data: unknown): string => {
	const jsonString = typeof data === 'string' ? data : (stringify(data) ?? '')
	return createHash('sha256').update(jsonString).digest('hex')
}

export const base64URLEncode = (str: string): string =>
	str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JSONRPCRequest {
	jsonrpc: string
	id: string
	method: string
	params: {
		input: unknown
		workflow: {
			workflowID?: string
			workflowOwner?: string
			workflowName?: string
			workflowTag?: string
		}
	}
}

export interface JWTPayload {
	digest: string
	iss: string
	iat: number
	exp: number
	jti: string
}

// ─── createJWT ────────────────────────────────────────────────────────────────

export const createJWT = async (request: JSONRPCRequest, privateKey: Hex): Promise<string> => {
	const account = privateKeyToAccount(privateKey)

	const header = { alg: 'ETH', typ: 'JWT' }

	const now = Math.floor(Date.now() / 1000)
	const payload: JWTPayload = {
		digest: `0x${sha256(request)}`,
		iss: account.address,
		iat: now,
		exp: now + 300, // 5-minute TTL
		jti: uuidv4(),
	}

	const encodedHeader = base64URLEncode(
		Buffer.from(JSON.stringify(header), 'utf8').toString('base64'),
	)
	const encodedPayload = base64URLEncode(
		Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
	)
	const rawMessage = `${encodedHeader}.${encodedPayload}`

	const signature = await account.signMessage({ message: rawMessage })

	const { r, s, v, yParity } = parseSignature(signature)
	const recoveryId = v !== undefined ? (v >= 27n ? v - 27n : v) : yParity

	if (recoveryId === undefined) {
		throw new Error('Unable to extract recovery ID from signature')
	}

	const rBuffer = Buffer.from(r.slice(2).padStart(64, '0'), 'hex')
	const sBuffer = Buffer.from(s.slice(2).padStart(64, '0'), 'hex')
	const signatureBytes = Buffer.concat([rBuffer, sBuffer, Buffer.from([Number(recoveryId)])])
	const encodedSignature = base64URLEncode(signatureBytes.toString('base64'))

	return `${rawMessage}.${encodedSignature}`
}

// ─── buildJSONRPCRequest ──────────────────────────────────────────────────────

export const buildJSONRPCRequest = (workflowId: string, input: unknown): JSONRPCRequest => ({
	jsonrpc: '2.0',
	id: uuidv4(),
	method: 'workflows.execute',
	params: {
		input,
		workflow: { workflowID: workflowId },
	},
})

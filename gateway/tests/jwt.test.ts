/**
 * Phase 2 – jwt.ts tests
 *
 * Tests sha256, base64URLEncode, buildJSONRPCRequest, and createJWT
 * using a deterministic test private key.
 */
import { describe, expect, test } from 'bun:test'
import {
	sha256,
	base64URLEncode,
	buildJSONRPCRequest,
	createJWT,
	type JSONRPCRequest,
} from '../src/jwt'

// ─── sha256 ───────────────────────────────────────────────────────────────────

describe('sha256', () => {
	test('produces a 64-char hex string', () => {
		const hash = sha256({ hello: 'world' })
		expect(hash).toHaveLength(64)
		expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
	})

	test('is deterministic — same input gives same hash', () => {
		const a = sha256({ b: 2, a: 1 })
		const b = sha256({ a: 1, b: 2 })
		expect(a).toBe(b) // json-stable-stringify sorts keys
	})

	test('different inputs give different hashes', () => {
		expect(sha256({ a: 1 })).not.toBe(sha256({ a: 2 }))
	})

	test('works with string input (not re-serialised)', () => {
		const hash = sha256('hello')
		// Known SHA-256 of the string "hello"
		expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
	})
})

// ─── base64URLEncode ──────────────────────────────────────────────────────────

describe('base64URLEncode', () => {
	test('removes padding characters', () => {
		// btoa("a") = "YQ==" in standard base64; url-safe removes "=="
		const encoded = base64URLEncode('YQ==')
		expect(encoded).not.toContain('=')
	})

	test('replaces + with -', () => {
		expect(base64URLEncode('a+b')).toBe('a-b')
	})

	test('replaces / with _', () => {
		expect(base64URLEncode('a/b')).toBe('a_b')
	})

	test('leaves alphanumeric unchanged', () => {
		expect(base64URLEncode('abc123')).toBe('abc123')
	})
})

// ─── buildJSONRPCRequest ──────────────────────────────────────────────────────

describe('buildJSONRPCRequest', () => {
	const req = buildJSONRPCRequest('wf_test_01', { walletAddress: '0x1234' })

	test('has jsonrpc 2.0', () => {
		expect(req.jsonrpc).toBe('2.0')
	})

	test('method is workflows.execute', () => {
		expect(req.method).toBe('workflows.execute')
	})

	test('params.workflow.workflowID matches', () => {
		expect(req.params.workflow.workflowID).toBe('wf_test_01')
	})

	test('params.input matches provided input', () => {
		expect(req.params.input).toEqual({ walletAddress: '0x1234' })
	})

	test('id is a non-empty string (UUID)', () => {
		expect(typeof req.id).toBe('string')
		expect(req.id.length).toBeGreaterThan(0)
	})

	test('each call generates a unique id', () => {
		const r1 = buildJSONRPCRequest('wf_1', {})
		const r2 = buildJSONRPCRequest('wf_1', {})
		expect(r1.id).not.toBe(r2.id)
	})
})

// ─── createJWT ────────────────────────────────────────────────────────────────

// Deterministic test private key (never use in production)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

describe('createJWT', () => {
	const request: JSONRPCRequest = buildJSONRPCRequest('wf_test', { hello: 'world' })

	test('returns a string with three dot-separated parts', async () => {
		const jwt = await createJWT(request, TEST_PRIVATE_KEY)
		const parts = jwt.split('.')
		expect(parts).toHaveLength(3)
	})

	test('header decodes to { alg: ETH, typ: JWT }', async () => {
		const jwt = await createJWT(request, TEST_PRIVATE_KEY)
		const [headerB64] = jwt.split('.')
		// Re-add padding for atob
		const padded = headerB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
			headerB64.length + ((4 - (headerB64.length % 4)) % 4),
			'=',
		)
		const header = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
		expect(header.alg).toBe('ETH')
		expect(header.typ).toBe('JWT')
	})

	test('payload contains digest, iss, iat, exp, jti', async () => {
		const jwt = await createJWT(request, TEST_PRIVATE_KEY)
		const [, payloadB64] = jwt.split('.')
		const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
			payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
			'=',
		)
		const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
		expect(payload.digest).toMatch(/^0x[0-9a-f]{64}$/)
		expect(payload.iss).toMatch(/^0x[0-9a-fA-F]{40}$/)
		expect(typeof payload.iat).toBe('number')
		expect(typeof payload.exp).toBe('number')
		expect(payload.exp - payload.iat).toBe(300)
		expect(typeof payload.jti).toBe('string')
	})

	test('exp is 300 seconds after iat', async () => {
		const jwt = await createJWT(request, TEST_PRIVATE_KEY)
		const [, payloadB64] = jwt.split('.')
		const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
			payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
			'=',
		)
		const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
		expect(payload.exp - payload.iat).toBe(300)
	})

	test('digest is sha256 of the request object', async () => {
		const jwt = await createJWT(request, TEST_PRIVATE_KEY)
		const [, payloadB64] = jwt.split('.')
		const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
			payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
			'=',
		)
		const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
		expect(payload.digest).toBe(`0x${sha256(request)}`)
	})

	test('iss is the ethereum address derived from the private key', async () => {
		const jwt = await createJWT(request, TEST_PRIVATE_KEY)
		const [, payloadB64] = jwt.split('.')
		const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
			payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
			'=',
		)
		const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
		// Hardhat account #0 address
		expect(payload.iss.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')
	})

	test('no base64 padding characters in any part', async () => {
		const jwt = await createJWT(request, TEST_PRIVATE_KEY)
		expect(jwt).not.toContain('=')
	})

	test('different requests produce different digests', async () => {
		const req2 = buildJSONRPCRequest('wf_test', { hello: 'different' })
		const jwt1 = await createJWT(request, TEST_PRIVATE_KEY)
		const jwt2 = await createJWT(req2, TEST_PRIVATE_KEY)

		const getDigest = (jwt: string) => {
			const [, payloadB64] = jwt.split('.')
			const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
				payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
				'=',
			)
			return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')).digest
		}

		expect(getDigest(jwt1)).not.toBe(getDigest(jwt2))
	})
})

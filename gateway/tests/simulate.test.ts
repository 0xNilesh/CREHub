/**
 * Phase 2 – simulate.ts tests
 *
 * Tests parseSimulateOutput (pure, no subprocess) and runSimulate (mocked execSync).
 */
import { describe, expect, test, spyOn, beforeEach, afterEach } from 'bun:test'
import { parseSimulateOutput } from '../src/simulate'
import * as childProcess from 'node:child_process'

// ─── parseSimulateOutput ───────────────────────────────────────────────────────

describe('parseSimulateOutput', () => {
	test('extracts last JSON object from stdout', () => {
		const stdout = [
			'[2025-01-01] Starting simulation...',
			'[2025-01-01] Executing handler...',
			'{"healthFactor":2.4,"riskLevel":"safe"}',
		].join('\n')

		const result = parseSimulateOutput(stdout)
		expect(result.success).toBe(true)
		expect(result.output).toEqual({ healthFactor: 2.4, riskLevel: 'safe' })
		expect(result.logs.length).toBeGreaterThan(0)
	})

	test('uses last JSON when multiple JSON objects appear in output', () => {
		const stdout = [
			'{"intermediate":"value","step":1}',
			'[log] some message',
			'{"healthFactor":1.2,"riskLevel":"warning"}',
		].join('\n')

		const result = parseSimulateOutput(stdout)
		expect(result.success).toBe(true)
		expect((result.output as { riskLevel: string }).riskLevel).toBe('warning')
	})

	test('handles JSON array output', () => {
		const stdout = ['[log] running', '[{"txHash":"0xabc","chain":1}]'].join('\n')

		const result = parseSimulateOutput(stdout)
		expect(result.success).toBe(true)
		expect(Array.isArray(result.output)).toBe(true)
	})

	test('returns success=false when no JSON found', () => {
		const stdout = ['Starting simulation...', 'Executing workflow...', 'Done.'].join('\n')

		const result = parseSimulateOutput(stdout)
		expect(result.success).toBe(false)
		expect(result.error).toBeTruthy()
		expect(result.output).toBeNull()
	})

	test('returns success=false for empty stdout', () => {
		const result = parseSimulateOutput('')
		expect(result.success).toBe(false)
	})

	test('includes all stdout lines in logs', () => {
		const stdout = ['line 1', 'line 2', '{"result":true}'].join('\n')
		const result = parseSimulateOutput(stdout)
		expect(result.logs).toContain('line 1')
		expect(result.logs).toContain('line 2')
	})

	test('skips lines that look like JSON but are not valid', () => {
		const stdout = [
			'{invalid json here}',
			'[log] something',
			'{"healthFactor":2.1,"riskLevel":"safe"}',
		].join('\n')

		const result = parseSimulateOutput(stdout)
		expect(result.success).toBe(true)
		expect((result.output as { healthFactor: number }).healthFactor).toBe(2.1)
	})
})

// ─── runSimulate ──────────────────────────────────────────────────────────────

describe('runSimulate', () => {
	test('returns parsed output on successful cre simulate', async () => {
		// Mock execSync to return workflow output
		const mockOutput = '{"healthFactor":2.4,"riskLevel":"safe"}'
		const spy = spyOn(childProcess, 'execSync').mockReturnValue(mockOutput as any)

		const { runSimulate } = await import('../src/simulate')
		const result = await runSimulate('/tmp/fake-workflow', { walletAddress: '0x1234' })

		expect(result.success).toBe(true)
		expect(result.output).toEqual({ healthFactor: 2.4, riskLevel: 'safe' })

		spy.mockRestore()
	})

	test('returns success=false when execSync throws (non-zero exit)', async () => {
		const spy = spyOn(childProcess, 'execSync').mockImplementation(() => {
			const err = new Error('cre simulate failed') as any
			err.stdout = ''
			err.stderr = 'Error: workflow handler threw an exception'
			throw err
		})

		const { runSimulate } = await import('../src/simulate')
		const result = await runSimulate('/tmp/fake-workflow', { walletAddress: '0x1234' })

		expect(result.success).toBe(false)
		expect(result.error).toContain('workflow handler threw an exception')

		spy.mockRestore()
	})

	test('returns success=false when output has no JSON', async () => {
		const spy = spyOn(childProcess, 'execSync').mockReturnValue(
			'Starting...\nCompiling...\nDone.' as any,
		)

		const { runSimulate } = await import('../src/simulate')
		const result = await runSimulate('/tmp/fake-workflow', {})

		expect(result.success).toBe(false)

		spy.mockRestore()
	})
})

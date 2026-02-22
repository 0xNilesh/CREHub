/**
 * Phase 2 – simulate.ts tests
 *
 * Tests parseSimulateOutput (pure, no subprocess) and runSimulate (mocked spawn).
 */
import { describe, expect, test, spyOn } from 'bun:test'
import { EventEmitter } from 'node:events'
import { parseSimulateOutput } from '../src/simulate'
import * as childProcess from 'node:child_process'

// ─── spawn mock helper ────────────────────────────────────────────────────────

function makeSpawnMock(stdout: string, stderr: string, exitCode: number) {
	const proc = new EventEmitter() as any
	proc.stdout = new EventEmitter()
	proc.stderr = new EventEmitter()
	proc.kill  = () => {}

	// Emit data + close on next tick so listeners are attached first
	setTimeout(() => {
		if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
		if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
		proc.emit('close', exitCode)
	}, 0)

	return proc
}

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
		const mockOutput = '{"healthFactor":2.4,"riskLevel":"safe"}'
		const spy = spyOn(childProcess, 'spawn').mockReturnValue(
			makeSpawnMock(mockOutput, '', 0) as any,
		)

		const { runSimulate } = await import('../src/simulate')
		const result = await runSimulate('/tmp/fake-workflow', { walletAddress: '0x1234' })

		expect(result.success).toBe(true)
		expect(result.output).toEqual({ healthFactor: 2.4, riskLevel: 'safe' })

		spy.mockRestore()
	})

	test('returns success=false when spawn exits non-zero', async () => {
		const spy = spyOn(childProcess, 'spawn').mockReturnValue(
			makeSpawnMock('', 'Error: workflow handler threw an exception', 1) as any,
		)

		const { runSimulate } = await import('../src/simulate')
		const result = await runSimulate('/tmp/fake-workflow', { walletAddress: '0x1234' })

		expect(result.success).toBe(false)
		expect(result.error).toContain('workflow handler threw an exception')

		spy.mockRestore()
	})

	test('returns success=false when output has no JSON', async () => {
		const spy = spyOn(childProcess, 'spawn').mockReturnValue(
			makeSpawnMock('Starting...\nCompiling...\nDone.', '', 0) as any,
		)

		const { runSimulate } = await import('../src/simulate')
		const result = await runSimulate('/tmp/fake-workflow', {})

		expect(result.success).toBe(false)

		spy.mockRestore()
	})
})

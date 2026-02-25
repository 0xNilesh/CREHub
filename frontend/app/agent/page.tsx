'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AgentEvent } from '@/app/api/agent/run/route'

// ─── Sample queries ───────────────────────────────────────────────────────────

const SAMPLES = [
	{
		label:      'Aave Health Factor',
		query:      'Check Aave health factor',
		workflowId: 'wf_hf_monitor_01',
		params:     { walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', protocol: 'aave' },
	},
	{
		label:      'ETH/USD Price',
		query:      'Get ETH/USD price from Chainlink',
		workflowId: 'wf_price_feed_01',
		params:     { pair: 'ETH/USD' },
	},
	{
		label:      'Gas Estimator',
		query:      'What is current gas price on Ethereum?',
		workflowId: 'wf_gas_estimator_01',
		params:     {},
	},
	{
		label:      'Wallet Monitor',
		query:      'Monitor wallet activity',
		workflowId: 'wf_wallet_monitor_01',
		params:     { walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
	},
	{
		label:      'NFT Floor Price',
		query:      'Get NFT floor price from Chainlink',
		workflowId: 'wf_nft_floor_01',
		params:     { collection: 'bayc' },
	},
	{
		label:      'Proof of Reserve',
		query:      'Verify WBTC proof of reserve',
		workflowId: 'wf_proof_of_reserve_01',
		params:     { asset: 'WBTC' },
	},
] as const

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowInput {
	name:        string
	fieldType:   string
	description: string
	required:    boolean
}

interface WorkflowMeta {
	workflowId:         string
	description:        string
	pricePerInvocation: string
	inputs:             WorkflowInput[]
	outputs:            { name: string; fieldType: string; description: string }[]
	category:           string
	score?:             number
}

interface LogLine {
	id:   number
	type: AgentEvent['type']
	text: string
	sub?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsdcWei(wei: string) {
	return `$${(Number(wei) / 1_000_000).toFixed(4)}`
}

function truncate(s: string, n = 16) {
	return s.length > n ? s.slice(0, n) + '…' : s
}

// ─── Log line component ───────────────────────────────────────────────────────

function Line({ line }: { line: LogLine }) {
	const colors: Record<string, string> = {
		step:         'text-cyan-400',
		sub:          'text-slate-400',
		payment:      'text-yellow-400',
		balance:      'text-slate-300',
		tx_broadcast: 'text-blue-400',
		tx_confirmed: 'text-green-400',
		retrying:     'text-cyan-400',
		result:       'text-green-400',
		error:        'text-red-400',
	}
	const prefixes: Record<string, string> = {
		step:         '→',
		sub:          '  ↳',
		payment:      '  $',
		balance:      '  ◎',
		tx_broadcast: '  ⬆',
		tx_confirmed: '  ✓',
		retrying:     '  ↺',
		result:       '✅',
		error:        '✗',
	}
	const cls = colors[line.type] ?? 'text-slate-400'
	const pre = prefixes[line.type] ?? ' '

	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.15 }}
			className={`font-mono text-sm ${cls} whitespace-pre-wrap break-all leading-relaxed`}
		>
			<span className="opacity-60 mr-2">{pre}</span>
			{line.text}
		</motion.div>
	)
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentPage() {
	const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

	// Phase: 'idle' | 'search' | 'configure' | 'running' | 'done'
	const [phase,    setPhase]    = useState<'idle' | 'search' | 'configure' | 'running' | 'done'>('idle')
	const [query,    setQuery]    = useState('')
	const [results,  setResults]  = useState<WorkflowMeta[]>([])
	const [selected, setSelected] = useState<WorkflowMeta | null>(null)
	const [formVals, setFormVals] = useState<Record<string, string>>({})
	const [lines,    setLines]    = useState<LogLine[]>([])
	const [result,   setResult]   = useState<AgentEvent & { type: 'result' } | null>(null)
	const [isSearching, setSearching] = useState(false)

	const consoleRef = useRef<HTMLDivElement>(null)
	const lineIdRef  = useRef(0)

	const pushLine = useCallback((type: AgentEvent['type'], text: string) => {
		setLines(prev => [...prev, { id: lineIdRef.current++, type, text }])
	}, [])

	// Auto-scroll console
	useEffect(() => {
		if (consoleRef.current) {
			consoleRef.current.scrollTop = consoleRef.current.scrollHeight
		}
	}, [lines])

	// ── Search ──────────────────────────────────────────────────────────────────
	const doSearch = useCallback(async (q: string) => {
		setSearching(true)
		setPhase('search')
		setResults([])
		try {
			const res = await fetch(`${BACKEND}/api/workflows/search?q=${encodeURIComponent(q)}&limit=4`)
			const data = await res.json() as WorkflowMeta[]
			setResults(data)
		} catch (e) {
			console.error(e)
		}
		setSearching(false)
	}, [BACKEND])

	// ── Pick sample ─────────────────────────────────────────────────────────────
	const pickSample = useCallback((s: typeof SAMPLES[number]) => {
		setQuery(s.query)
		doSearch(s.query)
		// Pre-fill known params
		setFormVals(s.params as Record<string, string>)
	}, [doSearch])

	// ── Select workflow ─────────────────────────────────────────────────────────
	const selectWorkflow = useCallback((wf: WorkflowMeta) => {
		setSelected(wf)
		setPhase('configure')
		// Init form values for required inputs
		const init: Record<string, string> = {}
		wf.inputs.forEach(i => { if (formVals[i.name]) init[i.name] = formVals[i.name] })
		setFormVals(prev => ({ ...init, ...prev }))
	}, [formVals])

	// ── Execute ─────────────────────────────────────────────────────────────────
	const execute = useCallback(async () => {
		if (!selected) return
		setPhase('running')
		setLines([])
		setResult(null)

		pushLine('step', `Starting agent execution...`)

		try {
			const res = await fetch('/api/agent/run', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ workflowId: selected.workflowId, params: formVals }),
			})

			if (!res.body) {
				pushLine('error', 'No response stream')
				setPhase('done')
				return
			}

			const reader  = res.body.getReader()
			const decoder = new TextDecoder()
			let   buf     = ''

			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				buf += decoder.decode(value, { stream: true })
				const parts = buf.split('\n\n')
				buf = parts.pop() ?? ''

				for (const part of parts) {
					const dataLine = part.split('\n').find(l => l.startsWith('data: '))
					if (!dataLine) continue
					try {
						const ev = JSON.parse(dataLine.slice(6)) as AgentEvent

						switch (ev.type) {
							case 'step':
								pushLine('step', ev.message)
								break
							case 'sub':
								pushLine('sub', ev.message)
								break
							case 'payment':
								pushLine('payment', `402 Payment required — ${ev.amount} USDC → ${truncate(ev.payTo, 20)}`)
								break
							case 'balance':
								pushLine('balance', `USDC balance: ${ev.usd}  ${ev.sufficient ? '✓' : '✗ insufficient'}`)
								break
							case 'tx_broadcast':
								pushLine('tx_broadcast', `Broadcasting USDC transfer...  ${truncate(ev.txHash, 22)}`)
								break
							case 'tx_confirmed':
								pushLine('tx_confirmed', `Transfer confirmed: ${truncate(ev.txHash, 22)}`)
								break
							case 'retrying':
								pushLine('retrying', 'Retrying with X-Payment header...')
								break
							case 'result':
								setResult(ev)
								setPhase('done')
								if (ev.success) pushLine('result', 'Execution successful')
								else            pushLine('error', ev.error ?? 'Execution failed')
								break
							case 'error':
								pushLine('error', ev.message)
								break
							case 'done':
								if (phase !== 'done') setPhase('done')
								break
						}
					} catch { /* ignore parse errors */ }
				}
			}
		} catch (e) {
			pushLine('error', e instanceof Error ? e.message : String(e))
			setPhase('done')
		}
	}, [selected, formVals, pushLine, phase])

	const reset = () => {
		setPhase('idle')
		setQuery('')
		setResults([])
		setSelected(null)
		setFormVals({})
		setLines([])
		setResult(null)
	}

	// ─── Render ─────────────────────────────────────────────────────────────────
	return (
		<div className="min-h-screen bg-[#0a0e1a] pt-24 pb-16 px-4">
			<div className="max-w-3xl mx-auto">

				{/* Header */}
				<div className="mb-10 text-center">
					<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#375BD2]/40 bg-[#375BD2]/10 text-[#4a6cf7] text-xs font-mono mb-4">
						<span className="w-1.5 h-1.5 rounded-full bg-[#4a6cf7] animate-pulse" />
						Openclaw · GPT-4o · x402 USDC · Ethereum Sepolia
					</div>
					<h1 className="text-3xl font-bold text-white mb-2">CREHub Agent Console</h1>
					<p className="text-[rgba(255,255,255,0.5)] text-sm max-w-md mx-auto">
						Discover and execute Chainlink CRE workflows with USDC micropayments.
						Works as a terminal agent, web UI, or Openclaw skill.
					</p>
				</div>

				{/* Sample queries */}
				{phase === 'idle' && (
					<motion.div
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						className="mb-6"
					>
						<p className="text-[rgba(255,255,255,0.4)] text-xs font-mono uppercase tracking-widest mb-3">
							Try a sample query
						</p>
						<div className="flex flex-wrap gap-2">
							{SAMPLES.map(s => (
								<button
									key={s.workflowId}
									onClick={() => pickSample(s)}
									className="px-3 py-1.5 rounded-lg bg-[#0f1629] border border-[rgba(255,255,255,0.08)] text-sm text-[rgba(255,255,255,0.7)] hover:border-[#375BD2]/60 hover:text-white hover:bg-[#375BD2]/10 transition-all"
								>
									{s.label}
								</button>
							))}
						</div>
					</motion.div>
				)}

				{/* Search bar */}
				{(phase === 'idle' || phase === 'search') && (
					<form
						onSubmit={e => { e.preventDefault(); if (query.trim()) doSearch(query) }}
						className="flex gap-2 mb-6"
					>
						<input
							type="text"
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Describe what you want to do..."
							className="flex-1 bg-[#0f1629] border border-[rgba(255,255,255,0.1)] rounded-xl px-4 py-3 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#375BD2]/60 transition-colors"
						/>
						<button
							type="submit"
							disabled={isSearching || !query.trim()}
							className="px-5 py-3 bg-[#375BD2] hover:bg-[#4a6cf7] disabled:opacity-50 rounded-xl text-sm font-medium text-white transition-colors"
						>
							{isSearching ? 'Searching…' : 'Search'}
						</button>
					</form>
				)}

				{/* Search results */}
				<AnimatePresence>
					{phase === 'search' && (
						<motion.div
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
							className="space-y-2 mb-6"
						>
							{isSearching && (
								<div className="flex items-center gap-2 text-[rgba(255,255,255,0.4)] text-sm">
									<span className="w-3 h-3 border border-[#375BD2] border-t-transparent rounded-full animate-spin" />
									Searching marketplace…
								</div>
							)}
							{!isSearching && results.length === 0 && (
								<p className="text-[rgba(255,255,255,0.4)] text-sm">No workflows found. Try a different query.</p>
							)}
							{results.map(wf => (
								<motion.button
									key={wf.workflowId}
									initial={{ opacity: 0, x: -8 }}
									animate={{ opacity: 1, x: 0 }}
									onClick={() => selectWorkflow(wf)}
									className="w-full text-left p-4 rounded-xl bg-[#0f1629] border border-[rgba(255,255,255,0.08)] hover:border-[#375BD2]/50 hover:bg-[#375BD2]/5 transition-all group"
								>
									<div className="flex items-start justify-between gap-4">
										<div>
											<div className="flex items-center gap-2 mb-1">
												<span className="font-mono text-xs text-[#4a6cf7]">{wf.workflowId}</span>
												{wf.score !== undefined && (
													<span className="text-xs text-[rgba(255,255,255,0.3)]">
														score: {wf.score.toFixed(2)}
													</span>
												)}
											</div>
											<p className="text-sm text-[rgba(255,255,255,0.8)]">{wf.description}</p>
										</div>
										<div className="shrink-0 text-right">
											<div className="text-yellow-400 text-sm font-medium">{formatUsdcWei(wf.pricePerInvocation)}</div>
											<div className="text-xs text-[rgba(255,255,255,0.3)] mt-0.5">USDC</div>
										</div>
									</div>
									<div className="mt-2 text-right text-xs text-[#4a6cf7] opacity-0 group-hover:opacity-100 transition-opacity">
										Select →
									</div>
								</motion.button>
							))}
						</motion.div>
					)}
				</AnimatePresence>

				{/* Configure step */}
				<AnimatePresence>
					{phase === 'configure' && selected && (
						<motion.div
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
							className="mb-6"
						>
							{/* Selected workflow header */}
							<div className="p-4 rounded-xl bg-[#0f1629] border border-[#375BD2]/30 mb-4">
								<div className="flex items-center justify-between">
									<div>
										<span className="font-mono text-xs text-[#4a6cf7] block mb-1">{selected.workflowId}</span>
										<p className="text-sm text-white">{selected.description}</p>
									</div>
									<div className="text-yellow-400 font-medium">{formatUsdcWei(selected.pricePerInvocation)}</div>
								</div>
							</div>

							{/* Input form */}
							{selected.inputs.length > 0 && (
								<div className="space-y-3 mb-4">
									{selected.inputs.map(inp => (
										<div key={inp.name}>
											<label className="block text-xs text-[rgba(255,255,255,0.5)] mb-1 font-mono">
												{inp.name}
												{inp.required && <span className="text-red-400 ml-1">*</span>}
												<span className="ml-2 text-[rgba(255,255,255,0.3)]">{inp.description}</span>
											</label>
											<input
												type="text"
												value={formVals[inp.name] ?? ''}
												onChange={e => setFormVals(prev => ({ ...prev, [inp.name]: e.target.value }))}
												placeholder={`${inp.fieldType}${inp.required ? '' : ' (optional)'}`}
												className="w-full bg-[#0a0e1a] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[#375BD2]/50 transition-colors"
											/>
										</div>
									))}
								</div>
							)}

							<div className="flex gap-2">
								<button
									onClick={execute}
									className="flex-1 py-3 bg-[#375BD2] hover:bg-[#4a6cf7] rounded-xl text-sm font-semibold text-white transition-colors"
								>
									Execute &amp; Pay {formatUsdcWei(selected.pricePerInvocation)} USDC
								</button>
								<button
									onClick={() => setPhase('search')}
									className="px-4 py-3 bg-[#0f1629] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.2)] rounded-xl text-sm text-[rgba(255,255,255,0.5)] transition-colors"
								>
									Back
								</button>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Agent console */}
				<AnimatePresence>
					{(phase === 'running' || phase === 'done') && (
						<motion.div
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							className="mb-6"
						>
							<div className="rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)]">
								{/* Terminal header bar */}
								<div className="flex items-center gap-2 px-4 py-2.5 bg-[#0d1220] border-b border-[rgba(255,255,255,0.06)]">
									<div className="flex gap-1.5">
										<div className="w-3 h-3 rounded-full bg-red-500/60" />
										<div className="w-3 h-3 rounded-full bg-yellow-500/60" />
										<div className="w-3 h-3 rounded-full bg-green-500/60" />
									</div>
									<span className="font-mono text-xs text-[rgba(255,255,255,0.3)] ml-2">
										agent console  •  {selected?.workflowId}
									</span>
									{phase === 'running' && (
										<span className="ml-auto flex items-center gap-1.5 text-xs text-cyan-400">
											<span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
											running
										</span>
									)}
								</div>

								{/* Log lines */}
								<div
									ref={consoleRef}
									className="bg-[#070b14] p-4 h-56 overflow-y-auto space-y-1"
								>
									{lines.map(line => <Line key={line.id} line={line} />)}
									{phase === 'running' && (
										<div className="font-mono text-sm text-cyan-400/50 animate-pulse">▌</div>
									)}
								</div>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Result card */}
				<AnimatePresence>
					{phase === 'done' && result && (
						<motion.div
							initial={{ opacity: 0, scale: 0.98, y: 8 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							className="mb-6"
						>
							<div className={`p-5 rounded-xl border ${result.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
								<div className="flex items-center gap-2 mb-4">
									<span className="text-lg">{result.success ? '✅' : '❌'}</span>
									<span className="font-semibold text-white">
										{result.success ? 'Execution Successful' : 'Execution Failed'}
									</span>
								</div>

								{result.success && result.output && (
									<div className="space-y-1.5 mb-4">
										{Object.entries(result.output).map(([k, v]) => (
											<div key={k} className="flex items-baseline gap-3 font-mono">
												<span className="text-xs text-[rgba(255,255,255,0.4)] w-28 shrink-0">{k}</span>
												<span className="text-sm text-white">{String(v)}</span>
											</div>
										))}
									</div>
								)}

								{!result.success && result.error && (
									<p className="text-sm text-red-400 mb-4 font-mono">{result.error}</p>
								)}

								<div className="pt-3 border-t border-[rgba(255,255,255,0.06)] space-y-1.5">
									<div className="flex items-baseline gap-3 font-mono">
										<span className="text-xs text-[rgba(255,255,255,0.3)] w-28 shrink-0">paid</span>
										<span className="text-sm text-yellow-400">{result.pricePaid} USDC</span>
									</div>
									{result.settlementTx && (
										<div className="flex items-baseline gap-3 font-mono">
											<span className="text-xs text-[rgba(255,255,255,0.3)] w-28 shrink-0">settlement</span>
											<a
												href={`https://sepolia.etherscan.io/tx/${result.settlementTx}`}
												target="_blank"
												rel="noopener noreferrer"
												className="text-xs text-[#4a6cf7] hover:underline break-all"
											>
												{result.settlementTx}
											</a>
										</div>
									)}
								</div>
							</div>

							<button
								onClick={reset}
								className="w-full mt-3 py-2.5 bg-[#0f1629] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.2)] rounded-xl text-sm text-[rgba(255,255,255,0.6)] hover:text-white transition-all"
							>
								Run another query
							</button>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Compatibility callout */}
				{phase === 'idle' && (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.3 }}
						className="mt-10 p-4 rounded-xl bg-[#0f1629] border border-[rgba(255,255,255,0.06)]"
					>
						<p className="text-xs text-[rgba(255,255,255,0.4)] font-mono uppercase tracking-wider mb-3">Compatible with</p>
						<div className="grid grid-cols-3 gap-2 text-center text-xs">
							{[
								{ name: 'Openclaw', note: 'SKILL.md at /crehub/openclaw' },
								{ name: 'Claude Code', note: 'bun run openclaw/agent.ts' },
								{ name: 'Any AI Agent', note: 'agentskills.io spec' },
							].map(c => (
								<div key={c.name} className="p-3 rounded-lg bg-[#0a0e1a] border border-[rgba(255,255,255,0.05)]">
									<div className="text-white font-medium mb-1">{c.name}</div>
									<div className="text-[rgba(255,255,255,0.3)] text-[10px] font-mono">{c.note}</div>
								</div>
							))}
						</div>
					</motion.div>
				)}
			</div>
		</div>
	)
}

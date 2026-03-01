'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { api } from '@/lib/api'
import type { Execution } from '@/lib/types'
import { shortAddr, formatUSDC, SEPOLIA_EXPLORER } from '@/lib/types'

function TxLink({ hash, label }: { hash: string; label: string }) {
  if (!hash) return <span className="text-white/30">—</span>
  return (
    <a
      href={`${SEPOLIA_EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-cl-blue-l hover:underline break-all"
    >
      {hash}
    </a>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-white/35 uppercase tracking-wide">{label}</span>
      <div className="text-sm text-white/80">{children}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    failure: 'bg-red-500/15 text-red-300 border-red-500/25',
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  }[status] ?? 'bg-white/10 text-white/50 border-white/10'
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${styles}`}>
      <span className={`w-2 h-2 rounded-full ${status === 'success' ? 'bg-emerald-400' : status === 'failure' ? 'bg-red-400' : 'bg-amber-400'}`} />
      {status.toUpperCase()}
    </span>
  )
}

function JsonBlock({ label, json, omitKeys = [] }: { label: string; json: string; omitKeys?: string[] }) {
  if (!json) return null
  let pretty = json
  try {
    const parsed = JSON.parse(json)
    if (omitKeys.length > 0 && typeof parsed === 'object' && parsed !== null) {
      const filtered = Object.fromEntries(Object.entries(parsed).filter(([k]) => !omitKeys.includes(k)))
      pretty = JSON.stringify(filtered, null, 2)
    } else {
      pretty = JSON.stringify(parsed, null, 2)
    }
  } catch {}
  return (
    <div>
      <p className="text-xs text-white/35 uppercase tracking-wide mb-2">{label}</p>
      <pre className="bg-black/30 border border-white/[0.06] rounded-lg p-4 text-xs text-emerald-300 overflow-x-auto whitespace-pre-wrap">
        {pretty}
      </pre>
    </div>
  )
}

/** Extract onChainTxHash from outputsJson if present */
function parseOnChainTxHash(outputsJson: string): string | null {
  if (!outputsJson) return null
  try {
    const parsed = JSON.parse(outputsJson) as Record<string, unknown>
    const hash = parsed?.onChainTxHash
    return typeof hash === 'string' && hash.startsWith('0x') ? hash : null
  } catch {
    return null
  }
}

export default function ExecutionDetailPage({ params }: { params: { executionId: string } }) {
  const { executionId } = params
  const { data: ex, isLoading, error } = useSWR<Execution>(
    ['execution', executionId],
    () => api.getExecution(executionId),
  )

  if (isLoading) {
    return (
      <div className="min-h-screen pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !ex) {
    return (
      <div className="min-h-screen pt-24 pb-20 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/40 mb-4">Execution not found.</p>
          <Link href="/explorer" className="btn-ghost text-sm">← Back to Explorer</Link>
        </div>
      </div>
    )
  }

  const onChainTxHash = ex.status === 'success' ? parseOnChainTxHash(ex.outputsJson) : null

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-xs text-white/35">
          <Link href="/explorer" className="hover:text-white/70 transition">Explorer</Link>
          <span>/</span>
          <span className="text-white/55 font-mono">{executionId.slice(0, 14)}…</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Execution Detail</h1>
            <p className="font-mono text-xs text-white/30 break-all">{executionId}</p>
          </div>
          <StatusBadge status={ex.status} />
        </div>

        {/* Overview card */}
        <div className="card p-6 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Workflow">
            <Link href={`/workflow/${ex.workflowId}`} className="text-cl-blue-l hover:underline">
              {ex.workflowId}
            </Link>
          </Field>
          <Field label="Amount Paid">
            <span className="font-semibold">{formatUSDC(ex.amount)} USDC</span>
            <span className="text-white/30 text-xs ml-1">({ex.amount} wei)</span>
          </Field>
          <Field label="Agent (Payer)">
            <a href={`${SEPOLIA_EXPLORER}/address/${ex.agentAddress}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:text-cl-blue-l transition">
              {ex.agentAddress}
            </a>
          </Field>
          <Field label="Creator">
            <a href={`${SEPOLIA_EXPLORER}/address/${ex.creatorAddress}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:text-cl-blue-l transition">
              {ex.creatorAddress}
            </a>
          </Field>
          <Field label="Triggered">
            {new Date(ex.triggeredAt).toLocaleString()}
          </Field>
          <Field label="Settled">
            {ex.settledAt ? new Date(ex.settledAt).toLocaleString() : <span className="text-white/30">Pending…</span>}
          </Field>
        </div>

        {/* Transactions card */}
        <div className="card p-6 mb-5 space-y-4">
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-2">Transactions</h2>
          <Field label="Payment Tx (USDC Transfer)">
            <TxLink hash={ex.paymentTxHash} label="payment" />
          </Field>
          <Field label="Settlement Tx (on-chain)">
            <TxLink hash={ex.settlementTxHash} label="settlement" />
          </Field>
          {onChainTxHash && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/35 uppercase tracking-wide">CRE Broadcast Tx</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Proof of Execution
                </span>
              </div>
              <div className="text-sm text-white/80">
                <TxLink hash={onChainTxHash} label="cre broadcast" />
              </div>
              <p className="text-xs text-white/25 mt-0.5">
                Result hash written to CREHubExecutor on Sepolia via Chainlink CRE Forwarder
              </p>
            </div>
          )}
        </div>

        {/* I/O card */}
        <div className="card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-2">Workflow I/O</h2>
          <JsonBlock label="Input" json={ex.inputsJson} />
          {ex.status === 'success' && (
            <JsonBlock
              label="Output"
              json={ex.outputsJson}
              omitKeys={onChainTxHash ? ['onChainTxHash'] : []}
            />
          )}
          {ex.status === 'failure' && ex.errorMessage && (
            <div>
              <p className="text-xs text-white/35 uppercase tracking-wide mb-2">Error</p>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-xs text-red-300">
                {ex.errorMessage}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { api } from '@/lib/api'
import type { ExecutionsPage } from '@/lib/types'
import { shortHash, shortAddr, formatUSDC, SEPOLIA_EXPLORER } from '@/lib/types'

function parseOnChainTxHash(outputsJson: string): string | null {
  if (!outputsJson) return null
  try {
    const parsed = JSON.parse(outputsJson) as Record<string, unknown>
    const hash = parsed?.onChainTxHash
    return typeof hash === 'string' && hash.startsWith('0x') ? hash : null
  } catch { return null }
}

const PAGE_SIZE = 20

function StatusBadge({ status }: { status: string }) {
  const styles = {
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    failure: 'bg-red-500/15 text-red-300 border-red-500/25',
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  }[status] ?? 'bg-white/10 text-white/50 border-white/10'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${styles}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'success' ? 'bg-emerald-400' : status === 'failure' ? 'bg-red-400' : 'bg-amber-400'}`} />
      {status}
    </span>
  )
}

export default function ExplorerPage() {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useSWR<ExecutionsPage>(
    ['executions', page],
    () => api.getExecutions({ page, limit: PAGE_SIZE }),
  )

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-10 page-enter">
          <span className="label-section mb-4 inline-flex">On-Chain</span>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Execution Explorer</h1>
          <p className="mt-2 text-sm text-white/45">
            All workflow executions settled via CREHub — payment, simulation, and settlement details.
          </p>
        </div>

        {/* Stats bar */}
        {data && (
          <div className="flex gap-6 mb-8">
            <div className="card px-5 py-3 flex items-center gap-3">
              <span className="text-white/40 text-xs">Total executions</span>
              <span className="text-white font-semibold">{data.total}</span>
            </div>
            <div className="card px-5 py-3 flex items-center gap-3">
              <span className="text-white/40 text-xs">This page</span>
              <span className="text-white font-semibold">{data.items.length}</span>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-white/40 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Execution ID</th>
                  <th className="px-4 py-3 text-left">Workflow</th>
                  <th className="px-4 py-3 text-left">Agent</th>
                  <th className="px-4 py-3 text-left">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Settlement Tx</th>
                  <th className="px-4 py-3 text-left">CRE Broadcast</th>
                  <th className="px-4 py-3 text-left">Time</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/[0.04]">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="skeleton h-4 w-24 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                  : data?.items.length === 0
                  ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-white/30">
                        No executions yet. Trigger a workflow to get started.
                      </td>
                    </tr>
                  )
                  : data?.items.map((ex) => (
                    <tr
                      key={ex.executionId}
                      className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link href={`/explorer/${ex.executionId}`} className="text-cl-blue-l hover:underline">
                          {shortHash(ex.executionId)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/workflow/${ex.workflowId}`} className="text-white/70 hover:text-white text-xs">
                          {ex.workflowId}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-white/50">{shortAddr(ex.agentAddress)}</td>
                      <td className="px-4 py-3 text-xs text-white/70">{formatUSDC(ex.amount)}</td>
                      <td className="px-4 py-3"><StatusBadge status={ex.status} /></td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {ex.settlementTxHash ? (
                          <a
                            href={`${SEPOLIA_EXPLORER}/tx/${ex.settlementTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cl-blue-l hover:underline"
                          >
                            {shortHash(ex.settlementTxHash)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {(() => {
                          const creTx = parseOnChainTxHash(ex.outputsJson)
                          return creTx ? (
                            <a
                              href={`${SEPOLIA_EXPLORER}/tx/${creTx}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                              title={creTx}
                            >
                              <span>⛓</span>
                              {shortHash(creTx)}
                            </a>
                          ) : <span className="text-white/20">—</span>
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/40">
                        {new Date(ex.triggeredAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-ghost text-xs disabled:opacity-30"
              >
                ← Previous
              </button>
              <span className="text-xs text-white/40">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-ghost text-xs disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

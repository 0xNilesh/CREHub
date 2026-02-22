'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { api } from '@/lib/api'
import type { ExecutionsPage } from '@/lib/types'
import { shortHash, shortAddr, formatUSDC, SEPOLIA_EXPLORER } from '@/lib/types'

const PAGE_SIZE = 10

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

function ExecutionTable({ agentAddress }: { agentAddress: string }) {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useSWR<ExecutionsPage>(
    ['executions-agent', agentAddress, page],
    () => api.getExecutions({ agentAddress, page, limit: PAGE_SIZE }),
  )

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  const successCount = data?.items.filter((e) => e.status === 'success').length ?? 0
  const totalUSDC = data?.items.reduce((acc, e) => acc + Number(e.amount), 0) ?? 0

  return (
    <div className="space-y-6">
      {/* Stats */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="card px-5 py-4">
            <p className="text-xs text-white/40 mb-1">Total Executions</p>
            <p className="text-2xl font-bold text-white">{data.total}</p>
          </div>
          <div className="card px-5 py-4">
            <p className="text-xs text-white/40 mb-1">Successful</p>
            <p className="text-2xl font-bold text-emerald-400">{successCount}</p>
          </div>
          <div className="card px-5 py-4 col-span-2 sm:col-span-1">
            <p className="text-xs text-white/40 mb-1">USDC Spent (this page)</p>
            <p className="text-2xl font-bold text-white">{formatUSDC(String(totalUSDC))}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-white/40 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Execution</th>
                <th className="px-4 py-3 text-left">Workflow</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Settlement</th>
                <th className="px-4 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/[0.04]">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="skeleton h-4 w-20 rounded" />
                      </td>
                    ))}
                  </tr>
                ))
                : data?.items.length === 0
                ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-white/30">
                      No executions found for this wallet.
                    </td>
                  </tr>
                )
                : data?.items.map((ex) => (
                  <tr key={ex.executionId} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
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
                    <td className="px-4 py-3 text-xs text-white/70">{formatUSDC(ex.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={ex.status} /></td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {ex.settlementTxHash ? (
                        <a href={`${SEPOLIA_EXPLORER}/tx/${ex.settlementTxHash}`} target="_blank" rel="noopener noreferrer" className="text-cl-blue-l hover:underline">
                          {shortHash(ex.settlementTxHash)}
                        </a>
                      ) : '—'}
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost text-xs disabled:opacity-30">
              ← Previous
            </button>
            <span className="text-xs text-white/40">Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-ghost text-xs disabled:opacity-30">
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount()

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="mb-10 page-enter">
          <span className="label-section mb-4 inline-flex">Account</span>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">My Dashboard</h1>
          <p className="mt-2 text-sm text-white/45">
            All workflow executions triggered by your connected wallet.
          </p>
        </div>

        {!isConnected ? (
          <div className="card p-12 text-center">
            <p className="text-white/50 mb-6">Connect your wallet to view your execution history.</p>
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-8 p-4 card">
              <div className="w-8 h-8 rounded-full bg-cl-blue/20 flex items-center justify-center text-cl-blue-l text-xs font-bold">
                {address?.slice(2, 4).toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-white/40">Connected wallet</p>
                <p className="font-mono text-sm text-white">{address}</p>
              </div>
            </div>
            <ExecutionTable agentAddress={address!} />
          </>
        )}
      </div>
    </div>
  )
}

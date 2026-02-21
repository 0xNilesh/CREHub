'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { api } from '@/lib/api'
import { CATEGORY_COLORS, CATEGORY_LABELS, formatPrice, shortAddr } from '@/lib/types'
import type { Workflow } from '@/lib/types'
import { WorkflowDetailSkeleton } from '@/components/ui/Skeleton'
import IOFieldList from '@/components/workflow/IOFieldList'
import TriggerPanel from '@/components/workflow/TriggerPanel'

interface Props { params: { id: string } }

export default function WorkflowDetailPage({ params }: Props) {
  const { id } = params
  const { data: wf, isLoading, error } = useSWR<Workflow>(
    id ? `workflow-${id}` : null,
    () => api.getWorkflow(id),
  )

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Breadcrumb */}
        <div className="mb-8 flex items-center gap-2 text-xs text-white/35 page-enter">
          <Link href="/browse" className="hover:text-white/60 transition">Browse</Link>
          <span>/</span>
          <span className="text-white/55 truncate max-w-xs">{id}</span>
        </div>

        {isLoading && <WorkflowDetailSkeleton />}

        {error && (
          <div className="card p-8 text-center">
            <p className="text-white/40 text-sm">Workflow not found.</p>
            <Link href="/browse" className="btn-ghost mt-4 inline-flex text-xs">← Back to browse</Link>
          </div>
        )}

        {wf && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* ── Left: metadata ───────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="lg:col-span-2 space-y-7"
            >
              {/* Category + title */}
              <div>
                <span className={`badge border text-xs mb-3 inline-flex ${CATEGORY_COLORS[wf.category] ?? ''}`}>
                  {CATEGORY_LABELS[wf.category]}
                </span>
                <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{wf.description}</h1>
                <p className="mt-3 text-sm text-white/50 leading-relaxed">{wf.detailedDescription}</p>
              </div>

              {/* Stats bar */}
              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Price', value: formatPrice(wf.pricePerInvocation) + ' USDC' },
                  { label: 'Inputs',   value: `${wf.inputs.length} field${wf.inputs.length !== 1 ? 's' : ''}` },
                  { label: 'Outputs',  value: `${wf.outputs.length} field${wf.outputs.length !== 1 ? 's' : ''}` },
                  { label: 'Network',  value: 'Eth Sepolia' },
                ].map(({ label, value }) => (
                  <div key={label} className="card px-4 py-3 flex-1 min-w-[100px]">
                    <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">{label}</p>
                    <p className="text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>

              {/* Creator */}
              <div className="flex items-center gap-2.5">
                <div className="size-6 rounded-full bg-gradient-to-br from-cl-blue to-cl-blue-xl flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-white/30 uppercase tracking-widest">Creator</p>
                  <p className="text-xs font-mono text-white/60">{wf.creatorAddress}</p>
                </div>
              </div>

              {/* Workflow ID */}
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-white/25 uppercase tracking-widest mb-1">Workflow ID</p>
                  <code className="text-sm font-mono text-white/70">{wf.workflowId}</code>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(wf.workflowId)}
                  className="text-[10px] text-white/25 hover:text-white/60 transition px-2 py-1 rounded border border-white/[0.07] hover:border-white/20"
                >
                  Copy
                </button>
              </div>

              {/* Inputs */}
              <section>
                <h2 className="text-sm font-semibold text-white/70 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="text-cl-blue">→</span> Inputs
                </h2>
                <IOFieldList fields={wf.inputs} direction="input" />
              </section>

              {/* Outputs */}
              <section>
                <h2 className="text-sm font-semibold text-white/70 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="text-emerald-400">←</span> Outputs
                </h2>
                <IOFieldList fields={wf.outputs} direction="output" />
              </section>

              {/* Settlement info */}
              <section>
                <h2 className="text-sm font-semibold text-white/70 uppercase tracking-widest mb-3">Fee Split</h2>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
                  <div className="grid grid-cols-2 divide-x divide-white/[0.07]">
                    <div className="p-4 text-center">
                      <p className="text-2xl font-bold text-emerald-400">90%</p>
                      <p className="text-xs text-white/40 mt-1">To creator on success</p>
                    </div>
                    <div className="p-4 text-center">
                      <p className="text-2xl font-bold text-amber-400">99%</p>
                      <p className="text-xs text-white/40 mt-1">Refunded on failure</p>
                    </div>
                  </div>
                  <div className="border-t border-white/[0.07] px-4 py-2.5 text-xs text-white/30 text-center">
                    Settled via SettlementVault.sol on Ethereum Sepolia
                  </div>
                </div>
              </section>
            </motion.div>

            {/* ── Right: trigger panel ──────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
              className="lg:col-span-1"
            >
              <div className="sticky top-24">
                <TriggerPanel workflow={wf} />

                {/* Quick-copy agent snippet */}
                <details className="mt-4 group">
                  <summary className="text-xs text-white/30 hover:text-white/55 transition cursor-pointer flex items-center gap-1.5 select-none">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                    Agent trigger snippet
                  </summary>
                  <pre className="mt-2 text-[10px] font-mono text-white/40 leading-relaxed rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 overflow-auto">
{`POST /api/trigger/${wf.workflowId}
X-Payment: <usdc_tx_hash>
Content-Type: application/json

${JSON.stringify(
  Object.fromEntries(wf.inputs.map(f => [f.name, `<${f.fieldType}>`])),
  null, 2
)}`}
                  </pre>
                </details>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  )
}

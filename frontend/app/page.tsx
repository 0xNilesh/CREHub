'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { api } from '@/lib/api'
import WorkflowCard from '@/components/ui/WorkflowCard'
import { WorkflowCardSkeleton } from '@/components/ui/Skeleton'
import type { Workflow } from '@/lib/types'

// ─── Animated network nodes background ───────────────────────────────────────
function NetworkBg() {
  const nodes = [
    { x: 20, y: 30, size: 4, delay: 0 },
    { x: 75, y: 20, size: 3, delay: 1.2 },
    { x: 85, y: 65, size: 5, delay: 0.6 },
    { x: 10, y: 70, size: 3, delay: 1.8 },
    { x: 50, y: 80, size: 4, delay: 0.9 },
    { x: 60, y: 40, size: 3, delay: 2.1 },
  ]
  const lines = [
    [0, 1], [1, 2], [2, 4], [3, 4], [0, 3], [1, 5], [5, 2],
  ]

  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#375BD2" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#375BD2" stopOpacity="0" />
        </radialGradient>
      </defs>
      {lines.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a].x} y1={nodes[a].y}
          x2={nodes[b].x} y2={nodes[b].y}
          stroke="rgba(55,91,210,0.15)" strokeWidth="0.3" strokeLinecap="round"
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={n.size * 2.5} fill="url(#nodeGlow)" opacity="0.4">
            <animate attributeName="opacity" values="0.2;0.5;0.2" dur={`${3 + n.delay}s`} repeatCount="indefinite" />
          </circle>
          <circle cx={n.x} cy={n.y} r={n.size * 0.8} fill="#375BD2" opacity="0.7">
            <animate attributeName="r" values={`${n.size * 0.7};${n.size};${n.size * 0.7}`} dur={`${3 + n.delay}s`} repeatCount="indefinite" />
          </circle>
        </g>
      ))}
    </svg>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ value, label, icon }: { value: string; label: string; icon: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5 text-center"
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-white/40 mt-1">{label}</div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { data: workflows, isLoading } = useSWR<Workflow[]>('workflows', api.listWorkflows)

  const featured = workflows?.filter((w) => w.active).slice(0, 3) ?? []

  return (
    <div className="overflow-hidden">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center pt-24 pb-16">
        {/* Background layers */}
        <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-40 pointer-events-none" />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="orb size-[500px] bg-cl-blue left-1/4 -top-32" />
          <div className="orb size-[400px] bg-purple-500 right-1/4 top-1/4 opacity-10" />
        </div>

        {/* Network bg (top right quadrant) */}
        <div className="absolute right-0 top-0 w-1/2 h-full opacity-30 pointer-events-none">
          <NetworkBg />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="label-section mb-6 inline-flex">
              ◈ Chainlink CRE · x402 Micropayments
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]"
          >
            The Marketplace for{' '}
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-cl-blue via-cl-blue-l to-cl-blue-xl bg-clip-text text-transparent">
                Chainlink CRE
              </span>
            </span>{' '}
            Workflows
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-6 max-w-2xl mx-auto text-base sm:text-lg text-white/55 leading-relaxed"
          >
            AI agents discover, pay, and consume verifiable on-chain orchestration capabilities.
            Pay per trigger with USDC micropayments — no subscriptions, no lock-in.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/browse" className="btn-primary px-7 py-3 text-base">
              Browse Workflows →
            </Link>
            <Link href="/list" className="btn-ghost px-7 py-3 text-base">
              List Your Workflow
            </Link>
          </motion.div>

          {/* Flow diagram */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-14 flex items-center justify-center gap-3 flex-wrap text-xs text-white/35"
          >
            {['AI Agent', '→', 'Discover', '→', 'x402 Pay USDC', '→', 'CRE Workflow', '→', 'Verified Output'].map((s, i) => (
              <span
                key={i}
                className={s === '→' ? 'text-cl-blue/40' : 'px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.07]'}
              >
                {s}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10">
        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
          <StatCard value={isLoading ? '…' : String(workflows?.length ?? 0)} label="Workflows" icon="◈" />
          <StatCard value="$0.01" label="Min Price" icon="◎" />
          <StatCard value="Sepolia" label="Network" icon="◉" />
        </div>
      </section>

      {/* ── Featured ──────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-24 mb-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <span className="label-section mb-3 inline-flex">Featured</span>
            <h2 className="text-2xl font-bold text-white">Trending Workflows</h2>
          </div>
          <Link href="/browse" className="btn-ghost text-sm">
            View all →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => <WorkflowCardSkeleton key={i} />)
            : featured.map((wf, i) => <WorkflowCard key={wf.workflowId} workflow={wf} index={i} />)
          }
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="mt-24 py-20 border-t border-white/[0.06] bg-cl-navy-l">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="label-section mb-4 inline-flex">How it works</span>
            <h2 className="text-3xl font-bold text-white">Pay-per-trigger, verifiable execution</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-8 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-cl-blue/0 via-cl-blue/30 to-cl-blue/0" />

            {[
              { step: '01', title: 'Discover', desc: 'AI agent searches semantic index for the right workflow.', icon: '◎' },
              { step: '02', title: 'Request', desc: 'POST /trigger → gateway returns HTTP 402 with USDC details.', icon: '◈' },
              { step: '03', title: 'Pay', desc: 'Agent transfers USDC on Ethereum Sepolia. Escrow created.', icon: '◉' },
              { step: '04', title: 'Execute', desc: 'CRE workflow runs. 90% to creator, 10% to protocol.', icon: '◈' },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="card p-5 relative z-10 text-center"
              >
                <div className="size-8 rounded-full bg-cl-blue/15 border border-cl-blue/30 flex items-center justify-center text-xs font-mono text-cl-blue-l mx-auto mb-3">
                  {item.step}
                </div>
                <div className="text-xl mb-2">{item.icon}</div>
                <h3 className="text-sm font-semibold text-white mb-1.5">{item.title}</h3>
                <p className="text-xs text-white/40 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

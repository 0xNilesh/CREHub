'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import type { Workflow } from '@/lib/types'
import { CATEGORY_COLORS, CATEGORY_LABELS, formatPrice, shortAddr } from '@/lib/types'

interface Props {
  workflow: Workflow
  score?: number
  index?: number
}

const CATEGORY_ICONS: Record<string, string> = {
  defi:       '◈',
  monitoring: '◉',
  data:       '◎',
  compute:    '◈',
}

export default function WorkflowCard({ workflow, score, index = 0 }: Props) {
  const { workflowId, description, category, pricePerInvocation, creatorAddress, inputs, outputs } = workflow

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <Link href={`/workflow/${workflowId}`} className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-cl-blue rounded-xl">
        <article className="card p-5 h-full flex flex-col gap-4 relative overflow-hidden">
          {/* Shine overlay */}
          <div className="absolute inset-0 bg-card-shine opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          {/* Top row: id + category badge */}
          <div className="flex items-start justify-between gap-2">
            <code className="text-xs font-mono text-white/40 truncate">{workflowId}</code>
            <span className={`badge border text-[10px] shrink-0 ${CATEGORY_COLORS[category] ?? ''}`}>
              <span>{CATEGORY_ICONS[category]}</span>
              {CATEGORY_LABELS[category]}
            </span>
          </div>

          {/* Description */}
          <p className="text-sm text-white/80 leading-relaxed line-clamp-2 flex-1">
            {description}
          </p>

          {/* Price + I/O summary */}
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-cl-blue/30 bg-cl-blue/10 px-3 py-1.5">
              <span className="text-sm font-semibold text-cl-blue-xl">{formatPrice(pricePerInvocation)}</span>
              <span className="text-[10px] text-white/30 ml-1">/ call</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/35">
              <span>{inputs.length} in</span>
              <span className="text-white/15">·</span>
              <span>{outputs.length} out</span>
            </div>
            {score !== undefined && (
              <div className="ml-auto text-[10px] text-white/30 font-mono">
                {(score * 100).toFixed(0)}% match
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="size-3.5 rounded-full bg-gradient-to-br from-cl-blue to-cl-blue-xl" />
              <span className="text-[11px] text-white/35 font-mono">{shortAddr(creatorAddress)}</span>
            </div>
            <span className="text-[11px] text-cl-blue-l font-medium group-hover:text-cl-blue-xl transition flex items-center gap-0.5">
              Trigger <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </div>
        </article>
      </Link>
    </motion.div>
  )
}

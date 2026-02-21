import { readFileSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import MarkdownPage from '@/components/openclaw/MarkdownPage'

const SKILL_FILES = [
  { slug: [],                              label: 'SKILL.md',                   file: 'SKILL.md',                          description: 'Openclaw skill entry point' },
  { slug: ['references', 'api'],           label: 'references/api.md',          file: 'references/api.md',                 description: 'Full API surface — endpoints, request/response shapes' },
  { slug: ['references', 'payment-flow'],  label: 'references/payment-flow.md', file: 'references/payment-flow.md',        description: 'x402 USDC payment flow — step by step' },
  { slug: ['references', 'workflow-schema'], label: 'references/workflow-schema.md', file: 'references/workflow-schema.md', description: 'Workflow data types, price format, field definitions' },
  { slug: ['examples', 'agent-demo'],      label: 'examples/agent-demo.md',     file: 'examples/agent-demo.md',            description: 'End-to-end Openclaw agent session walkthrough' },
]

function resolveFile(file: string) {
  return join(process.cwd(), 'public', 'crehub', 'openclaw', file)
}

export const metadata = {
  title: 'CREHub — Openclaw Agent Skills',
  description: 'Discover, pay, and execute Chainlink CRE workflows as Openclaw agent skills via x402 USDC micropayments.',
}

export default function OpenclawIndexPage() {
  const content = readFileSync(resolveFile('SKILL.md'), 'utf-8')

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-10 page-enter">
          <span className="label-section mb-4 inline-flex">Openclaw Skills</span>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">CREHub Agent Skill</h1>
          <p className="mt-2 text-sm text-white/45 max-w-2xl">
            Openclaw-compatible SKILL.md — enable any AI agent to discover and trigger
            Chainlink CRE workflows with USDC micropayments on Ethereum Sepolia.
          </p>
        </div>

        {/* Skill file index */}
        <div className="mb-12 rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.07] flex items-center gap-2">
            <span className="size-2 rounded-full bg-cl-blue animate-pulse" />
            <span className="text-xs text-white/40 font-mono">crehub-marketplace skill — discoverable files</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {SKILL_FILES.map(({ slug, label, file, description }) => {
              const href = slug.length === 0 ? '/crehub/openclaw' : `/crehub/openclaw/${slug.join('/')}`
              const rawHref = `/crehub/openclaw/${file}`
              return (
                <div key={file} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/[0.03] transition group">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-cl-blue/60 text-xs font-mono mt-0.5 shrink-0">MD</span>
                    <div className="min-w-0">
                      <Link href={href} className="text-sm font-mono text-white/80 hover:text-white transition truncate block">
                        {label}
                      </Link>
                      <p className="text-xs text-white/35 mt-0.5">{description}</p>
                    </div>
                  </div>
                  <a
                    href={rawHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[10px] text-white/25 hover:text-white/60 border border-white/[0.07] hover:border-white/20 rounded px-2 py-1 transition font-mono"
                  >
                    raw ↗
                  </a>
                </div>
              )
            })}
          </div>
        </div>

        {/* Rendered SKILL.md */}
        <MarkdownPage content={content} />
      </div>
    </div>
  )
}

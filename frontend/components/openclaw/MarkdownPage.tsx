'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

// ── Frontmatter parser ────────────────────────────────────────────────────────

interface Frontmatter { [key: string]: string }

function parseFrontmatter(raw: string): { frontmatter: Frontmatter | null; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/m)
  if (!match) return { frontmatter: null, body: raw }

  const fm: Frontmatter = {}
  let currentKey = ''
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (kv) {
      currentKey = kv[1]
      fm[currentKey] = kv[2].replace(/^["'>]|["']$/g, '').trim()
    } else if (currentKey && line.match(/^\s+\S/)) {
      // continuation line (block scalar like `>`)
      fm[currentKey] = (fm[currentKey] + ' ' + line.trim()).trim()
    }
  }
  return { frontmatter: fm, body: match[2] }
}

// ── Frontmatter card ──────────────────────────────────────────────────────────

const FM_LABELS: Record<string, string> = {
  name: 'Skill',
  version: 'Version',
  license: 'License',
  compatibility: 'Compatibility',
  'allowed-tools': 'Allowed Tools',
}

function FrontmatterCard({ fm }: { fm: Frontmatter }) {
  const visible = Object.entries(FM_LABELS).filter(([k]) => fm[k])
  if (visible.length === 0) return null
  return (
    <div className="mb-8 rounded-xl border border-cl-blue/20 bg-cl-blue/[0.05] divide-y divide-white/[0.06] overflow-hidden">
      <div className="px-5 py-2.5 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-cl-blue" />
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">skill manifest</span>
      </div>
      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
        {visible.map(([key, label]) => (
          <div key={key} className="px-5 py-3">
            <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">{label}</p>
            <p className="text-xs font-mono text-white/70 break-all">{fm[key]}</p>
          </div>
        ))}
      </div>
      {fm.description && (
        <div className="px-5 py-3">
          <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Description</p>
          <p className="text-xs text-white/60 leading-relaxed">{fm.description}</p>
        </div>
      )}
    </div>
  )
}

// ── Markdown components ───────────────────────────────────────────────────────

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl sm:text-3xl font-bold text-white mt-2 mb-4 leading-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-white mt-8 mb-3 pb-2 border-b border-white/[0.08]">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-white/90 mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-sm text-white/60 leading-relaxed mb-4">{children}</p>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-cl-blue-l hover:text-white underline underline-offset-2 transition">
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    // Inline code (no language class)
    if (!className) {
      return (
        <code className="font-mono text-[0.82em] bg-white/[0.06] text-cl-blue-l rounded px-1.5 py-0.5">
          {children}
        </code>
      )
    }
    // Block code inside <pre> — render as plain code so <pre> styles it
    return <code className="text-white/70">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="rounded-xl border border-white/[0.08] bg-[#0d1117] text-white/70 text-xs font-mono leading-relaxed p-4 overflow-auto mb-5">
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul className="space-y-1.5 mb-4 pl-0 list-none">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="space-y-1.5 mb-4 pl-4 list-decimal list-inside text-sm text-white/60">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm text-white/60 flex gap-2 leading-relaxed">
      <span className="text-cl-blue/60 shrink-0 mt-1">›</span>
      <span>{children}</span>
    </li>
  ),
  table: ({ children }) => (
    <div className="overflow-auto mb-5 rounded-xl border border-white/[0.08]">
      <table className="w-full text-xs text-white/60">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-white/[0.04] text-white/40 uppercase tracking-wider text-[10px]">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2.5 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2.5 border-t border-white/[0.06] font-mono">{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-cl-blue/50 pl-4 my-4 text-sm text-white/45 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-white/[0.08] my-8" />,
  strong: ({ children }) => <strong className="font-semibold text-white/85">{children}</strong>,
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function MarkdownPage({ content }: { content: string }) {
  const { frontmatter, body } = parseFrontmatter(content)

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-8 sm:px-10">
      {frontmatter && <FrontmatterCard fm={frontmatter} />}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  )
}

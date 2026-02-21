import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import MarkdownPage from '@/components/openclaw/MarkdownPage'

interface Props { params: { slug: string[] } }

// Map slug segments → filename (strips .md extension from last segment if present)
function resolveMarkdownFile(slug: string[]): string | null {
  const normalized = slug.map((s) => s.replace(/\.md$/, ''))
  const candidates = [
    join(process.cwd(), 'public', 'crehub', 'openclaw', ...normalized) + '.md',
    join(process.cwd(), 'public', 'crehub', 'openclaw', ...slug),
  ]
  return candidates.find(existsSync) ?? null
}

export async function generateStaticParams() {
  return [
    { slug: ['references', 'api'] },
    { slug: ['references', 'payment-flow'] },
    { slug: ['references', 'workflow-schema'] },
    { slug: ['examples', 'agent-demo'] },
  ]
}

export function generateMetadata({ params }: Props) {
  const label = params.slug.at(-1)?.replace(/-/g, ' ').replace(/\.md$/, '') ?? 'Openclaw'
  return { title: `CREHub — ${label}` }
}

export default function OpenclawDocPage({ params }: Props) {
  const filePath = resolveMarkdownFile(params.slug)
  if (!filePath) notFound()

  const content = readFileSync(filePath, 'utf-8')
  const breadcrumb = ['openclaw', ...params.slug.map((s) => s.replace(/\.md$/, ''))]

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Breadcrumb */}
        <div className="mb-8 flex items-center gap-1.5 text-xs text-white/35 flex-wrap page-enter">
          <Link href="/crehub/openclaw" className="hover:text-white/60 transition">Agent Skills</Link>
          {breadcrumb.slice(1).map((seg, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span>/</span>
              <span className="text-white/50 font-mono">{seg}</span>
            </span>
          ))}
          <a
            href={`/crehub/openclaw/${params.slug.join('/')}.md`.replace(/\.md\.md$/, '.md')}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[10px] border border-white/[0.07] hover:border-white/20 text-white/25 hover:text-white/60 rounded px-2 py-0.5 transition font-mono"
          >
            raw ↗
          </a>
        </div>

        <MarkdownPage content={content} />
      </div>
    </div>
  )
}

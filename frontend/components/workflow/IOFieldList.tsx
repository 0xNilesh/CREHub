import type { WorkflowIOField } from '@/lib/types'

const TYPE_BADGE: Record<string, string> = {
  string:  'text-sky-300 bg-sky-500/10 border-sky-500/20',
  number:  'text-amber-300 bg-amber-500/10 border-amber-500/20',
  boolean: 'text-pink-300 bg-pink-500/10 border-pink-500/20',
  address: 'text-purple-300 bg-purple-500/10 border-purple-500/20',
}

interface Props {
  fields: WorkflowIOField[]
  direction: 'input' | 'output'
}

export default function IOFieldList({ fields, direction }: Props) {
  if (fields.length === 0) return <p className="text-sm text-white/30 italic">None defined.</p>

  return (
    <ul className="space-y-2">
      {fields.map((f) => (
        <li key={f.name} className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
          {/* Arrow */}
          <span className="mt-0.5 text-white/20 text-xs font-mono shrink-0">
            {direction === 'input' ? '→' : '←'}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-sm font-mono text-white/85">{f.name}</code>
              <span className={`badge border text-[10px] ${TYPE_BADGE[f.fieldType] ?? ''}`}>
                {f.fieldType}
              </span>
              {f.required && (
                <span className="text-[10px] text-red-400/70">required</span>
              )}
            </div>
            {f.description && (
              <p className="text-xs text-white/40 mt-0.5">{f.description}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

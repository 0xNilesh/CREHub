'use client'

import { useRef } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  loading?: boolean
  placeholder?: string
}

export default function SearchBar({ value, onChange, loading, placeholder = 'Search workflows…' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="relative group">
      {/* Glow ring on focus */}
      <div className="absolute -inset-px rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"
           style={{ background: 'linear-gradient(135deg,rgba(55,91,210,0.5),rgba(74,108,247,0.3))', filter: 'blur(1px)' }} />

      <div className="relative flex items-center rounded-xl border border-white/[0.1] bg-white/[0.04] backdrop-blur-sm transition-all duration-200 focus-within:border-cl-blue/50 focus-within:bg-white/[0.06]">
        {/* Search icon */}
        <div className="pl-4 pr-2 text-white/30 group-focus-within:text-cl-blue-l transition-colors shrink-0">
          <svg width="17" height="17" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" />
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent py-3.5 pr-4 text-sm text-white placeholder:text-white/30 outline-none"
        />

        {/* Spinner / clear */}
        <div className="pr-3 shrink-0">
          {loading ? (
            <svg className="animate-spin text-cl-blue-l" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
            </svg>
          ) : value ? (
            <button
              onClick={() => { onChange(''); inputRef.current?.focus() }}
              className="text-white/30 hover:text-white/70 transition"
              aria-label="Clear search"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

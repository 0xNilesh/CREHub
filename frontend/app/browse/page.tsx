'use client'

import { useState, useCallback } from 'react'
import { useDebounce } from 'use-debounce'
import useSWR from 'swr'
import { motion, AnimatePresence } from 'framer-motion'
import SearchBar from '@/components/ui/SearchBar'
import WorkflowCard from '@/components/ui/WorkflowCard'
import { WorkflowCardSkeleton } from '@/components/ui/Skeleton'
import { api } from '@/lib/api'
import type { Workflow, SearchResult, Category } from '@/lib/types'
import { CATEGORY_LABELS } from '@/lib/types'

const CATEGORIES: Category[] = ['all', 'defi', 'monitoring', 'data', 'compute', 'ai']

export default function BrowsePage() {
  const [query,    setQuery]    = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [debouncedQ] = useDebounce(query, 350)

  const isSearch = debouncedQ.trim().length > 0

  // All listings (no query)
  const { data: allWorkflows, isLoading: loadingAll } =
    useSWR<Workflow[]>(!isSearch ? 'all-workflows' : null, api.listWorkflows)

  // Search results
  const { data: searchResults, isLoading: loadingSearch } =
    useSWR<SearchResult[]>(
      isSearch ? ['search', debouncedQ] : null,
      () => api.searchWorkflows(debouncedQ, 20),
    )

  const loading = isSearch ? loadingSearch : loadingAll

  // Apply category filter to non-search results
  const items: (Workflow | SearchResult)[] = isSearch
    ? (searchResults ?? [])
    : (allWorkflows ?? []).filter((w) => category === 'all' || w.category === category)

  const handleQueryChange = useCallback((v: string) => {
    setQuery(v)
    if (v.trim()) setCategory('all')
  }, [])

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-10 page-enter">
          <span className="label-section mb-4 inline-flex">Marketplace</span>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Browse Workflows</h1>
          <p className="mt-2 text-sm text-white/45 max-w-xl">
            Discover Chainlink CRE workflows. Pay per execution with USDC micropayments.
          </p>
        </div>

        {/* ── Search + Filters ─────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="flex-1">
            <SearchBar
              value={query}
              onChange={handleQueryChange}
              loading={loadingSearch}
              placeholder="Search by capability, e.g. 'health factor', 'price feed'…"
            />
          </div>
        </div>

        {/* Category pills */}
        <AnimatePresence>
          {!isSearch && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 flex-wrap mb-8 overflow-hidden"
            >
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                    category === cat
                      ? 'bg-cl-blue/20 border-cl-blue/50 text-white shadow-glow-sm'
                      : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Results info ──────────────────────────────────────────────────── */}
        {!loading && (
          <div className="mb-5 text-xs text-white/35 flex items-center gap-2">
            {isSearch ? (
              <>
                <span>{items.length} result{items.length !== 1 ? 's' : ''} for</span>
                <span className="text-white/55 italic">"{debouncedQ}"</span>
              </>
            ) : (
              <span>
                {items.length} workflow{items.length !== 1 ? 's' : ''}
                {category !== 'all' ? ` · ${CATEGORY_LABELS[category]}` : ''}
              </span>
            )}
          </div>
        )}

        {/* ── Grid ──────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 auto-rows-fr">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <WorkflowCardSkeleton key={i} />)
            : items.length === 0
            ? (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                <div className="text-4xl mb-4 opacity-20">◎</div>
                <p className="text-white/40 text-sm">
                  {isSearch ? 'No workflows match your query.' : 'No workflows in this category yet.'}
                </p>
                {isSearch && (
                  <button onClick={() => setQuery('')} className="mt-3 btn-ghost text-xs">
                    Clear search
                  </button>
                )}
              </div>
            )
            : items.map((wf, i) => (
              <WorkflowCard
                key={wf.workflowId}
                workflow={wf}
                score={'score' in wf ? wf.score : undefined}
                index={i}
              />
            ))
          }
        </div>
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useState, useEffect } from 'react'

const NAV_LINKS = [
  { href: '/browse',          label: 'Browse' },
  { href: '/explorer',        label: 'Explorer' },
  { href: '/dashboard',       label: 'Dashboard' },
  { href: '/list',            label: 'List Workflow' },
  { href: '/crehub/openclaw', label: 'Agent Skills' },
]

// ── Logo mark: abstract interconnected nodes (no brand copying) ───────────────
function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <circle cx="14" cy="5"  r="3" fill="#375BD2" />
      <circle cx="5"  cy="21" r="3" fill="#4a6cf7" />
      <circle cx="23" cy="21" r="3" fill="#7898ff" />
      <line x1="14" y1="5"  x2="5"  y2="21" stroke="url(#g)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14" y1="5"  x2="23" y2="21" stroke="url(#g)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5"  y1="21" x2="23" y2="21" stroke="url(#g)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="14" r="2" fill="rgba(55,91,210,0.6)" />
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#375BD2" />
          <stop offset="100%" stopColor="#7898ff" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function Navbar() {
  const pathname   = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [open,     setOpen]     = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-white/[0.08] bg-cl-navy/80 backdrop-blur-xl shadow-[0_1px_0_rgba(255,255,255,0.06)]'
          : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="CREHub home">
          <div className="transition-transform duration-300 group-hover:scale-110">
            <LogoMark />
          </div>
          <span className="text-base font-bold tracking-tight">
            <span className="text-white">CRE</span>
            <span className="text-cl-blue-l">Hub</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`relative px-4 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  active
                    ? 'text-white bg-cl-blue/15'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {label}
                {active && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-cl-blue-l" />
                )}
              </Link>
            )
          })}
        </div>

        {/* Connect button */}
        <div className="hidden md:flex items-center gap-3">
          <ConnectButton
            chainStatus="none"
            showBalance={false}
            accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
          />
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/[0.06] transition"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            {open
              ? <path fillRule="evenodd" clipRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              : <path fillRule="evenodd" clipRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
            }
          </svg>
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/[0.08] bg-cl-navy/95 backdrop-blur-xl px-4 pb-4 pt-2 space-y-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 rounded-lg text-sm font-medium transition ${
                pathname.startsWith(href)
                  ? 'text-white bg-cl-blue/15'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              {label}
            </Link>
          ))}
          <div className="pt-2">
            <ConnectButton chainStatus="none" showBalance={false} />
          </div>
        </div>
      )}
    </header>
  )
}

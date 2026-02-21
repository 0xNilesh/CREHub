import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-cl-navy mt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold">
                <span className="text-white">CRE</span>
                <span className="text-cl-blue-l">Hub</span>
              </span>
            </div>
            <p className="text-xs text-white/40 leading-relaxed max-w-xs">
              Decentralized marketplace for Chainlink CRE workflows. Pay per trigger with USDC micropayments on Ethereum Sepolia.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">Marketplace</p>
            <ul className="space-y-2">
              {[
                { href: '/browse', label: 'Browse Workflows' },
                { href: '/list',   label: 'List Your Workflow' },
              ].map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-white/50 hover:text-white transition">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">Network</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
                <span className="text-xs text-white/50">Ethereum Sepolia</span>
              </div>
              <p className="text-xs text-white/30 font-mono">
                USDC: 0x1c7D…7238
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-white/25">
            © {new Date().getFullYear()} CREHub. Built for the Chainlink hackathon.
          </p>
          <p className="text-xs text-white/20">
            Powered by Chainlink CRE · x402 micropayments · Ethereum Sepolia
          </p>
        </div>
      </div>
    </footer>
  )
}

import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import './globals.css'
import Navbar from '@/components/ui/Navbar'
import Footer from '@/components/ui/Footer'

const Providers = dynamic(() => import('@/components/providers/Providers'), { ssr: false })

export const metadata: Metadata = {
  title: 'CREHub — Chainlink CRE Workflow Marketplace',
  description:
    'Discover, pay, and consume verifiable Chainlink CRE workflows as premium AI agent skills. Pay per trigger with USDC micropayments.',
  keywords: ['Chainlink', 'CRE', 'AI agents', 'x402', 'USDC', 'micropayments', 'workflows'],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col bg-cl-navy text-white antialiased">
        <Providers>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}

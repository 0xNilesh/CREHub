import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const staticPages = [
    { url: `${BASE}/`,            priority: 1.0 },
    { url: `${BASE}/browse`,      priority: 0.9 },
    { url: `${BASE}/list`,        priority: 0.7 },
  ]

  const openclawPages = [
    { url: `${BASE}/crehub/openclaw`,                              priority: 0.9 },
    { url: `${BASE}/crehub/openclaw/references/api`,               priority: 0.8 },
    { url: `${BASE}/crehub/openclaw/references/payment-flow`,      priority: 0.8 },
    { url: `${BASE}/crehub/openclaw/references/workflow-schema`,   priority: 0.8 },
    { url: `${BASE}/crehub/openclaw/examples/agent-demo`,          priority: 0.7 },
  ]

  // Raw markdown files (for Openclaw discovery)
  const rawMarkdown = [
    { url: `${BASE}/crehub/openclaw/SKILL.md`,                            priority: 1.0 },
    { url: `${BASE}/crehub/openclaw/references/api.md`,                   priority: 0.8 },
    { url: `${BASE}/crehub/openclaw/references/payment-flow.md`,          priority: 0.8 },
    { url: `${BASE}/crehub/openclaw/references/workflow-schema.md`,       priority: 0.8 },
    { url: `${BASE}/crehub/openclaw/examples/agent-demo.md`,              priority: 0.7 },
  ]

  return [...staticPages, ...openclawPages, ...rawMarkdown].map(({ url, priority }) => ({
    url,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority,
  }))
}

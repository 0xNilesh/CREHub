/**
 * POST /api/agent/run
 *
 * Thin server-side proxy: receives a pre-paid payment tx hash from the
 * Agent Console (payment made client-side via the user's connected wallet),
 * forwards it to the CREHub backend trigger, and streams the result as SSE.
 *
 * Body: { workflowId: string, params: Record<string, string>, paymentTxHash: string }
 * Stream: SSE events (retrying → result → done)
 */

export type AgentEvent =
  | { type: 'step';          message: string }
  | { type: 'sub';           message: string }
  | { type: 'payment';       amount: string; amountWei: string; payTo: string }
  | { type: 'balance';       usd: string; sufficient: boolean }
  | { type: 'tx_broadcast';  txHash: string }
  | { type: 'tx_confirmed';  txHash: string }
  | { type: 'retrying' }
  | { type: 'result';        success: boolean; output: Record<string, unknown> | null; settlementTx?: string; pricePaid: string; error?: string }
  | { type: 'error';         message: string }
  | { type: 'done' }

export async function POST(request: Request) {
  const { workflowId, params, paymentTxHash } = (await request.json()) as {
    workflowId:    string
    params:        Record<string, string>
    paymentTxHash: string
  }

  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (ev: AgentEvent) => {
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
      }

      try {
        emit({ type: 'retrying' })

        const triggerUrl = `${BACKEND}/api/trigger/${workflowId}`
        const res = await fetch(triggerUrl, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Payment':    paymentTxHash,
          },
          body: JSON.stringify(params),
        })

        const result = await res.json() as Record<string, unknown>

        if (!res.ok) {
          emit({ type: 'error', message: (result.error as string) ?? `Trigger failed: ${res.status}` })
        } else {
          emit({
            type:         'result',
            success:      (result.success as boolean) ?? false,
            output:       (result.output as Record<string, unknown>) ?? null,
            settlementTx: result.settlementTx as string | undefined,
            pricePaid:    '',
            error:        result.error as string | undefined,
          })
        }
      } catch (e) {
        emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      }

      emit({ type: 'done' })
      ctrl.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

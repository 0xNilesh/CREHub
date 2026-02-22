'use client'

import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { motion, AnimatePresence } from 'framer-motion'
import type { Workflow, WorkflowIOField } from '@/lib/types'
import { formatPrice } from '@/lib/types'
import { api } from '@/lib/api'

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',    type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

type Step = 'idle' | 'filling' | 'awaiting_payment' | 'verifying' | 'done' | 'error'

interface PaymentDetails {
  network: string
  payTo: string
  amount: string
  token: string
}

interface Props { workflow: Workflow }

export default function TriggerPanel({ workflow }: Props) {
  const { isConnected } = useAccount()
  const [step,           setStep]           = useState<Step>('idle')
  const [inputs,         setInputs]         = useState<Record<string, string>>({})
  const [txHash,         setTxHash]         = useState('')
  const [result,         setResult]         = useState<unknown>(null)
  const [error,          setError]          = useState('')
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null)
  const [pendingPayTx,   setPendingPayTx]   = useState<`0x${string}` | undefined>(undefined)
  const [payTxError,     setPayTxError]     = useState('')

  const { writeContractAsync } = useWriteContract()
  const { isSuccess: payTxConfirmed, isLoading: payTxPending } = useWaitForTransactionReceipt({
    hash: pendingPayTx,
  })

  // Auto-fill tx hash once the payment is confirmed on-chain
  useEffect(() => {
    if (payTxConfirmed && pendingPayTx) {
      setTxHash(pendingPayTx)
    }
  }, [payTxConfirmed, pendingPayTx])

  const required = workflow.inputs.filter((f) => f.required)
  const allFilled = required.every((f) => (inputs[f.name] ?? '').trim().length > 0)

  const setField = (name: string, val: string) =>
    setInputs((p) => ({ ...p, [name]: val }))

  const reset = () => {
    setStep('idle'); setInputs({}); setTxHash(''); setResult(null); setError('')
    setPaymentDetails(null); setPendingPayTx(undefined); setPayTxError('')
  }

  const handlePayWithWallet = async () => {
    if (!paymentDetails) return
    setPayTxError('')
    try {
      const hash = await writeContractAsync({
        address: paymentDetails.token as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [paymentDetails.payTo as `0x${string}`, BigInt(paymentDetails.amount)],
      })
      setPendingPayTx(hash)
    } catch (e) {
      setPayTxError(e instanceof Error ? e.message : 'Transaction rejected')
    }
  }

  // Step 1: submit inputs → show 402 payment details
  const handleSubmit = async () => {
    setStep('awaiting_payment')
    setError('')
    const res = await api.trigger(workflow.workflowId, inputs)
    if (res.status === 402) {
      const body = res.body as { paymentDetails?: PaymentDetails }
      if (body.paymentDetails) setPaymentDetails(body.paymentDetails)
    } else {
      setError(`Unexpected response: ${res.status}`)
      setStep('error')
    }
  }

  // Step 2: confirm payment tx hash → verify + execute
  const handleConfirmPayment = async () => {
    if (!txHash.trim()) return
    setStep('verifying')
    setError('')
    try {
      const res = await api.trigger(workflow.workflowId, inputs, txHash.trim())
      if (res.status === 200) {
        setResult(res.body)
        setStep('done')
      } else {
        const body = res.body as { error?: string }
        setError(body.error ?? 'Payment verification failed')
        setStep('error')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setStep('error')
    }
  }

  if (!isConnected) {
    return (
      <div className="card p-6 flex flex-col items-center gap-4 text-center">
        <div className="size-12 rounded-full bg-cl-blue/10 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cl-blue-l">
            <path d="M21 12V7H5a2 2 0 010-4h14" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 5v14a2 2 0 002 2h16v-5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="18" cy="16" r="2" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-white">Connect Wallet to Trigger</p>
          <p className="text-xs text-white/40 mt-1">Pay {formatPrice(workflow.pricePerInvocation)} USDC per execution</p>
        </div>
        <ConnectButton chainStatus="none" showBalance={false} />
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Trigger Workflow</p>
          <p className="text-xs text-white/40 mt-0.5">Cost: {formatPrice(workflow.pricePerInvocation)} USDC</p>
        </div>
        {step !== 'idle' && step !== 'filling' && (
          <button onClick={reset} className="text-xs text-white/30 hover:text-white/60 transition">Reset</button>
        )}
      </div>

      {/* Steps progress */}
      <StepsIndicator step={step} />

      <div className="p-5">
        <AnimatePresence mode="wait">

          {/* ── STEP 0: Input form ──────────────────────────────────────── */}
          {(step === 'idle' || step === 'filling') && (
            <motion.div key="form" {...fade} className="space-y-3">
              {workflow.inputs.map((f) => (
                <FieldInput key={f.name} field={f} value={inputs[f.name] ?? ''} onChange={(v) => setField(f.name, v)} />
              ))}
              {workflow.inputs.length === 0 && (
                <p className="text-xs text-white/35 italic">This workflow takes no inputs.</p>
              )}
              <button
                onClick={handleSubmit}
                disabled={!allFilled && required.length > 0}
                className="btn-primary w-full justify-center mt-2"
              >
                Execute →
              </button>
            </motion.div>
          )}

          {/* ── STEP 1: Awaiting payment ────────────────────────────────── */}
          {step === 'awaiting_payment' && (
            <motion.div key="pay" {...fade} className="space-y-4">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3.5 text-xs space-y-2.5">
                <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <span>⚡</span> Payment Required (HTTP 402)
                </p>
                <p className="text-white/55">
                  Send <strong className="text-white">{formatPrice(workflow.pricePerInvocation)} USDC</strong> on Ethereum Sepolia to:
                </p>
                {/* Pay-to wallet address */}
                <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-black/20 px-3 py-2">
                  <code className="flex-1 break-all font-mono text-[11px] text-amber-200/80">
                    {paymentDetails?.payTo ?? '…'}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(paymentDetails?.payTo ?? '')}
                    className="shrink-0 rounded border border-white/[0.08] px-2 py-0.5 text-[10px] text-white/30 transition hover:border-white/20 hover:text-white/60"
                  >
                    Copy
                  </button>
                </div>
                <p className="font-mono text-[10px] text-white/30 break-all">
                  Network: Ethereum Sepolia · Token: {paymentDetails?.token ?? '0x1c7D…7238'}
                </p>
                <p className="text-white/40">
                  Then paste the transaction hash below to confirm.
                </p>
              </div>
              {/* Pay with Wallet button */}
              <button
                onClick={handlePayWithWallet}
                disabled={payTxPending || payTxConfirmed || !paymentDetails}
                className="btn-primary w-full justify-center gap-2"
              >
                {payTxPending ? (
                  <>
                    <span className="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Confirming on-chain…
                  </>
                ) : payTxConfirmed ? (
                  <>
                    <span className="text-emerald-300">✓</span> Payment sent — hash auto-filled
                  </>
                ) : (
                  <>Pay with Wallet</>
                )}
              </button>

              {payTxError && (
                <p className="text-[11px] text-red-400/80">{payTxError}</p>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/[0.07]" />
                <span className="text-[10px] text-white/25 uppercase tracking-widest">or paste manually</span>
                <div className="flex-1 h-px bg-white/[0.07]" />
              </div>

              <div>
                <label className="text-xs text-white/50 mb-1.5 block">USDC Transfer Tx Hash</label>
                <input
                  className="input font-mono text-xs"
                  placeholder="0x…"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                />
              </div>
              <button
                onClick={handleConfirmPayment}
                disabled={!txHash.trim()}
                className="btn-primary w-full justify-center"
              >
                Confirm Payment →
              </button>
            </motion.div>
          )}

          {/* ── STEP 2: Verifying ───────────────────────────────────────── */}
          {step === 'verifying' && (
            <motion.div key="verify" {...fade} className="flex flex-col items-center gap-4 py-6">
              <div className="relative size-12">
                <div className="absolute inset-0 rounded-full border-2 border-cl-blue/20" />
                <div className="absolute inset-0 rounded-full border-2 border-t-cl-blue-l border-r-transparent border-b-transparent border-l-transparent animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-white">Verifying Payment…</p>
                <p className="text-xs text-white/40 mt-1">Checking USDC Transfer log on Sepolia</p>
              </div>
              <ProgressBar />
            </motion.div>
          )}

          {/* ── STEP 3: Done ────────────────────────────────────────────── */}
          {step === 'done' && (
            <motion.div key="done" {...fade} className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <span className="size-5 rounded-full bg-emerald-400/20 flex items-center justify-center text-xs">✓</span>
                <span className="text-sm font-semibold">Execution Successful</span>
              </div>
              <pre className="rounded-lg bg-white/[0.04] border border-white/[0.07] p-3.5 text-xs font-mono text-white/80 overflow-auto max-h-48 leading-relaxed">
                {JSON.stringify(result, null, 2)}
              </pre>
              <button onClick={reset} className="btn-ghost w-full justify-center text-xs">
                Run Again
              </button>
            </motion.div>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {step === 'error' && (
            <motion.div key="err" {...fade} className="space-y-3">
              <div className="rounded-lg border border-red-500/25 bg-red-500/8 p-3.5">
                <p className="text-xs font-semibold text-red-400 mb-1">Error</p>
                <p className="text-xs text-white/55">{error}</p>
              </div>
              <button onClick={reset} className="btn-ghost w-full justify-center text-xs">
                Try Again
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const fade = {
  initial:   { opacity: 0, y: 8 },
  animate:   { opacity: 1, y: 0 },
  exit:      { opacity: 0, y: -8 },
  transition: { duration: 0.25 },
}

function FieldInput({ field, value, onChange }: {
  field: WorkflowIOField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs text-white/55 mb-1.5">
        <code className="text-white/70">{field.name}</code>
        <span className="text-white/20">·</span>
        <span>{field.fieldType}</span>
        {field.required && <span className="text-red-400/60">*</span>}
      </label>
      {field.fieldType === 'boolean' ? (
        <select
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          className="input"
          placeholder={field.description || `Enter ${field.name}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

const STEP_LABELS = ['Fill Inputs', 'Pay USDC', 'Verify', 'Done']
const STEP_MAP: Record<Step, number> = {
  idle: 0, filling: 0, awaiting_payment: 1, verifying: 2, done: 3, error: 1,
}

function StepsIndicator({ step }: { step: Step }) {
  const current = STEP_MAP[step]
  return (
    <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-0">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-0 flex-1">
          <div className="flex flex-col items-center gap-1 flex-1">
            <div className={`size-5 rounded-full text-[10px] flex items-center justify-center font-semibold transition-all duration-300 ${
              i < current  ? 'bg-emerald-500 text-white'
              : i === current ? 'bg-cl-blue text-white shadow-glow-sm'
              : 'bg-white/[0.08] text-white/25'
            }`}>
              {i < current ? '✓' : i + 1}
            </div>
            <span className={`text-[9px] text-center leading-none ${
              i === current ? 'text-white/60' : 'text-white/20'
            }`}>{label}</span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div className={`h-px flex-1 mb-4 transition-all duration-500 ${i < current ? 'bg-emerald-500/50' : 'bg-white/[0.07]'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function ProgressBar() {
  return (
    <div className="w-full max-w-[200px] h-0.5 rounded-full bg-white/10 overflow-hidden">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-cl-blue to-cl-blue-l"
        initial={{ width: '0%' }}
        animate={{ width: '80%' }}
        transition={{ duration: 2, ease: 'easeOut' }}
      />
    </div>
  )
}

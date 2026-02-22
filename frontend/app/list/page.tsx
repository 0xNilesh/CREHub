'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { REGISTRY_ADDRESS, REGISTRY_ABI } from '@/lib/contracts'
import type { WorkflowIOField } from '@/lib/types'
import { CATEGORY_LABELS } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldDraft = Omit<WorkflowIOField, 'required'> & { required: boolean }

interface FormState {
  workflowId: string
  description: string
  detailedDescription: string
  category: string
  pricePerInvocation: string
  inputs: FieldDraft[]
  outputs: FieldDraft[]
}

const EMPTY_FIELD = (): FieldDraft => ({
  name: '', fieldType: 'string', description: '', required: true,
})

const INITIAL: FormState = {
  workflowId: '', description: '', detailedDescription: '',
  category: 'defi', pricePerInvocation: '10000',
  inputs: [EMPTY_FIELD()], outputs: [EMPTY_FIELD()],
}

const STEPS = ['Basics', 'Inputs', 'Outputs', 'Preview']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ListPage() {
  const { address, isConnected } = useAccount()
  const { writeContractAsync } = useWriteContract()

  const [step,    setStep]    = useState(0)
  const [form,    setForm]    = useState<FormState>(INITIAL)
  const [loading, setLoading] = useState(false)
  const [txHash,  setTxHash]  = useState<`0x${string}` | undefined>()
  const [error,   setError]   = useState('')

  const { isLoading: isMining, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }))

  const setFieldProp = (
    dir: 'inputs' | 'outputs',
    i: number,
    key: keyof FieldDraft,
    val: string | boolean,
  ) => {
    const arr = [...form[dir]]
    arr[i] = { ...arr[i], [key]: val }
    set(dir, arr)
  }

  const addField    = (dir: 'inputs' | 'outputs') => set(dir, [...form[dir], EMPTY_FIELD()])
  const removeField = (dir: 'inputs' | 'outputs', i: number) =>
    set(dir, form[dir].filter((_, idx) => idx !== i))

  const canProceed = [
    // Step 0 basics — wallet must be connected
    isConnected &&
    form.workflowId.trim() && /^[a-z0-9_]+$/.test(form.workflowId) &&
    form.description.trim().length > 0 && form.description.length <= 160,
    // Step 1 inputs
    form.inputs.every((f) => f.name.trim().length > 0),
    // Step 2 outputs
    form.outputs.length > 0 && form.outputs.every((f) => f.name.trim().length > 0),
    // Step 3 always ok (preview)
    true,
  ]

  const handleSubmit = async () => {
    if (!isConnected || !address) {
      setError('Connect your wallet first')
      return
    }
    setLoading(true); setError('')
    try {
      const hash = await writeContractAsync({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'listWorkflow',
        args: [
          form.workflowId,
          BigInt(form.pricePerInvocation || '0'),
          form.description,
          form.detailedDescription,
          form.category,
          form.inputs.map(({ name, fieldType, description, required }) => ({
            name, fieldType, description, required,
          })),
          form.outputs.map(({ name, fieldType, description, required }) => ({
            name, fieldType, description, required,
          })),
        ],
      })
      setTxHash(hash)
      setStep(4)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Submitted ──────────────────────────────────────────────────────────────
  if (step === 4 && txHash) {
    return (
      <div className="min-h-screen pt-32 flex items-start justify-center px-4">
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card p-10 max-w-md w-full text-center">
          {isConfirmed ? (
            <>
              <div className="size-14 rounded-full bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center text-2xl mx-auto mb-5">✓</div>
              <h2 className="text-xl font-bold text-white mb-2">Workflow Listed!</h2>
              <p className="text-sm text-white/50 mb-6">Transaction confirmed on Sepolia.</p>
            </>
          ) : (
            <>
              <div className="size-14 rounded-full bg-cl-blue/15 border border-cl-blue/25 flex items-center justify-center mx-auto mb-5">
                <svg className="animate-spin size-6 text-cl-blue-l" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Transaction Submitted</h2>
              <p className="text-sm text-white/50 mb-6">Waiting for on-chain confirmation…</p>
            </>
          )}

          <div className="rounded-lg bg-white/[0.04] border border-white/[0.07] px-4 py-3 text-left mb-3">
            <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Workflow ID</p>
            <code className="text-sm font-mono text-cl-blue-l">{form.workflowId}</code>
          </div>
          <div className="rounded-lg bg-white/[0.04] border border-white/[0.07] px-4 py-3 text-left mb-6">
            <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Transaction</p>
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs font-mono text-cl-blue-l hover:underline break-all"
            >
              {txHash}
            </a>
          </div>

          <div className="flex gap-3">
            <a href={`/workflow/${form.workflowId}`} className="btn-primary flex-1 justify-center text-sm">View Workflow</a>
            <button onClick={() => { setForm(INITIAL); setStep(0); setTxHash(undefined) }} className="btn-ghost flex-1 justify-center text-sm">List Another</button>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">

        {/* Header */}
        <div className="mb-10 page-enter">
          <span className="label-section mb-4 inline-flex">Creator</span>
          <h1 className="text-3xl font-bold text-white">List Your Workflow</h1>
          <p className="mt-2 text-sm text-white/45">Make your CRE workflow discoverable and monetise it with USDC micropayments.</p>
        </div>

        {/* Wallet warning */}
        {!isConnected && (
          <div className="mb-6 rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-xs text-amber-300">
            Connect your wallet to submit a listing on-chain.
          </div>
        )}

        {/* Step bar */}
        <div className="flex items-center gap-0 mb-10">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1">
              <div
                className="flex flex-col items-center gap-1 flex-1 cursor-pointer"
                onClick={() => i < step && setStep(i)}
              >
                <div className={`size-7 rounded-full text-xs flex items-center justify-center font-semibold transition-all duration-300 ${
                  i < step     ? 'bg-emerald-500 text-white'
                  : i === step ? 'bg-cl-blue text-white shadow-glow-sm'
                  : 'bg-white/[0.08] text-white/25'
                }`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-[10px] ${i === step ? 'text-white/60' : 'text-white/25'}`}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 mb-4 transition-all duration-500 ${i < step ? 'bg-emerald-500/40' : 'bg-white/[0.07]'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
          >
            {step === 0 && <StepBasics form={form} set={set} connectedAddress={address} />}
            {step === 1 && <StepFields dir="inputs"  fields={form.inputs}  onAdd={() => addField('inputs')}  onRemove={(i) => removeField('inputs', i)}  onSet={(i, k, v) => setFieldProp('inputs', i, k, v)} />}
            {step === 2 && <StepFields dir="outputs" fields={form.outputs} onAdd={() => addField('outputs')} onRemove={(i) => removeField('outputs', i)} onSet={(i, k, v) => setFieldProp('outputs', i, k, v)} />}
            {step === 3 && <StepPreview form={form} connectedAddress={address} />}
          </motion.div>
        </AnimatePresence>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-3 text-xs text-red-300">{error}</div>
        )}

        {/* Nav buttons */}
        <div className="flex justify-between mt-8">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="btn-ghost disabled:opacity-30"
          >
            ← Back
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed[step]}
              className="btn-primary"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading || !isConnected}
              className="btn-primary min-w-[140px] justify-center disabled:opacity-40"
            >
              {loading
                ? <span className="flex items-center gap-2"><svg className="animate-spin size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83" strokeLinecap="round"/></svg>Confirm in wallet…</span>
                : 'Submit On-Chain'
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepBasics({
  form, set, connectedAddress,
}: {
  form: FormState
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  connectedAddress?: string
}) {
  return (
    <div className="card p-6 space-y-5">
      <h2 className="text-base font-semibold text-white">Basic Information</h2>

      <Field label="Workflow ID" hint="Lowercase, digits, underscores (e.g. wf_health_monitor_01)" required>
        <input className="input font-mono" value={form.workflowId} placeholder="wf_my_workflow_01"
          onChange={(e) => set('workflowId', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
      </Field>

      <Field label="Category" required>
        <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
          {Object.entries(CATEGORY_LABELS).filter(([k]) => k !== 'all').map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </Field>

      <Field label="Short description" hint={`${form.description.length}/160 chars`} required>
        <input className="input" value={form.description} placeholder="One-liner describing what this workflow does"
          maxLength={160} onChange={(e) => set('description', e.target.value)} />
      </Field>

      <Field label="Detailed description" hint="Markdown supported">
        <textarea className="input resize-none" rows={4} value={form.detailedDescription} placeholder="Full capabilities, use-cases, limitations…"
          onChange={(e) => set('detailedDescription', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Price (USDC wei)" hint="e.g. 10000 = $0.01" required>
          <input className="input font-mono" type="number" min="0" value={form.pricePerInvocation}
            onChange={(e) => set('pricePerInvocation', e.target.value)} />
        </Field>
        <Field label="Creator (connected wallet)">
          <div className="input font-mono text-xs text-white/40 truncate select-none">
            {connectedAddress ?? 'Not connected'}
          </div>
        </Field>
      </div>
    </div>
  )
}

const TYPE_OPTIONS = ['string', 'number', 'boolean', 'address'] as const

function StepFields({ dir, fields, onAdd, onRemove, onSet }: {
  dir: 'inputs' | 'outputs'
  fields: FieldDraft[]
  onAdd: () => void
  onRemove: (i: number) => void
  onSet: (i: number, key: keyof FieldDraft, val: string | boolean) => void
}) {
  const label = dir === 'inputs' ? 'Inputs' : 'Outputs'
  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">{label}</h2>
        <button onClick={onAdd} className="btn-ghost text-xs gap-1"><span>+</span> Add Field</button>
      </div>

      <AnimatePresence>
        {fields.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-4 space-y-3 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/35 font-mono">field {i + 1}</span>
              {fields.length > (dir === 'outputs' ? 1 : 0) && (
                <button onClick={() => onRemove(i)} className="text-white/25 hover:text-red-400 text-xs transition">✕</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" required>
                <input className="input text-sm font-mono" value={f.name} placeholder="fieldName"
                  onChange={(e) => onSet(i, 'name', e.target.value)} />
              </Field>
              <Field label="Type" required>
                <select className="input text-sm" value={f.fieldType} onChange={(e) => onSet(i, 'fieldType', e.target.value)}>
                  {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Description">
              <input className="input text-sm" value={f.description} placeholder="What this field represents"
                onChange={(e) => onSet(i, 'description', e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
              <input type="checkbox" checked={f.required} onChange={(e) => onSet(i, 'required', e.target.checked)}
                className="accent-cl-blue size-3.5" />
              Required
            </label>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function StepPreview({ form, connectedAddress }: { form: FormState; connectedAddress?: string }) {
  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="text-base font-semibold text-white mb-4">Preview</h2>
        <pre className="text-xs font-mono text-white/55 leading-relaxed overflow-auto max-h-80 rounded-lg bg-black/30 p-4">
          {JSON.stringify({
            workflowId: form.workflowId,
            description: form.description,
            category: form.category,
            pricePerInvocation: form.pricePerInvocation,
            creatorAddress: connectedAddress ?? '(connect wallet)',
            inputs: form.inputs,
            outputs: form.outputs,
          }, null, 2)}
        </pre>
      </div>
      <div className="rounded-lg border border-cl-blue/20 bg-cl-blue/8 px-4 py-3 text-xs text-white/50">
        <span className="font-semibold text-cl-blue-l">On-chain:</span> Submitting will call <code className="font-mono">WorkflowRegistry.listWorkflow()</code> on Ethereum Sepolia via your connected wallet.
      </div>
    </div>
  )
}

function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs text-white/50 mb-1.5">
        {label}
        {required && <span className="text-red-400/60 ml-0.5">*</span>}
        {hint && <span className="ml-1.5 text-white/25">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

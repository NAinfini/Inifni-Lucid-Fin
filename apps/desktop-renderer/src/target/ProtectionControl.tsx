import React, { useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { useTargetEnvironment } from './environment.js';

export interface PendingProtectionConfirmation {
  readonly id: string;
  readonly immutableInputHash: string;
  readonly summary: string;
}

interface ProtectionControlProps {
  readonly active: boolean;
  readonly label: string;
  readonly onRequest: (
    mode: 'protect' | 'unprotect',
    reason: string,
  ) => Promise<PendingProtectionConfirmation | null>;
  readonly onRespond: (
    confirmation: PendingProtectionConfirmation,
    decision: 'approved' | 'denied',
  ) => Promise<void>;
}

export function ProtectionControl({ active, label, onRequest, onRespond }: ProtectionControlProps) {
  const { locale } = useTargetEnvironment();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<PendingProtectionConfirmation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const confirmation = await onRequest(active ? 'unprotect' : 'protect', reason.trim());
      setPending(confirmation);
      if (confirmation === null) setReason('');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法请求保护变更。'
            : 'The protection change could not be requested.',
      );
    } finally {
      setSaving(false);
    }
  };

  const respond = async (decision: 'approved' | 'denied') => {
    if (pending === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onRespond(pending, decision);
      setPending(null);
      setReason('');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法提交明确确认。'
            : 'The explicit confirmation could not be submitted.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="target-protection-control" aria-label={label}>
      <header>
        {active ? <Lock size={14} /> : <Unlock size={14} />}
        <span>
          <strong>{label}</strong>
          <small>
            {active
              ? locale === 'zh-CN'
                ? '已保护；变更此事实会再次要求确认。'
                : 'Protected; changing this fact requires another confirmation.'
              : locale === 'zh-CN'
                ? '未保护。保护与解除保护始终需要明确确认。'
                : 'Not protected. Protect and unprotect always require explicit confirmation.'}
          </small>
        </span>
      </header>
      {pending === null ? (
        <>
          <label>
            <span>{locale === 'zh-CN' ? '原因（可选）' : 'Reason (optional)'}</span>
            <input
              value={reason}
              maxLength={4_000}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
          <button type="button" disabled={saving} onClick={() => void request()}>
            {active ? <Unlock size={12} /> : <Lock size={12} />}
            {saving
              ? locale === 'zh-CN'
                ? '正在请求…'
                : 'Requesting…'
              : active
                ? locale === 'zh-CN'
                  ? '请求解除保护'
                  : 'Request unprotect'
                : locale === 'zh-CN'
                  ? '请求保护'
                  : 'Request protection'}
          </button>
        </>
      ) : (
        <div className="target-protection-confirmation" role="alert">
          <strong>{locale === 'zh-CN' ? '需要明确确认' : 'Explicit confirmation required'}</strong>
          <p>{pending.summary}</p>
          <div>
            <button type="button" disabled={saving} onClick={() => void respond('denied')}>
              {locale === 'zh-CN' ? '取消' : 'Cancel'}
            </button>
            <button type="button" disabled={saving} onClick={() => void respond('approved')}>
              {saving
                ? locale === 'zh-CN'
                  ? '正在确认…'
                  : 'Confirming…'
                : locale === 'zh-CN'
                  ? '明确确认'
                  : 'Confirm explicitly'}
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <p className="target-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

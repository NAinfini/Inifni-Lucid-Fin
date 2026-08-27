import React, { useState } from 'react';
import { BookmarkPlus, Check, RefreshCw, ThumbsDown, Undo2, X } from 'lucide-react';
import { useTargetEnvironment } from './environment.js';

export type TargetResultDecisionAction =
  'select' | 'reject' | 'refine' | 'use_as_reference' | 'undo';

export type TargetResultDecisionState = 'selected' | 'rejected' | 'refine' | 'reference' | null;

interface ResultDecisionControlsProps {
  readonly resultId: string;
  readonly state: TargetResultDecisionState;
  readonly disabledReason: string | null;
  readonly onDecide: (action: TargetResultDecisionAction, detail: string) => Promise<void>;
}

export function ResultDecisionControls({
  resultId,
  state,
  disabledReason,
  onDecide,
}: ResultDecisionControlsProps) {
  const { locale } = useTargetEnvironment();
  const [pending, setPending] = useState<'reject' | 'refine' | null>(null);
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = disabledReason !== null || saving;

  const decide = async (action: TargetResultDecisionAction, value = '') => {
    if (disabledReason !== null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onDecide(action, value);
      setPending(null);
      setDetail('');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法记录结果决定。'
            : 'The result decision could not be recorded.',
      );
    } finally {
      setSaving(false);
    }
  };

  const actionTitle = disabledReason ?? undefined;
  return (
    <div className="target-result-actions">
      {state !== null && (
        <span className={`target-result-decision is-${state}`} role="status">
          {state === 'selected'
            ? locale === 'zh-CN'
              ? '已选择'
              : 'Selected'
            : state === 'rejected'
              ? locale === 'zh-CN'
                ? '已拒绝'
                : 'Rejected'
              : state === 'refine'
                ? locale === 'zh-CN'
                  ? '待精修'
                  : 'Refine requested'
                : locale === 'zh-CN'
                  ? '作为参考'
                  : 'Reference'}
        </span>
      )}
      <div className="target-result-action-row">
        <button
          type="button"
          disabled={disabled}
          title={actionTitle}
          onClick={() => void decide('select')}
        >
          <Check size={12} />
          {locale === 'zh-CN' ? '选择' : 'Select'}
        </button>
        <button
          type="button"
          disabled={disabled}
          title={actionTitle}
          onClick={() => {
            setPending('reject');
            setDetail('');
            setError(null);
          }}
        >
          <ThumbsDown size={12} />
          {locale === 'zh-CN' ? '拒绝' : 'Reject'}
        </button>
        <button
          type="button"
          disabled={disabled}
          title={actionTitle}
          onClick={() => {
            setPending('refine');
            setDetail('');
            setError(null);
          }}
        >
          <RefreshCw size={12} />
          {locale === 'zh-CN' ? '精修' : 'Refine'}
        </button>
        <button
          type="button"
          disabled={disabled}
          title={actionTitle}
          onClick={() => void decide('use_as_reference')}
        >
          <BookmarkPlus size={12} />
          {locale === 'zh-CN' ? '作为参考' : 'Use as reference'}
        </button>
        {state !== null && (
          <button
            type="button"
            disabled={disabled}
            title={actionTitle}
            onClick={() => void decide('undo')}
          >
            <Undo2 size={12} />
            {locale === 'zh-CN' ? '撤销' : 'Undo'}
          </button>
        )}
      </div>
      {pending !== null && (
        <form
          className="target-result-detail-form"
          aria-label={
            pending === 'reject'
              ? locale === 'zh-CN'
                ? `拒绝结果 ${resultId}`
                : `Reject result ${resultId}`
              : locale === 'zh-CN'
                ? `精修结果 ${resultId}`
                : `Refine result ${resultId}`
          }
          onSubmit={(event) => {
            event.preventDefault();
            const value = detail.trim();
            if (value.length > 0) void decide(pending, value);
          }}
        >
          <label>
            <span>
              {pending === 'reject'
                ? locale === 'zh-CN'
                  ? '拒绝原因'
                  : 'Why this candidate is not usable'
                : locale === 'zh-CN'
                  ? '精修指示'
                  : 'What should change'}
            </span>
            <textarea
              value={detail}
              maxLength={20_000}
              onChange={(event) => setDetail(event.currentTarget.value)}
              autoFocus
            />
          </label>
          <div>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setPending(null);
                setDetail('');
                setError(null);
              }}
            >
              <X size={12} />
              {locale === 'zh-CN' ? '取消' : 'Cancel'}
            </button>
            <button type="submit" disabled={saving || detail.trim().length === 0}>
              {saving
                ? locale === 'zh-CN'
                  ? '正在记录…'
                  : 'Recording…'
                : locale === 'zh-CN'
                  ? '记录决定'
                  : 'Record decision'}
            </button>
          </div>
        </form>
      )}
      {error !== null && (
        <p className="target-inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

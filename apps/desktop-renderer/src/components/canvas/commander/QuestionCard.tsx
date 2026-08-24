import { useState } from 'react';
import { Check, MessageCircleQuestion } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

export interface QuestionCardProps {
  id?: string;
  question: string;
  options: Array<{ label: string; description?: string; previewAssetHash?: string }>;
  onAnswer: (answer: string) => void | Promise<void>;
  t: (key: string) => string;
  allowFreeText?: boolean;
  disabled?: boolean;
  error?: string | null;
  status?: string | null;
}

export function QuestionCard({
  id,
  question,
  options,
  onAnswer,
  t,
  allowFreeText = true,
  disabled = false,
  error = null,
  status = null,
}: QuestionCardProps) {
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const validOptions = options.filter((option) => option.label.trim().length > 0);

  return (
    <div id={id} className="rounded-xl border border-blue-500/55 bg-blue-500/[0.06] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-blue-300">
        <MessageCircleQuestion className="h-4 w-4" aria-hidden />
        <span>{t('commander.question.title')}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-foreground">{question}</p>
      <div
        role="group"
        aria-label={t('commander.question.selectOption')}
        className="mt-4 flex flex-col gap-2"
      >
        {validOptions.map((opt, index) => (
          <button
            key={`${index}-${opt.label}`}
            type="button"
            disabled={disabled}
            aria-label={opt.label}
            aria-pressed={selectedOption === opt.label}
            className={cn(
              'relative flex min-h-16 w-full items-start gap-3 overflow-hidden rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50',
              selectedOption === opt.label
                ? 'border-blue-400 bg-blue-500/15'
                : 'border-border/70 bg-background/30 hover:border-blue-400/70 hover:bg-blue-500/10',
            )}
            onClick={() => {
              setSelectedOption(opt.label);
              setShowCustom(false);
            }}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                selectedOption === opt.label
                  ? 'border-blue-400 bg-blue-500 text-white'
                  : 'border-muted-foreground/60',
              )}
              aria-hidden
            >
              {selectedOption === opt.label ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{opt.label}</span>
              {opt.description ? (
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {opt.description}
                </span>
              ) : null}
            </span>
            {opt.previewAssetHash ? (
              <span className="relative block h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted/40">
                <img
                  src={`lucid-asset://${opt.previewAssetHash}/image/png`}
                  alt={opt.label}
                  className="h-full w-full object-cover"
                />
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {validOptions.length > 0 || allowFreeText ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-blue-400/15 pt-4">
          {validOptions.length > 0 ? (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45"
              disabled={disabled || selectedOption === null}
              onClick={() => {
                if (selectedOption) void onAnswer(selectedOption);
              }}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t('commander.question.confirmChoice')}
            </button>
          ) : null}
          {allowFreeText &&
            (showCustom ? (
              <div className="flex min-w-0 flex-1 basis-full gap-2">
                <input
                  type="text"
                  aria-label={t('commander.question.otherAnswer')}
                  disabled={disabled}
                  className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={t('commander.question.otherAnswer')}
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customText.trim()) {
                      void onAnswer(customText.trim());
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="min-h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled || !customText.trim()}
                  onClick={() => {
                    if (customText.trim()) void onAnswer(customText.trim());
                  }}
                >
                  {t('commander.question.submit')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={disabled}
                className="inline-flex min-h-9 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setSelectedOption(null);
                  setShowCustom(true);
                }}
              >
                {t('commander.question.otherAnswer')}
              </button>
            ))}
        </div>
      ) : null}
      {status ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

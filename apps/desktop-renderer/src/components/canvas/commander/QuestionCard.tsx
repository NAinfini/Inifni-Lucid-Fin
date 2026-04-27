import { useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';

export interface QuestionCardProps {
  question: string;
  options: Array<{ label: string; description?: string }>;
  onAnswer: (answer: string) => void;
  t: (key: string) => string;
}

export function QuestionCard({ question, options, onAnswer, t }: QuestionCardProps) {
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="mx-3 my-2 rounded-lg border border-blue-500/50 bg-blue-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <MessageCircleQuestion className="h-4 w-4 text-blue-400" />
        <span>{t('commander.question.title')}</span>
      </div>
      <p className="mt-2 text-sm text-foreground">{question}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {options.map((opt, index) => (
          <button
            key={`${index}-${opt.label}`}
            type="button"
            className="flex flex-col items-start rounded-md border border-border/60 px-3 py-2 text-left text-xs transition-colors hover:border-blue-500/50 hover:bg-blue-500/10"
            onClick={() => onAnswer(opt.label)}
          >
            <span className="font-medium text-foreground">{opt.label}</span>
            {opt.description && (
              <span className="mt-0.5 text-muted-foreground">{opt.description}</span>
            )}
          </button>
        ))}
      </div>
      {showCustom ? (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-blue-500/50"
            placeholder={t('commander.question.otherAnswer')}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customText.trim()) {
                onAnswer(customText.trim());
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={!customText.trim()}
            onClick={() => {
              if (customText.trim()) onAnswer(customText.trim());
            }}
          >
            {t('commander.question.submit')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          onClick={() => setShowCustom(true)}
        >
          {t('commander.question.otherAnswer')}
        </button>
      )}
    </div>
  );
}

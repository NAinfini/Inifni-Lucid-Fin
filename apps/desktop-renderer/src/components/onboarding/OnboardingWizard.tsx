import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { RootState } from '../../store/index.js';
import { setTheme, setOnboardingComplete } from '../../store/slices/ui.js';
import { addCanvas, setActiveCanvas } from '../../store/slices/canvas.js';
import { t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'welcome' | 'theme' | 'provider' | 'canvas' | 'tips';
const STEPS: Step[] = ['welcome', 'theme', 'provider', 'canvas', 'tips'];

interface ProviderSetup {
  id: string;
  labelKey: string;
  apiKey: string;
  status: 'idle' | 'testing' | 'ok' | 'error';
  errorMsg: string;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5 justify-center mb-6">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={[
            'h-1.5 rounded-full transition-all duration-200',
            i === current
              ? 'w-6 bg-primary'
              : i < current
                ? 'w-3 bg-primary/50'
                : 'w-3 bg-border',
          ].join(' ')}
        />
      ))}
    </div>
  );
}

// Step 0 — Welcome
function WelcomeStep() {
  return (
    <div className="flex flex-col items-center text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-3xl select-none">
        🎬
      </div>
      <h1 className="text-xl font-semibold text-foreground">
        {t('onboarding.welcome.title')}
      </h1>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        {t('onboarding.welcome.description')}
      </p>
    </div>
  );
}

// Step 1 — Theme
function ThemeStep() {
  const dispatch = useDispatch();
  const currentTheme = useSelector((s: RootState) => s.ui.theme);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-2">
        <h2 className="text-base font-semibold text-foreground">{t('onboarding.theme.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('onboarding.theme.hint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(['light', 'dark'] as const).map((theme) => (
          <button
            key={theme}
            type="button"
            onClick={() => dispatch(setTheme(theme))}
            className={[
              'rounded-lg border p-3 flex flex-col gap-2 cursor-pointer transition-all',
              currentTheme === theme
                ? 'border-primary ring-1 ring-primary bg-primary/5'
                : 'border-border bg-card hover:border-primary/50',
            ].join(' ')}
          >
            {/* Mini preview */}
            <div
              className={[
                'rounded h-14 w-full flex flex-col gap-1 p-2',
                theme === 'dark' ? 'bg-zinc-900' : 'bg-white border border-zinc-200',
              ].join(' ')}
            >
              <div
                className={[
                  'h-2 w-3/4 rounded-sm',
                  theme === 'dark' ? 'bg-zinc-600' : 'bg-zinc-300',
                ].join(' ')}
              />
              <div
                className={[
                  'h-2 w-1/2 rounded-sm',
                  theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-200',
                ].join(' ')}
              />
              <div className="flex-1" />
              <div
                className={[
                  'h-2 w-8 rounded-sm self-end',
                  theme === 'dark' ? 'bg-violet-500' : 'bg-violet-500',
                ].join(' ')}
              />
            </div>
            <span className="text-xs text-center text-foreground font-medium">
              {t(`onboarding.theme.${theme}`)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Step 2 — AI Provider
function ProviderStep() {
  const [providers, setProviders] = useState<ProviderSetup[]>([
    { id: 'openai', labelKey: 'onboarding.provider.openai', apiKey: '', status: 'idle', errorMsg: '' },
    { id: 'google', labelKey: 'onboarding.provider.google', apiKey: '', status: 'idle', errorMsg: '' },
    { id: 'stability', labelKey: 'onboarding.provider.stability', apiKey: '', status: 'idle', errorMsg: '' },
  ]);

  function updateKey(id: string, value: string) {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, apiKey: value, status: 'idle', errorMsg: '' } : p)),
    );
  }

  async function saveAndTest(id: string) {
    const provider = providers.find((p) => p.id === id);
    if (!provider || !provider.apiKey.trim()) return;

    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'testing' } : p)),
    );

    try {
      const api = getAPI();
      if (!api) throw new Error('API not available');
      await api.keychain.set(id, provider.apiKey.trim());
      const result = await api.keychain.test(id);
      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, status: result.ok ? 'ok' : 'error', errorMsg: result.error ?? '' }
            : p,
        ),
      );
    } catch (err) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, status: 'error', errorMsg: String(err) }
            : p,
        ),
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-center mb-1">
        <h2 className="text-base font-semibold text-foreground">{t('onboarding.provider.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('onboarding.provider.hint')}</p>
      </div>
      {providers.map((provider) => (
        <div key={provider.id} className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
          <span className="text-xs font-medium text-foreground">{t(provider.labelKey)}</span>
          <div className="flex gap-2">
            <input
              type="password"
              value={provider.apiKey}
              onChange={(e) => updateKey(provider.id, e.target.value)}
              placeholder={t('onboarding.provider.placeholder')}
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => saveAndTest(provider.id)}
              disabled={!provider.apiKey.trim() || provider.status === 'testing'}
              className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            >
              {provider.status === 'testing'
                ? t('onboarding.provider.testing')
                : t('onboarding.provider.test')}
            </button>
          </div>
          {provider.status === 'ok' && (
            <span className="text-xs text-green-500">{t('onboarding.provider.testOk')}</span>
          )}
          {provider.status === 'error' && (
            <span className="text-xs text-destructive">
              {provider.errorMsg || t('onboarding.provider.testFail')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Step 3 — Create first canvas
function CanvasStep({ onCreated }: { onCreated: (id: string) => void }) {
  const dispatch = useDispatch();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    const canvasName = name.trim() || t('onboarding.canvas.defaultName');
    setCreating(true);
    setError('');
    try {
      const created = await getAPI()?.canvas.create(canvasName);
      if (created && created.id) {
        dispatch(addCanvas(created));
        dispatch(setActiveCanvas(created.id));
        setCreated(true);
        onCreated(created.id);
      } else {
        setError(t('onboarding.canvas.error'));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-1">
        <h2 className="text-base font-semibold text-foreground">{t('onboarding.canvas.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('onboarding.canvas.hint')}</p>
      </div>
      {!created ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('onboarding.canvas.nameLabel')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('onboarding.canvas.namePlaceholder')}
              maxLength={60}
              className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {creating ? t('onboarding.canvas.creating') : t('onboarding.canvas.create')}
          </button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4">
          <div className="text-2xl select-none">✓</div>
          <span className="text-sm text-green-500 font-medium">{t('onboarding.canvas.created')}</span>
        </div>
      )}
    </div>
  );
}

// Step 4 — Quick tips
const TIPS = [
  { icon: '🤖', key: 'commander' },
  { icon: '🎨', key: 'presets' },
  { icon: '🖼️', key: 'references' },
  { icon: '📤', key: 'export' },
  { icon: '⌨️', key: 'shortcuts' },
] as const;

function TipsStep() {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-center mb-1">
        <h2 className="text-base font-semibold text-foreground">{t('onboarding.tips.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('onboarding.tips.hint')}</p>
      </div>
      <div className="flex flex-col gap-2">
        {TIPS.map(({ icon, key }) => (
          <div key={key} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
            <span className="text-base select-none shrink-0">{icon}</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-foreground">
                {t(`onboarding.tips.${key}.title`)}
              </span>
              <span className="text-xs text-muted-foreground leading-relaxed">
                {t(`onboarding.tips.${key}.body`)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [createdCanvasId, setCreatedCanvasId] = useState<string | null>(null);

  const currentStep = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  function finish() {
    dispatch(setOnboardingComplete(true));
    if (createdCanvasId) {
      navigate('/');
    }
  }

  function skip() {
    dispatch(setOnboardingComplete(true));
  }

  function next() {
    if (isLast) {
      finish();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  function prev() {
    if (!isFirst) {
      setStepIndex((i) => i - 1);
    }
  }

  // Determine next button label
  let nextLabel: string;
  if (isLast) {
    nextLabel = t('onboarding.action.finish');
  } else if (currentStep === 'welcome') {
    nextLabel = t('onboarding.action.getStarted');
  } else {
    nextLabel = t('onboarding.action.next');
  }

  // Canvas step: next is available only after canvas is created (or they skip)
  const canvasNextDisabled = currentStep === 'canvas' && !createdCanvasId;

  return (
    // Full-screen overlay
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      {/* Card */}
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl flex flex-col">
        {/* Skip button — always visible except on last step */}
        {!isLast && (
          <button
            type="button"
            onClick={skip}
            className="absolute top-3 right-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('onboarding.action.skip')}
          </button>
        )}

        {/* Content area */}
        <div className="p-6 pb-4">
          <StepIndicator current={stepIndex} />
          {currentStep === 'welcome' && <WelcomeStep />}
          {currentStep === 'theme' && <ThemeStep />}
          {currentStep === 'provider' && <ProviderStep />}
          {currentStep === 'canvas' && (
            <CanvasStep onCreated={(id) => setCreatedCanvasId(id)} />
          )}
          {currentStep === 'tips' && <TipsStep />}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={prev}
            disabled={isFirst}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-0 transition-colors"
          >
            {t('onboarding.action.back')}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={canvasNextDisabled}
            className="rounded bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

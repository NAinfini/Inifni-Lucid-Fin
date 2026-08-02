import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ExternalLink, Shield, BarChart3 } from 'lucide-react';
import type { RootState } from '../store/index.js';
import { setCrashReporting, setAnalyticsEnabled } from '../store/slices/settings.js';
import { cn } from '../lib/utils.js';
import { t } from '../i18n.js';
import { ProviderPolicySection } from '../components/settings/ProviderPolicySection.js';

export function SettingsPrivacySection() {
  const dispatch = useDispatch();
  const crashReporting = useSelector((s: RootState) => s.settings.crashReporting);
  const analyticsEnabled = useSelector((s: RootState) => s.settings.analyticsEnabled);

  const handleCrashToggle = useCallback(() => {
    dispatch(setCrashReporting(!crashReporting));
  }, [dispatch, crashReporting]);

  const handleAnalyticsToggle = useCallback(() => {
    const next = !analyticsEnabled;
    dispatch(setAnalyticsEnabled(next));
    void window.lucidAPI.settings.setAnalyticsEnabled(next);
  }, [dispatch, analyticsEnabled]);

  return (
    <div className="space-y-6">
      {/* Crash Reporting */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Shield className="h-3.5 w-3.5" />
          {t('settings.privacy.crashReporting')}
        </h3>

        <div className="rounded-lg border border-border/60 p-4 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={crashReporting}
              onChange={handleCrashToggle}
              className={cn(
                'mt-0.5 h-4 w-4 rounded border-border/60 accent-primary',
                'focus:outline-none focus:ring-2 focus:ring-primary/50',
              )}
            />
            <div className="space-y-1">
              <div className="text-xs font-medium">
                {t('settings.privacy.crashReportingToggle')}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {t('settings.privacy.crashReportingDescription')}
              </p>
            </div>
          </label>

          <div className="rounded-md bg-muted/50 px-3 py-2.5 space-y-1.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t('settings.privacy.whatWeCollect')}
            </div>
            <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
              <li>{t('settings.privacy.collectItems.stackTraces')}</li>
              <li>{t('settings.privacy.collectItems.appVersion')}</li>
              <li>{t('settings.privacy.collectItems.osVersion')}</li>
              <li>{t('settings.privacy.collectItems.electronVersion')}</li>
            </ul>
          </div>

          <div className="rounded-md bg-muted/50 px-3 py-2.5 space-y-1.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t('settings.privacy.whatWeNeverCollect')}
            </div>
            <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
              <li>{t('settings.privacy.neverCollectItems.canvasData')}</li>
              <li>{t('settings.privacy.neverCollectItems.filePaths')}</li>
              <li>{t('settings.privacy.neverCollectItems.apiKeys')}</li>
              <li>{t('settings.privacy.neverCollectItems.identity')}</li>
              <li>{t('settings.privacy.neverCollectItems.history')}</li>
            </ul>
          </div>

          <p className="text-[10px] text-muted-foreground italic">
            {t('settings.privacy.perfTracingNote')}
          </p>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => void window.lucidAPI.openExternal('https://lucid-fin.app/privacy')}
              className="flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t('settings.privacy.learnMore')}
            </button>
          </div>
        </div>
      </div>

      {/* Anonymous Usage Analytics */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <BarChart3 className="h-3.5 w-3.5" />
          {t('settings.privacy.analytics')}
        </h3>

        <div className="rounded-lg border border-border/60 p-4 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={analyticsEnabled}
              onChange={handleAnalyticsToggle}
              className={cn(
                'mt-0.5 h-4 w-4 rounded border-border/60 accent-primary',
                'focus:outline-none focus:ring-2 focus:ring-primary/50',
              )}
            />
            <div className="space-y-1">
              <div className="text-xs font-medium">{t('settings.privacy.analyticsToggle')}</div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {t('settings.privacy.analyticsDescription')}
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Provider Data & Privacy Policies */}
      <ProviderPolicySection />
    </div>
  );
}

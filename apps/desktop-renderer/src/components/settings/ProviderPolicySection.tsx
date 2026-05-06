import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileCheck,
  Shield,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import {
  listProviderPolicies,
  isPolicyOutdated,
  type ProviderPolicy,
} from '../../lib/provider-policy-registry.js';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';

function CommercialUseBadge({ status }: { status: ProviderPolicy['commercialUse'] }) {
  const classMap = {
    yes: 'text-green-400 border-green-400/30 bg-green-400/10',
    no: 'text-red-400 border-red-400/30 bg-red-400/10',
    conditional: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        classMap[status],
      )}
    >
      {t(`settings.providerPolicy.commercialBadge.${status}`)}
    </span>
  );
}

function TrainingOptOutBadge({ status }: { status: ProviderPolicy['trainingOptOut'] }) {
  const iconMap = {
    automatic: ShieldCheck,
    available: Shield,
    'not-available': ShieldQuestion,
  } as const;

  const classMap = {
    automatic: 'text-green-400',
    available: 'text-amber-400',
    'not-available': 'text-muted-foreground',
  } as const;

  const Icon = iconMap[status];

  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px]', classMap[status])}>
      <Icon className="h-3 w-3" />
      {t(`settings.providerPolicy.trainingBadge.${status}`)}
    </span>
  );
}

function PolicyCard({ policy }: { policy: ProviderPolicy }) {
  const [expanded, setExpanded] = useState(false);
  const outdated = isPolicyOutdated(policy);

  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        expanded ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card',
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{policy.displayName}</span>
            <CommercialUseBadge status={policy.commercialUse} />
            {outdated && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {t('settings.providerPolicy.mayBeOutdated')}
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {policy.dataRetention}
          </div>
        </div>
        <div className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-3 border-t border-border/40 px-3 py-2.5">
          {/* Data retention & training */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('settings.providerPolicy.dataRetention')}
              </div>
              <p className="text-[11px] leading-relaxed">{policy.dataRetention}</p>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('settings.providerPolicy.trainingUsage')}
              </div>
              <p className="text-[11px] leading-relaxed">{policy.trainingUsage}</p>
            </div>
          </div>

          {/* Content rights */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('settings.providerPolicy.contentOwnership')}
              </div>
              <p className="text-[11px] leading-relaxed">{policy.contentOwnership}</p>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('settings.providerPolicy.commercialUse')}
              </div>
              <div className="flex items-center gap-2">
                <CommercialUseBadge status={policy.commercialUse} />
              </div>
              {policy.commercialUseNote && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {policy.commercialUseNote}
                </p>
              )}
            </div>
          </div>

          {/* Training opt-out & verified */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('settings.providerPolicy.trainingOptOut')}
              </div>
              <TrainingOptOutBadge status={policy.trainingOptOut} />
            </div>
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('settings.providerPolicy.lastVerified')}
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                <FileCheck className="h-3 w-3 text-muted-foreground" />
                <span className={outdated ? 'text-amber-400' : ''}>{policy.lastVerified}</span>
                {outdated && (
                  <span className="text-[10px] text-amber-400">({t('settings.providerPolicy.mayBeOutdated')})</span>
                )}
              </div>
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={() => void window.lucidAPI.openExternal(policy.privacyPolicyUrl)}
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t('settings.providerPolicy.privacyPolicy')}
            </button>
            <button
              type="button"
              onClick={() => void window.lucidAPI.openExternal(policy.tosUrl)}
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t('settings.providerPolicy.termsOfService')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProviderPolicySection() {
  const policies = listProviderPolicies();

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
        <Shield className="h-3.5 w-3.5" />
        {t('settings.providerPolicy.title')}
      </h3>

      {/* Disclaimer */}
      <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2">
        <p className="text-[10px] text-amber-400 leading-relaxed">
          <strong>Disclaimer:</strong> {t('settings.providerPolicy.disclaimer')}
        </p>
      </div>

      {/* Policy cards */}
      <div className="space-y-2">
        {policies.map((policy) => (
          <PolicyCard key={policy.providerId} policy={policy} />
        ))}
      </div>
    </div>
  );
}

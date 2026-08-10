export type OAuthProviderId = 'chatgpt' | 'gemini';

export type OAuthCapability = 'llm' | 'image' | 'video' | 'vision';

export interface OAuthProviderTarget {
  provider: OAuthProviderId;
  capability: OAuthCapability;
}

export interface OAuthUsageWindow {
  id: string;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMinutes?: number;
  resetsAt?: number;
}

export type OAuthUsage =
  | {
      state: 'available';
      windows: OAuthUsageWindow[];
      credits?: {
        hasCredits: boolean;
        unlimited: boolean;
        balance?: string;
      };
    }
  | {
      state: 'unavailable';
      reason: string;
      dashboardUrl?: string;
    };

type OAuthStatusBase = {
  target: OAuthProviderTarget;
};

/** Renderer-safe OAuth state. Tokens, login URLs, and local profile paths are never exposed. */
export type OAuthProviderStatus =
  | (OAuthStatusBase & {
      state: 'unavailable';
      reason: string;
      setupUrl?: string;
      version?: string;
    })
  | (OAuthStatusBase & {
      state: 'signedOut';
      version?: string;
    })
  | (OAuthStatusBase & {
      state: 'signingIn';
      version?: string;
    })
  | (OAuthStatusBase & {
      state: 'ready';
      planType?: string | null;
      usage: OAuthUsage;
      version?: string;
    })
  | (OAuthStatusBase & {
      state: 'error';
      code:
        | 'configuration_missing'
        | 'wrong_auth_mode'
        | 'capability_unavailable'
        | 'quota_exhausted'
        | 'login_cancelled'
        | 'oauth_failed'
        | 'protocol_error'
        | 'process_exited';
      message: string;
      retryable: boolean;
      version?: string;
    });

export function oauthTargetKey(target: OAuthProviderTarget): string {
  return `${target.provider}:${target.capability}`;
}

export function isOAuthTargetSupported(target: OAuthProviderTarget): boolean {
  return target.provider === 'gemini' || target.capability !== 'video';
}

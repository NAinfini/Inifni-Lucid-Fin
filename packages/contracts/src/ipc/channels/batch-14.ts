import type { OAuthProviderStatus, OAuthProviderTarget } from '../../oauth-provider.js';

export interface ProviderOAuthStatusRequest {
  target: OAuthProviderTarget;
}
export type ProviderOAuthStatusResponse = OAuthProviderStatus;

export interface ProviderOAuthLoginRequest {
  target: OAuthProviderTarget;
}
export type ProviderOAuthLoginResponse = OAuthProviderStatus;

export interface ProviderOAuthCancelLoginRequest {
  target: OAuthProviderTarget;
}
export type ProviderOAuthCancelLoginResponse = OAuthProviderStatus;

export interface ProviderOAuthLogoutRequest {
  target: OAuthProviderTarget;
}
export type ProviderOAuthLogoutResponse = OAuthProviderStatus;

export type ProviderOAuthChangedPayload = OAuthProviderStatus;

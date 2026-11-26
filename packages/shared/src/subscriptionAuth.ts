export const SUBSCRIPTION_PROVIDER_IDS = ['codex', 'xai', 'google'] as const;

export type SubscriptionProviderId = (typeof SUBSCRIPTION_PROVIDER_IDS)[number];

export type SubscriptionAuthStatus = 'logged_out' | 'pending' | 'logged_in' | 'refresh_failed';

export interface SubscriptionAuthPublicStatus {
  providerId: SubscriptionProviderId;
  status: SubscriptionAuthStatus;
  accountLabel: string | null;
  expiresAt: string | null;
  lastError: string | null;
  verificationUrl: string | null;
  authorizationUrl: string | null;
  userCode: string | null;
}

export interface SubscriptionAuthUpdatedEventPayload {
  providerId: SubscriptionProviderId;
  status: SubscriptionAuthStatus;
  accountLabel: string | null;
}

export type GoogleCredentialsSource = 'env' | 'store' | null;
export type GoogleCredentialsClearScope = 'api_key' | 'oauth' | 'all';

export interface GoogleCredentialsPublicStatus {
  apiKeyConfigured: boolean;
  apiKeySource: GoogleCredentialsSource;
  apiKeyEnvName: string | null;
  apiKeyHint: string | null;
  oauthConfigured: boolean;
  oauthSource: GoogleCredentialsSource;
  oauthClientIdHint: string | null;
  cloudProjectId: string | null;
  updatedAt: string | null;
}

export interface SaveGoogleCredentialsInput {
  apiKey?: string | null;
  oauthClientId?: string | null;
  oauthClientSecret?: string | null;
  cloudProjectId?: string | null;
  validate?: boolean;
}

export function isSubscriptionProviderId(value: string): value is SubscriptionProviderId {
  return (SUBSCRIPTION_PROVIDER_IDS as readonly string[]).includes(value);
}

export function subscriptionProviderIdForGeneration(
  providerId: string,
): SubscriptionProviderId | null {
  if (providerId === 'chatgpt') return 'codex';
  if (providerId === 'grok') return 'xai';
  if (providerId === 'google') return 'google';
  return null;
}

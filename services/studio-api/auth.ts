import type {
  GoogleCredentialsClearScope,
  GoogleCredentialsPublicStatus,
  SaveGoogleCredentialsInput,
  SubscriptionAuthPublicStatus,
  SubscriptionProviderId,
} from '../../packages/shared/src';
import { request } from './http';

export async function getSubscriptionAuthStatus(
  providerId: SubscriptionProviderId,
  init?: RequestInit,
) {
  return request<SubscriptionAuthPublicStatus>(`/api/auth/${providerId}`, init);
}

export async function startSubscriptionAuth(providerId: SubscriptionProviderId) {
  return request<SubscriptionAuthPublicStatus>(`/api/auth/${providerId}/start`, {
    method: 'POST',
  });
}

export async function cancelSubscriptionAuth(providerId: SubscriptionProviderId) {
  return request<SubscriptionAuthPublicStatus>(`/api/auth/${providerId}/cancel`, {
    method: 'POST',
  });
}

export async function logoutSubscriptionAuth(providerId: SubscriptionProviderId) {
  return request<SubscriptionAuthPublicStatus>(`/api/auth/${providerId}/logout`, {
    method: 'POST',
  });
}

export async function getGoogleCredentialsStatus(init?: RequestInit) {
  return request<GoogleCredentialsPublicStatus>('/api/auth/google/credentials', init);
}

export async function saveGoogleCredentials(input: SaveGoogleCredentialsInput) {
  return request<GoogleCredentialsPublicStatus>('/api/auth/google/credentials', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function clearGoogleCredentials(scope: GoogleCredentialsClearScope = 'all') {
  const query = scope === 'all' ? '' : `?scope=${encodeURIComponent(scope)}`;
  return request<GoogleCredentialsPublicStatus>(`/api/auth/google/credentials${query}`, {
    method: 'DELETE',
  });
}

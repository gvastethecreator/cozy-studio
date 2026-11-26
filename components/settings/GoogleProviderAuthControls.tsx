import { OpenNewWindow } from 'iconoir-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import type { GoogleCredentialsPublicStatus } from '../../packages/shared/src/subscriptionAuth';
import {
  clearGoogleCredentials,
  getGoogleCredentialsStatus,
  saveGoogleCredentials,
} from '../../services/studio-api/auth';
import { createStudioEventStream } from '../../services/studioEventSource';
import { SubscriptionAuthControls } from './SubscriptionAuthControls';

const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';

const controlBase =
  'inline-flex h-9 items-center justify-center gap-2 rounded-[var(--wb-radius)] px-3 text-[11px] font-semibold transition-[color,background-color,border-color,scale] studio-pressable disabled:cursor-not-allowed disabled:opacity-60';
const controlPrimary = `${controlBase} studio-primary-control`;
const controlGhost = `${controlBase} studio-ghost-control`;
const controlQuiet = `${controlBase} border border-[color:var(--wb-line)] bg-transparent text-[color:var(--wb-muted)] hover:border-rose-500/2 hover:bg-rose-500/10 hover:text-[color:var(--wb-danger)]`;

function validateApiKeyInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Paste a Gemini API key from Google AI Studio.';
  if (trimmed.length < 16 || /\s/.test(trimmed)) {
    return 'That does not look like a valid Gemini API key.';
  }
  return null;
}

export function GoogleProviderAuthControls({
  onCredentialsChanged,
}: {
  onCredentialsChanged?: () => Promise<void> | void;
}) {
  const apiKeyInputId = useId();
  const apiKeyHintId = useId();
  const apiKeyErrorId = useId();
  const oauthClientInputId = useId();
  const oauthClientErrorId = useId();
  const cloudProjectInputId = useId();
  const cloudProjectErrorId = useId();
  const oauthSecretInputId = useId();

  const [credentials, setCredentials] = useState<GoogleCredentialsPublicStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<
    'save-key' | 'clear-key' | 'save-oauth' | 'clear-oauth' | null
  >(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [editingApiKey, setEditingApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeySubmitted, setApiKeySubmitted] = useState(false);

  const [editingOAuth, setEditingOAuth] = useState(false);
  const [oauthClientIdInput, setOAuthClientIdInput] = useState('');
  const [cloudProjectInput, setCloudProjectInput] = useState('');
  const [oauthSecretInput, setOAuthSecretInput] = useState('');
  const [oauthSubmitted, setOAuthSubmitted] = useState(false);

  const loadCredentials = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const next = await getGoogleCredentialsStatus({ signal });
      if (signal?.aborted) return;
      setCredentials(next);
      setServerError(null);
    } catch (loadError) {
      if (signal?.aborted) return;
      setServerError(
        loadError instanceof Error ? loadError.message : 'Unable to load Google credential status.',
      );
    } finally {
      // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- aborted superseded requests must not clear active load
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCredentials(controller.signal);
    return () => controller.abort();
  }, [loadCredentials]);

  useEffect(() => {
    const stream = createStudioEventStream();
    const unsubscribe = stream.onAuthUpdated((payload) => {
      if (payload.providerId !== 'google') return;
      void getGoogleCredentialsStatus()
        .then((next) => setCredentials(next))
        .catch(() => undefined);
    });
    return () => {
      unsubscribe();
      stream.close();
    };
  }, []);

  const apiKeyValidationError =
    apiKeyTouched || apiKeySubmitted ? validateApiKeyInput(apiKeyInput) : null;
  const oauthClientError =
    oauthSubmitted && !oauthClientIdInput.trim() ? 'Enter a Google OAuth Desktop Client ID.' : null;
  const cloudProjectError =
    oauthSubmitted && !cloudProjectInput.trim() ? 'Enter a Google Cloud Project ID.' : null;

  const isBusy = busyAction !== null;
  const showApiKeyForm = !isLoading && (!credentials?.apiKeyConfigured || editingApiKey);
  const showOAuthForm =
    !isLoading &&
    credentials?.oauthSource !== 'env' &&
    (!credentials?.oauthConfigured || editingOAuth);

  const handleSaveApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApiKeySubmitted(true);
    const validationError = validateApiKeyInput(apiKeyInput);
    if (validationError) return;
    setBusyAction('save-key');
    setServerError(null);
    setStatusMessage(null);
    try {
      const next = await saveGoogleCredentials({ apiKey: apiKeyInput.trim(), validate: true });
      setCredentials(next);
      setApiKeyInput('');
      setShowApiKey(false);
      setEditingApiKey(false);
      setApiKeyTouched(false);
      setApiKeySubmitted(false);
      setStatusMessage('Gemini API key verified and saved.');
      await onCredentialsChanged?.();
    } catch (saveError) {
      setServerError(
        saveError instanceof Error ? saveError.message : 'Unable to verify and save API key.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveApiKey = async () => {
    setBusyAction('clear-key');
    setServerError(null);
    setStatusMessage(null);
    try {
      const next = await clearGoogleCredentials('api_key');
      setCredentials(next);
      setEditingApiKey(false);
      setStatusMessage('Saved Gemini API key removed.');
      await onCredentialsChanged?.();
    } catch (clearError) {
      setServerError(
        clearError instanceof Error ? clearError.message : 'Unable to remove saved API key.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveOAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOAuthSubmitted(true);
    if (!oauthClientIdInput.trim() || !cloudProjectInput.trim()) return;
    setBusyAction('save-oauth');
    setServerError(null);
    setStatusMessage(null);
    try {
      const next = await saveGoogleCredentials({
        oauthClientId: oauthClientIdInput.trim(),
        cloudProjectId: cloudProjectInput.trim(),
        oauthClientSecret: oauthSecretInput.trim() || null,
      });
      setCredentials(next);
      setOAuthClientIdInput('');
      setCloudProjectInput('');
      setOAuthSecretInput('');
      setEditingOAuth(false);
      setOAuthSubmitted(false);
      setStatusMessage('Google Cloud OAuth settings saved. You can sign in below.');
      await onCredentialsChanged?.();
    } catch (saveError) {
      setServerError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save Google Cloud OAuth settings.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearOAuth = async () => {
    setBusyAction('clear-oauth');
    setServerError(null);
    setStatusMessage(null);
    try {
      const next = await clearGoogleCredentials('oauth');
      setCredentials(next);
      setEditingOAuth(false);
      setStatusMessage('Saved Google Cloud OAuth settings removed.');
      await onCredentialsChanged?.();
    } catch (clearError) {
      setServerError(
        clearError instanceof Error
          ? clearError.message
          : 'Unable to remove Google Cloud OAuth settings.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="settings-account-auth settings-google-auth">
      <div className="settings-google-key-header">
        <div className="settings-account-identity">
          <span className="settings-account-label">Gemini API key</span>
          {isLoading ? (
            <span className="settings-google-meta">Checking credentials…</span>
          ) : credentials?.apiKeySource === 'env' ? (
            <span className="settings-google-meta">
              {credentials.apiKeyEnvName ?? 'GEMINI_API_KEY'} · {credentials.apiKeyHint ?? 'set'}
            </span>
          ) : credentials?.apiKeySource === 'store' ? (
            <span className="settings-google-meta">
              Saved in Studio · {credentials.apiKeyHint ?? 'configured'}
            </span>
          ) : (
            <span className="settings-google-meta">Not configured</span>
          )}
        </div>
        {!isLoading && credentials?.apiKeySource === 'store' && !editingApiKey ? (
          <div className="settings-google-actions">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setEditingApiKey(true);
                setApiKeyInput('');
                setApiKeyTouched(false);
                setApiKeySubmitted(false);
                setServerError(null);
              }}
              className={controlGhost}
            >
              Replace
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleRemoveApiKey()}
              className={controlQuiet}
            >
              {busyAction === 'clear-key' ? 'Removing…' : 'Remove'}
            </button>
          </div>
        ) : null}
      </div>

      {!isLoading && credentials?.apiKeySource === 'env' ? (
        <p className="settings-google-hint">
          Loaded from your environment. Update or unset{' '}
          {credentials.apiKeyEnvName ?? 'GEMINI_API_KEY'} to change it.
        </p>
      ) : null}

      {showApiKeyForm ? (
        <form
          className="settings-google-form"
          noValidate
          onSubmit={(e) => void handleSaveApiKey(e)}
        >
          <div className="settings-google-field-top">
            <label htmlFor={apiKeyInputId} className="settings-google-field-label">
              API key
            </label>
            <a
              href={AI_STUDIO_KEY_URL}
              target="_blank"
              rel="noreferrer"
              className="settings-google-link"
            >
              Get key in Google AI Studio
              <OpenNewWindow width={12} height={12} aria-hidden="true" />
            </a>
          </div>
          <div className="settings-google-input-row">
            <input
              id={apiKeyInputId}
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              onBlur={() => setApiKeyTouched(true)}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              required
              placeholder="AIza…"
              aria-invalid={Boolean(apiKeyValidationError) || undefined}
              aria-describedby={apiKeyValidationError ? apiKeyErrorId : apiKeyHintId}
              className="studio-field settings-google-input"
            />
            <button
              type="button"
              aria-pressed={showApiKey}
              aria-label={showApiKey ? 'Hide Gemini API key' : 'Show Gemini API key'}
              onClick={() => setShowApiKey((visible) => !visible)}
              className={controlGhost}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {apiKeyValidationError ? (
            <p id={apiKeyErrorId} className="settings-field-error">
              {apiKeyValidationError}
            </p>
          ) : (
            <p id={apiKeyHintId} className="settings-google-hint">
              Saved privately on this machine and verified before saving.
            </p>
          )}
          <div className="settings-google-actions">
            <button type="submit" disabled={isBusy} className={controlPrimary}>
              {busyAction === 'save-key' ? 'Verifying…' : 'Save & verify'}
            </button>
            {editingApiKey ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setEditingApiKey(false);
                  setApiKeyInput('');
                  setShowApiKey(false);
                  setApiKeyTouched(false);
                  setApiKeySubmitted(false);
                }}
                className={controlGhost}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={statusMessage ? 'settings-google-status' : 'sr-only'}
      >
        {statusMessage ?? ''}
      </p>

      {serverError ? (
        <p role="alert" className="text-[12px] leading-relaxed text-[color:var(--wb-danger)]">
          {serverError}
        </p>
      ) : null}

      <details className="settings-provider-advanced">
        <summary>
          Google Cloud OAuth (Advanced)
          {credentials?.oauthConfigured ? <span> · Configured</span> : null}
        </summary>
        <div className="settings-provider-advanced-body">
          <p className="settings-google-hint">
            Optional. Sign in with a Google Cloud OAuth Desktop client and Cloud project instead of
            an AI Studio API key.
          </p>

          {credentials?.oauthConfigured ? (
            <>
              <SubscriptionAuthControls
                providerId="google"
                compact
                optional={credentials.apiKeyConfigured}
              />
              <p className="settings-google-meta">
                Client {credentials.oauthClientIdHint ?? 'set'} · Project{' '}
                {credentials.cloudProjectId ?? 'set'}
                {credentials.oauthSource === 'env' ? ' (environment)' : ''}
              </p>
              {credentials.oauthSource === 'store' && !editingOAuth ? (
                <div className="settings-google-actions">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setEditingOAuth(true);
                      setCloudProjectInput(credentials.cloudProjectId ?? '');
                      setOAuthClientIdInput('');
                      setOAuthSecretInput('');
                      setOAuthSubmitted(false);
                    }}
                    className={controlGhost}
                  >
                    Edit OAuth config
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleClearOAuth()}
                    className={controlQuiet}
                  >
                    {busyAction === 'clear-oauth' ? 'Removing…' : 'Clear OAuth config'}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {showOAuthForm ? (
            <form
              className="settings-google-form"
              noValidate
              onSubmit={(e) => void handleSaveOAuth(e)}
            >
              <label htmlFor={oauthClientInputId} className="settings-google-field-label">
                OAuth Client ID
              </label>
              <input
                id={oauthClientInputId}
                type="text"
                value={oauthClientIdInput}
                onChange={(event) => setOAuthClientIdInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                required
                placeholder="1234567890-abc.apps.googleusercontent.com"
                aria-invalid={Boolean(oauthClientError) || undefined}
                aria-describedby={oauthClientError ? oauthClientErrorId : undefined}
                className="studio-field settings-google-input"
              />
              {oauthClientError ? (
                <p id={oauthClientErrorId} className="settings-field-error">
                  {oauthClientError}
                </p>
              ) : null}

              <label htmlFor={cloudProjectInputId} className="settings-google-field-label">
                Google Cloud Project ID
              </label>
              <input
                id={cloudProjectInputId}
                type="text"
                value={cloudProjectInput}
                onChange={(event) => setCloudProjectInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                required
                placeholder="my-gemini-project"
                aria-invalid={Boolean(cloudProjectError) || undefined}
                aria-describedby={cloudProjectError ? cloudProjectErrorId : undefined}
                className="studio-field settings-google-input"
              />
              {cloudProjectError ? (
                <p id={cloudProjectErrorId} className="settings-field-error">
                  {cloudProjectError}
                </p>
              ) : null}

              <label htmlFor={oauthSecretInputId} className="settings-google-field-label">
                Client Secret (optional)
              </label>
              <input
                id={oauthSecretInputId}
                type="password"
                value={oauthSecretInput}
                onChange={(event) => setOAuthSecretInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                placeholder="Optional for Desktop clients"
                className="studio-field settings-google-input"
              />

              <div className="settings-google-actions">
                <button type="submit" disabled={isBusy} className={controlGhost}>
                  {busyAction === 'save-oauth' ? 'Saving…' : 'Save OAuth config'}
                </button>
                {editingOAuth ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setEditingOAuth(false);
                      setOAuthSubmitted(false);
                    }}
                    className={controlQuiet}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </div>
      </details>
    </div>
  );
}

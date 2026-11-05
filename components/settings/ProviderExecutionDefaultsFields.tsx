import type { ProviderDefaultSettings } from '../../packages/shared/src/studioSettings';
import { useId } from 'react';
import { DIRECT_GIF_IMAGE_MODELS } from '../../packages/shared/src/openaiImageContract';
import {
  CODEX_HTTP_CHAT_MODEL,
  CODEX_HTTP_IMAGE_DISPLAY_NAME,
  CODEX_HTTP_IMAGE_MODELS,
  CODEX_HTTP_MODEL,
  CODEX_HTTP_REASONING,
  isCodexHttpImageModel,
} from '../../packages/shared/src/codexExecutionContract';

function ChatGptExecutionDefaults({
  value,
  onChange,
}: {
  value: ProviderDefaultSettings;
  onChange: (patch: Partial<ProviderDefaultSettings>) => void;
}) {
  const aliasNoteId = useId();
  const incompatible =
    (value.model && value.model !== CODEX_HTTP_CHAT_MODEL) ||
    (value.reasoningEffort && value.reasoningEffort !== CODEX_HTTP_REASONING) ||
    value.serviceTier;
  return (
    <div className="md:col-span-2 space-y-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_4%,transparent)] p-4">
      <p className="text-xs text-[color:var(--wb-ink)]">
        ChatGPT HTTP · {CODEX_HTTP_MODEL.displayName}
      </p>
      <p className="text-xs text-[color:var(--wb-muted)]">Medium quality · Managed execution</p>
      <label className="flex flex-col gap-2">
        <span className="text-xs text-[color:var(--wb-dim)]">Image model</span>
        <select
          aria-label="ChatGPT default image model"
          aria-describedby={aliasNoteId}
          className="studio-input"
          value={value.imageModel ?? ''}
          onChange={(event) =>
            onChange({
              imageModel: isCodexHttpImageModel(event.target.value) ? event.target.value : null,
            })
          }
        >
          <option value="">Studio default ({CODEX_HTTP_IMAGE_DISPLAY_NAME})</option>
          {CODEX_HTTP_IMAGE_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName}
              {model.id.startsWith('gpt-image-2.6-') ? ' (requested alias)' : ''}
            </option>
          ))}
        </select>
      </label>
      <p id={aliasNoteId} className="text-xs text-[color:var(--wb-muted)]">
        The 2.6 names request aliases. ChatGPT may report a generic image model instead.
      </p>
      {incompatible ? (
        <p role="status" className="text-xs text-[color:var(--wb-warning)] ">
          The saved execution defaults do not match HTTP. Apply the current HTTP settings before
          generating.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() =>
          onChange({
            model: CODEX_HTTP_CHAT_MODEL,
            reasoningEffort: CODEX_HTTP_REASONING,
            serviceTier: null,
          })
        }
        className="rounded bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] px-3 py-2 text-xs text-[color:var(--wb-ink)]"
      >
        Apply HTTP execution settings
      </button>
    </div>
  );
}

function ProviderModelField({
  value,
  onChange,
  availableModels,
  providerDefaultModel,
  isAgentCli,
}: {
  value: ProviderDefaultSettings;
  onChange: (patch: Partial<ProviderDefaultSettings>) => void;
  availableModels?: string[];
  providerDefaultModel?: string | null;
  isAgentCli: boolean;
}) {
  const suggestionsId = useId();
  const isOpenAI = value.providerId === 'openai';
  const modelOptions = availableModels ?? [];
  const storedModel = value.model?.trim() || '';
  const unavailableModel = storedModel && !modelOptions.includes(storedModel);
  const hasModels = !isOpenAI && modelOptions.length > 0;
  const defaultSource = isAgentCli ? 'CLI' : 'Provider';
  const defaultLabel = providerDefaultModel
    ? `${defaultSource} default (${providerDefaultModel})`
    : `${defaultSource} default`;
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
        Model
      </span>
      {hasModels ? (
        <select
          value={value.model ?? ''}
          onChange={(event) => onChange({ model: event.target.value.trim() || null })}
          aria-label="Provider default model"
          className="h-10 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 font-mono text-xs text-[color:var(--wb-ink)] outline-none transition-colors focus:border-accent-400/2"
        >
          <option value="">{defaultLabel}</option>
          {unavailableModel ? (
            <option value={storedModel}>{storedModel} (unavailable)</option>
          ) : null}
          {modelOptions.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            value={value.model ?? ''}
            onChange={(event) => onChange({ model: event.target.value.trim() || null })}
            placeholder={isOpenAI ? defaultLabel : 'Provider default'}
            list={isOpenAI ? suggestionsId : undefined}
            aria-label="Provider default model"
            className="h-10 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 font-mono text-xs text-[color:var(--wb-ink)] outline-none transition-colors placeholder:text-[color:var(--wb-dim)] focus:border-accent-400/2"
          />
          {isOpenAI ? (
            <datalist id={suggestionsId}>
              {DIRECT_GIF_IMAGE_MODELS.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
      {hasModels && unavailableModel ? (
        <p
          role="status"
          className="text-[length:var(--wbp-label)] leading-relaxed text-[color:var(--wb-warning)] "
        >
          {storedModel} is not in the current provider model list. Choose the provider default or a
          listed model.
        </p>
      ) : null}
    </label>
  );
}

export function ProviderExecutionDefaultsFields({
  value,
  onChange,
  availableModels,
  providerDefaultModel,
}: {
  value: ProviderDefaultSettings;
  onChange: (patch: Partial<ProviderDefaultSettings>) => void;
  availableModels?: string[];
  providerDefaultModel?: string | null;
}) {
  if (value.providerId === 'chatgpt')
    return <ChatGptExecutionDefaults value={value} onChange={onChange} />;

  const isAgentCli = value.providerId === 'grok' || value.providerId === 'antigravity';

  return (
    <div className="md:col-span-2 grid gap-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_4%,transparent)] p-4 md:grid-cols-3">
      <div className="md:col-span-3">
        <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-muted)]">
          Execution defaults
        </div>
        <p className="mt-1 text-[length:var(--wbp-label)] leading-relaxed text-[color:var(--wb-dim)]">
          Used unless a generation overrides them. Leave blank to use provider defaults.
        </p>
      </div>
      <ProviderModelField
        value={value}
        onChange={onChange}
        availableModels={availableModels}
        providerDefaultModel={providerDefaultModel}
        isAgentCli={isAgentCli}
      />
      <label className="flex flex-col gap-2">
        <span className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
          Reasoning
        </span>
        {isAgentCli ? (
          <select
            value={value.reasoningEffort ?? ''}
            onChange={(event) => onChange({ reasoningEffort: event.target.value.trim() || null })}
            aria-label="Provider default reasoning effort"
            className="h-10 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 text-xs font-semibold tracking-normal text-[color:var(--wb-ink)] outline-none transition-colors focus:border-accent-400/2"
          >
            <option value="">Provider default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        ) : (
          <input
            value={value.reasoningEffort ?? ''}
            onChange={(event) => onChange({ reasoningEffort: event.target.value.trim() || null })}
            placeholder="Provider default"
            aria-label="Provider default reasoning effort"
            className="h-10 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 font-mono text-xs text-[color:var(--wb-ink)] outline-none transition-colors placeholder:text-[color:var(--wb-dim)] focus:border-accent-400/2"
          />
        )}
      </label>
      {isAgentCli ? null : (
        <label className="flex flex-col gap-2">
          <span className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
            Service Tier
          </span>
          <select
            value={value.serviceTier ?? ''}
            onChange={(event) =>
              onChange({
                serviceTier:
                  event.target.value === 'fast' || event.target.value === 'flex'
                    ? event.target.value
                    : null,
              })
            }
            aria-label="Provider default service tier"
            className="h-10 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 text-xs font-semibold tracking-normal text-[color:var(--wb-ink)] outline-none transition-colors focus:border-accent-400/2"
          >
            <option value="">Provider default</option>
            <option value="fast">Fast</option>
            <option value="flex">Flex</option>
          </select>
        </label>
      )}
    </div>
  );
}

import type { CompiledProviderInput, GenerationProviderId } from '../../../../packages/shared/src';
import { compileCodexImagegenInput, compileChatgptImageInput } from './openaiImageInput';
import { compileAntigravityImageInput } from './antigravityImageInput';
import { compileDryRunInput } from './dryRunProvider';
import { compileGrokImagineInput } from './grokImagineInput';
import {
  compileComfyWorkflowInput,
  compileFalImageApiInput,
  compileGoogleImageApiInput,
  compileOpenaiImageApiInput,
  compileReplicateImageApiInput,
} from './externalProviderInputs';
import type { GenerationProviderJob } from './types';
import { collectDirectGifJobIssues } from '../../../../packages/shared/src/openaiImageContract';

export type ProviderInputCompiler = (job: GenerationProviderJob) => CompiledProviderInput;

const PROVIDER_INPUT_COMPILERS = {
  codex: compileCodexImagegenInput,
  chatgpt: compileChatgptImageInput,
  grok: compileGrokImagineInput,
  antigravity: compileAntigravityImageInput,
  dry_run: compileDryRunInput,
  google: compileGoogleImageApiInput,
  fal: compileFalImageApiInput,
  openai: compileOpenaiImageApiInput,
  replicate: compileReplicateImageApiInput,
  comfy: compileComfyWorkflowInput,
} satisfies Record<string, ProviderInputCompiler>;

export type CompilableProviderId = keyof typeof PROVIDER_INPUT_COMPILERS;

export function hasProviderInputCompiler(
  providerId: GenerationProviderId,
): providerId is CompilableProviderId {
  return providerId in PROVIDER_INPUT_COMPILERS;
}

export function compileProviderInputForJob(
  providerId: GenerationProviderId,
  job: GenerationProviderJob,
): CompiledProviderInput {
  const compiler = PROVIDER_INPUT_COMPILERS[providerId as CompilableProviderId];

  if (!compiler) {
    throw new Error(`No provider input compiler registered for "${providerId}".`);
  }

  const gifIssues = collectDirectGifJobIssues({
    providerId,
    imageModel: job.execution?.model,
    sourceSpec: job.sourceSpec,
  });
  if (gifIssues.length > 0) throw new Error(gifIssues[0]!.message);

  return compiler(job);
}

import { runProviderCliProcess } from './providerCliProcess';
import { providerPromise, providerSync, type ProviderEffect } from './providerEffect';
import { Effect, Result } from 'effect';
import { providerOperation } from './providerEffect';
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAntigravityChildEnvironment,
  resolveAntigravityExecutable,
  resolveAntigravityHome,
} from '../antigravityExecutable';
import {
  loadAntigravityRuntimeDoctor,
  type AntigravityRuntimeDoctorReport,
} from '../antigravityRuntimeDoctor';
import { resolveLibraryPath, resolveLibraryPathFromRoot } from '../library';
import { isManagedGenerationAssetPath } from '../managedAssetPolicy';
import { isPathInside } from '../pathContainment';
import type { JobLibraryContext } from '../../../../packages/shared/src';
import type {
  ExternalProviderExecutionContext,
  ExternalProviderExecutor,
} from './externalProvider';
import { isRecord, storeInlineImageResult } from './externalProviderResults';
import type {
  AntigravityImageCompiledInput,
  AntigravityImageCompiledPayload,
} from './antigravityImageInput';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_SOURCE_IMAGES = 10;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/;
const TEMPORARY_DIRECTORY_PREFIX = 'cozy-studio-antigravity-';

export interface AntigravityCliRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunAntigravityCliInput {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface AntigravityImageExecutorDependencies {
  env?: NodeJS.ProcessEnv;
  runCli?: (input: RunAntigravityCliInput) => ProviderEffect<AntigravityCliRunResult>;
  readRuntimeDoctor?: () =>
    | AntigravityRuntimeDoctorReport
    | Promise<AntigravityRuntimeDoctorReport>;
  resolveExecutable?: typeof resolveAntigravityExecutable;
  resolveHome?: typeof resolveAntigravityHome;
  resolveDefaultLibraryPath?: typeof resolveLibraryPath;
  now?: () => number;
  createTemporaryDirectory?: () => string;
}

interface ParsedAntigravityStream {
  conversationId: string;
  cwd: string;
  resultStatus: string;
  toolStepCount: number;
  eventTypes: string[];
  imageToolMode: 'generate_image' | 'image-generator';
  reportedPaths: string[];
}

export function runAntigravityCliProcess(
  input: RunAntigravityCliInput,
): ProviderEffect<AntigravityCliRunResult> {
  return runProviderCliProcess({
    ...input,
    timeoutMessage: `Antigravity image generation timed out after ${input.timeoutMs} ms.`,
    outputLimitMessage: 'Antigravity output exceeded the safe process buffer limit.',
    maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
  });
}

function normalizeComparablePath(value: string) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function assertOwnedTemporaryDirectory(candidate: string) {
  const resolved = path.resolve(candidate);
  const info = lstatSync(resolved);
  const realTemporaryRoot = realpathSync(os.tmpdir());
  const realCandidate = realpathSync(resolved);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    !path.basename(resolved).startsWith(TEMPORARY_DIRECTORY_PREFIX) ||
    !isPathInside(realTemporaryRoot, realCandidate)
  ) {
    throw new Error('Antigravity temporary workspace is not a Studio-owned directory.');
  }
  return realCandidate;
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

function stageManagedSources(
  payload: AntigravityImageCompiledPayload,
  libraryRoot: string,
  temporaryDirectory: string,
  libraryContext?: JobLibraryContext | null,
) {
  const assets = payload.assets.filter((asset) => asset.role !== 'mask');
  if (assets.length > MAX_SOURCE_IMAGES) {
    throw new Error(
      `Antigravity supports at most ${MAX_SOURCE_IMAGES} managed source images per Job.`,
    );
  }
  if (payload.operation === 'image_edit' && assets.length === 0) {
    throw new Error('Antigravity image editing requires at least one managed source image.');
  }
  if (payload.operation === 'image_generate' && assets.length > 0) {
    throw new Error('Antigravity image generation cannot include source images.');
  }
  const realLibraryRoot = realpathSync(libraryRoot);
  const inputDirectory = path.join(temporaryDirectory, 'inputs');
  mkdirSync(inputDirectory, { recursive: true });
  return assets.map((asset, index) => {
    if (asset.hasInlineData || asset.sourceUrl || !asset.localPath) {
      throw new Error(
        `Antigravity asset "${asset.name}" must be imported into the Studio Library before execution.`,
      );
    }
    const sourcePath = path.resolve(asset.localPath);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`Antigravity source image does not exist: ${sourcePath}.`);
    }
    const extension = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Antigravity source image must be PNG, JPEG, GIF, or WebP: ${sourcePath}.`);
    }
    const realSourcePath = realpathSync(sourcePath);
    const allowedSource =
      isPathInside(realLibraryRoot, realSourcePath) ||
      (libraryContext ? isManagedGenerationAssetPath(realSourcePath, libraryContext) : false);
    if (!allowedSource) {
      throw new Error(`Antigravity source image is outside the Job Studio Library: ${sourcePath}.`);
    }
    const stagedPath = path.join(
      inputDirectory,
      `${String(index + 1).padStart(2, '0')}-${sanitizeFilePart(path.basename(sourcePath, extension))}${extension}`,
    );
    copyFileSync(realSourcePath, stagedPath, fsConstants.COPYFILE_EXCL);
    return { ...asset, localPath: stagedPath };
  });
}

export function buildAntigravityImagePrompt(
  payload: AntigravityImageCompiledPayload,
  stagedSources: ReturnType<typeof stageManagedSources>,
) {
  const constraints = [payload.prompt];
  if (payload.output.aspectRatio) {
    constraints.push(`Requested aspect ratio: ${payload.output.aspectRatio}.`);
  }
  if (payload.output.imageSize) {
    constraints.push(`Requested image size: ${payload.output.imageSize}.`);
  }
  return [
    'Generate the requested image using ONLY generate_image or the built-in image-generator subagent (invoke_subagent with TypeName "image-generator").',
    'Invoke it once. After calling invoke_subagent, end your turn with no further tool calls and wait for its reply.',
    'Do NOT call view_file, list_dir, wait, wait_5_seconds, manage_subagents, run_command, or any other tool or subagent before or after image generation.',
    'Produce exactly one final image. Do not return success unless image generation completes.',
    '',
    'Use these arguments:',
    `Prompt: ${JSON.stringify(constraints.join('\n\n'))}`,
    'ImageName: "studio-output.png"',
    ...(stagedSources.length > 0
      ? [`ImagePaths: ${JSON.stringify(stagedSources.map((source) => source.localPath))}`]
      : []),
    '',
    'As soon as image generation completes, immediately return only the saved image file path and a brief factual summary without calling any other tool.',
  ].join('\n');
}

export function buildAntigravityImageArgs(payload: AntigravityImageCompiledPayload) {
  const args = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--sandbox',
    '--disable-slash-commands',
    '--mode',
    'accept-edits',
    '--print-timeout',
    '15m',
  ];
  if (payload.model) args.push('--model', payload.model);
  if (payload.reasoningEffort) {
    if (!['low', 'medium', 'high'].includes(payload.reasoningEffort)) {
      throw new Error('Antigravity reasoning effort must be low, medium, or high.');
    }
    args.push('--effort', payload.reasoningEffort);
  }
  return args;
}

function isImageGeneratorSubagentStep(step: Record<string, unknown>) {
  if (step.tool_name !== 'invoke_subagent') return false;
  if (step.step_type === 'subagent') {
    const subagentInfo = isRecord(step.subagent_info) ? step.subagent_info : null;
    const subagents = Array.isArray(subagentInfo?.subagents) ? subagentInfo.subagents : [];
    return (
      subagents.length === 1 &&
      subagents.every(
        (entry) =>
          isRecord(entry) &&
          (entry.type_name === 'image-generator' ||
            entry.typeName === 'image-generator' ||
            entry.TypeName === 'image-generator'),
      )
    );
  }
  const toolInfo = isRecord(step.tool_info) ? step.tool_info : null;
  if (!toolInfo) return false;
  const directCandidates = [
    toolInfo.type_name,
    toolInfo.typeName,
    toolInfo.TypeName,
    toolInfo.subagent,
    toolInfo.subagent_type,
    isRecord(toolInfo.arguments) ? toolInfo.arguments.TypeName : null,
    isRecord(toolInfo.arguments) ? toolInfo.arguments.type_name : null,
    isRecord(toolInfo.input) ? toolInfo.input.TypeName : null,
    isRecord(toolInfo.input) ? toolInfo.input.type_name : null,
    isRecord(toolInfo.params) ? toolInfo.params.TypeName : null,
  ];
  if (directCandidates.some((value) => value === 'image-generator')) return true;
  if (typeof toolInfo.arguments === 'string') {
    try {
      const parsed = JSON.parse(toolInfo.arguments) as unknown;
      if (
        isRecord(parsed) &&
        (parsed.TypeName === 'image-generator' || parsed.type_name === 'image-generator')
      ) {
        return true;
      }
    } catch {
      // Ignore malformed JSON strings; rejected below.
    }
  }
  return false;
}

function isAllowedImageToolStep(step: Record<string, unknown>) {
  return step.tool_name === 'generate_image' || isImageGeneratorSubagentStep(step);
}

function normalizeMentionedPath(raw: string): string {
  if (/^file:\/\//i.test(raw)) {
    const stripped = decodeURIComponent(raw.replace(/^file:\/\//i, ''));
    return /^\/[A-Za-z]:[\\/]/.test(stripped) ? stripped.slice(1) : stripped;
  }
  return raw;
}

function extractMentionedImagePaths(texts: readonly unknown[]): string[] {
  const candidates: string[] = [];
  const pattern =
    /(?:file:\/\/\/(?:[A-Za-z]:[\\/]|\/)|[A-Za-z]:[\\/]|\/)[^\s"'`<>|()[\]]+\.(?:png|jpe?g|webp|gif)\b/gi;
  for (const value of texts) {
    if (typeof value !== 'string' || !value) continue;
    for (const match of value.matchAll(pattern)) {
      candidates.push(normalizeMentionedPath(match[0]));
    }
  }
  return [...new Set(candidates)];
}

export function parseAntigravityStream(output: string): ParsedAntigravityStream {
  const events = output.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed) || typeof parsed.event !== 'string') throw new Error('invalid');
      return [parsed];
    } catch {
      throw new Error(`Antigravity returned invalid stream JSON at line ${index + 1}.`);
    }
  });
  const initEvents = events.filter((event) => event.event === 'init');
  const resultEvents = events.filter((event) => event.event === 'result');
  if (
    initEvents.length !== 1 ||
    resultEvents.length !== 1 ||
    events[0]?.event !== 'init' ||
    events.at(-1)?.event !== 'result'
  ) {
    throw new Error('Antigravity stream requires exactly one init event and one result event.');
  }
  const init = initEvents[0]!;
  const conversationId = typeof init.conversation_id === 'string' ? init.conversation_id : '';
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error('Antigravity stream returned an invalid conversation id.');
  }
  const initPayload = isRecord(init.init) ? init.init : null;
  if (!initPayload || initPayload.permission_mode !== 'request-review') {
    throw new Error('Antigravity did not use the required request-review permission mode.');
  }
  const tools = Array.isArray(initPayload.tools) ? initPayload.tools : [];
  if (!tools.includes('generate_image') && !tools.includes('invoke_subagent')) {
    throw new Error('Antigravity did not expose the generate_image tool for this run.');
  }
  const cwd = typeof initPayload.cwd === 'string' ? initPayload.cwd.trim() : '';
  if (!cwd || !path.isAbsolute(cwd)) {
    throw new Error('Antigravity did not report an absolute workspace path.');
  }
  const toolSteps = events.flatMap((event) => {
    if (event.event !== 'step_update' || !isRecord(event.step_update)) return [];
    const stepType = event.step_update.step_type;
    return stepType === 'tool' || stepType === 'subagent' ? [event.step_update] : [];
  });
  const disallowedSteps = toolSteps.filter((step) => !isAllowedImageToolStep(step));
  if (disallowedSteps.length > 0) {
    const names = [
      ...new Set(
        disallowedSteps.map((step) =>
          typeof step.tool_name === 'string' && step.tool_name.trim()
            ? step.tool_name.trim()
            : 'unknown',
        ),
      ),
    ];
    throw new Error(`Antigravity called a tool other than generate_image (${names.join(', ')}).`);
  }
  if (
    toolSteps.some(
      (step) =>
        step.conversation_id !== conversationId ||
        !Number.isInteger(step.step_index) ||
        Number(step.step_index) < 0,
    )
  ) {
    throw new Error('Antigravity returned a tool step for an unexpected conversation.');
  }
  const toolCallIndexes = new Set(toolSteps.map((step) => Number(step.step_index)));
  if (toolCallIndexes.size !== 1) {
    throw new Error(
      `Antigravity expected one generate_image call and found ${toolCallIndexes.size}.`,
    );
  }
  const completedImageSteps = toolSteps.filter(
    (step) => isAllowedImageToolStep(step) && step.state === 'DONE',
  );
  if (completedImageSteps.length !== 1) {
    throw new Error(
      `Antigravity expected one completed generate_image call and found ${completedImageSteps.length}.`,
    );
  }
  const completedStep = completedImageSteps[0]!;
  let toolOutput: unknown = null;
  if (completedStep.step_type === 'subagent') {
    const subagentInfo = completedStep.subagent_info;
    if (
      !isRecord(subagentInfo) ||
      subagentInfo.error != null ||
      !isImageGeneratorSubagentStep(completedStep)
    ) {
      throw new Error('Antigravity generate_image did not complete successfully.');
    }
    toolOutput = subagentInfo.output ?? null;
  } else {
    const toolInfo = completedStep.tool_info;
    if (
      !isRecord(toolInfo) ||
      (toolInfo.name !== 'generate_image' && toolInfo.name !== 'invoke_subagent') ||
      toolInfo.error != null
    ) {
      throw new Error('Antigravity generate_image did not complete successfully.');
    }
    toolOutput = toolInfo.output ?? null;
  }
  const result = resultEvents[0]!.result;
  const numTurns = isRecord(result) && typeof result.num_turns === 'number' ? result.num_turns : 0;
  if (!isRecord(result) || result.status !== 'SUCCESS' || numTurns < 1 || numTurns > 3) {
    throw new Error('Antigravity image generation did not finish with SUCCESS.');
  }
  if (result.conversation_id !== conversationId) {
    throw new Error('Antigravity result used an unexpected conversation id.');
  }
  const imageToolMode =
    completedStep.tool_name === 'invoke_subagent' ? 'image-generator' : 'generate_image';
  return {
    conversationId,
    cwd,
    resultStatus: result.status,
    toolStepCount: toolSteps.length,
    eventTypes: events.map((event) => event.event as string),
    imageToolMode,
    reportedPaths: extractMentionedImagePaths([toolOutput, result.response]),
  };
}

function resolveArtifactDirectory(home: string, conversationId: string) {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error('Antigravity conversation id cannot identify an artifact directory.');
  }
  const brainDirectory = path.join(home, 'brain');
  const artifactDirectory = path.join(brainDirectory, conversationId);
  if (!existsSync(artifactDirectory)) return artifactDirectory;
  const realBrainDirectory = realpathSync(brainDirectory);
  const realArtifactDirectory = realpathSync(artifactDirectory);
  if (!isPathInside(realBrainDirectory, realArtifactDirectory)) {
    throw new Error('Antigravity artifact directory escaped its configured brain directory.');
  }
  return realArtifactDirectory;
}

function listArtifactImages(artifactDirectory: string) {
  if (!existsSync(artifactDirectory) || !statSync(artifactDirectory).isDirectory()) return [];
  const realRoot = realpathSync(artifactDirectory);
  const pending = [realRoot];
  const images: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.system_generated' || entry.name === '.user_uploaded') continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const realTarget = realpathSync(target);
        if (!isPathInside(realRoot, realTarget)) {
          throw new Error('Antigravity artifact image escaped its conversation directory.');
        }
        images.push(realTarget);
      }
    }
  }
  return images.sort((left, right) => left.localeCompare(right));
}

function selectAntigravityArtifactImage(
  images: readonly string[],
  reportedPaths: readonly string[],
): string {
  if (images.length === 0) {
    throw new Error('Antigravity expected one generated image and found 0.');
  }
  if (images.length === 1) return images[0]!;
  const comparableByImage = new Map(images.map((image) => [normalizeComparablePath(image), image]));
  for (const reported of reportedPaths) {
    try {
      if (!existsSync(reported)) continue;
      const realReported = realpathSync(reported);
      const matched = comparableByImage.get(normalizeComparablePath(realReported));
      if (matched) return matched;
    } catch {
      // Ignore unresolvable paths from model prose and fall back to newest artifact.
    }
  }
  return [...images].sort((left, right) => {
    const mtimeDelta = statSync(right).mtimeMs - statSync(left).mtimeMs;
    return mtimeDelta !== 0 ? mtimeDelta : right.localeCompare(left);
  })[0]!;
}

function configuredTimeoutMs(env: NodeJS.ProcessEnv) {
  const value = Number(env.STUDIO_ANTIGRAVITY_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 30_000 && value <= 3_600_000
    ? value
    : DEFAULT_TIMEOUT_MS;
}

export function createAntigravityImageExecutor({
  env = process.env,
  runCli = runAntigravityCliProcess,
  readRuntimeDoctor = loadAntigravityRuntimeDoctor,
  resolveExecutable = resolveAntigravityExecutable,
  resolveHome = resolveAntigravityHome,
  resolveDefaultLibraryPath = resolveLibraryPath,
  now = () => Date.now(),
  createTemporaryDirectory = () => mkdtempSync(path.join(os.tmpdir(), 'cozy-studio-antigravity-')),
}: AntigravityImageExecutorDependencies = {}): ExternalProviderExecutor {
  return ({ providerId, job, compiledInput }: ExternalProviderExecutionContext) =>
    providerOperation(
      Effect.gen(function* () {
        if (
          providerId !== 'antigravity' ||
          compiledInput.providerId !== 'antigravity' ||
          compiledInput.payloadKind !== 'agent_cli_prompt'
        ) {
          throw new Error('Antigravity executor received unsupported provider input.');
        }
        const input = compiledInput as AntigravityImageCompiledInput;
        if (input.payload.output.count !== 1) {
          throw new Error('Antigravity requires exactly one output image per Job.');
        }
        const runtime = yield* providerPromise(async () => readRuntimeDoctor());
        if (!runtime.canRunJobs) {
          throw new Error(`Antigravity runtime is not ready: ${runtime.recommendedAction}`);
        }
        if (input.payload.model && !runtime.availableModels.includes(input.payload.model)) {
          throw new Error(
            `Antigravity model "${input.payload.model}" is unavailable. Available models: ${runtime.availableModels.join(', ') || 'none'}.`,
          );
        }
        const startedAt = now();
        const libraryRoot = job.libraryContext?.rootPath ?? resolveDefaultLibraryPath();
        const temporaryDirectory = yield* Effect.acquireRelease(
          providerSync(() => assertOwnedTemporaryDirectory(createTemporaryDirectory())),
          (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
        );
        const stagedSources = stageManagedSources(
          input.payload,
          libraryRoot,
          temporaryDirectory,
          job.libraryContext,
        );
        const prompt = buildAntigravityImagePrompt(input.payload, stagedSources);
        const stdin = `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`;
        const executable = resolveExecutable(env);
        const result = Result.getOrThrowWith(
          yield* Effect.result(
            runCli({
              executable,
              args: buildAntigravityImageArgs(input.payload),
              cwd: temporaryDirectory,
              env: createAntigravityChildEnvironment(env),
              stdin,
              signal: job.signal,
              timeoutMs: configuredTimeoutMs(env),
            }),
          ),
          (error) => error,
        );
        if (result.status !== 0) {
          throw new Error(
            `Antigravity image generation failed with exit ${result.status}. Check the local CLI login and runtime logs.`,
          );
        }
        const stream = parseAntigravityStream(result.stdout);
        if (
          normalizeComparablePath(realpathSync(stream.cwd)) !==
          normalizeComparablePath(temporaryDirectory)
        ) {
          throw new Error('Antigravity reported an unexpected execution workspace.');
        }
        const artifactDirectory = resolveArtifactDirectory(resolveHome(env), stream.conversationId);
        const images = listArtifactImages(artifactDirectory);
        const imagePath = selectAntigravityArtifactImage(images, stream.reportedPaths);
        const imageSize = statSync(imagePath).size;
        if (imageSize <= 0) throw new Error('Antigravity generated an empty image file.');
        if (imageSize > MAX_IMAGE_BYTES) {
          throw new Error('Antigravity generated an image larger than the 25 MB limit.');
        }
        const libraryPath = (...segments: string[]) =>
          job.libraryContext
            ? resolveLibraryPathFromRoot(job.libraryContext.rootPath, ...segments)
            : resolveDefaultLibraryPath(...segments);
        return Result.getOrThrowWith(
          yield* Effect.result(
            storeInlineImageResult({
              providerId: 'antigravity',
              providerSlug: 'antigravity',
              model: input.payload.model || 'cli-default',
              endpointBase: 'local://antigravity-cli',
              job,
              compiledInput,
              responseJson: { events: stream.eventTypes, status: stream.resultStatus },
              image: { data: readFileSync(imagePath).toString('base64'), mimeType: null },
              requestAttempts: 1,
              startedAt,
              diagnostics: {
                runtimeKind: 'agent_cli',
                executable,
                cliVersion: runtime.selectedVersionNumber,
                conversationId: stream.conversationId,
                artifactDirectory,
                sourceAssetCount: stagedSources.length,
                toolStepCount: stream.toolStepCount,
                imageToolMode: stream.imageToolMode,
                candidateArtifactCount: images.length,
              },
              files: {
                resolveLibraryPath: libraryPath,
                mkdir: mkdirSync,
                writeFile: writeFileSync,
                now,
              },
            }),
          ),
          (error) => error,
        );
      }),
    );
}

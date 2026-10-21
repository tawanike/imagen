import { randomUUID } from 'node:crypto';
import { A2A_PROTOCOL_VERSION, Role, TaskState, type AgentCard, type Message, type Part } from '@a2a-js/sdk';
import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { GenerateOptions, ImagenService } from '../service.js';
import type { ImageInput } from '../types.js';
import { errorMessage, loadImageInput } from '../util.js';

export function buildAgentCard(service: ImagenService, baseUrl: string): AgentCard {
  const models = service.registry.listModels().filter((m) => m.configured);
  return {
    name: 'imagen',
    description:
      'Local image generation agent. Send a text prompt (optionally with image parts to edit, and a data part with {model, aspectRatio, size, n, quality, seed, outputFormat}) and receive generated images as artifacts.',
    version: '0.1.0',
    provider: { organization: 'local', url: baseUrl },
    documentationUrl: `${baseUrl}/`,
    supportedInterfaces: [
      { url: `${baseUrl}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION, tenant: '' },
      { url: `${baseUrl}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '0.3', tenant: '' },
    ],
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain', 'application/json', 'image/png', 'image/jpeg', 'image/webp'],
    defaultOutputModes: ['image/png', 'image/jpeg', 'image/webp', 'application/json'],
    signatures: [],
    skills: [
      {
        id: 'generate_image',
        name: 'Generate image',
        description: `Text-to-image and image editing. Configured models: ${models.map((m) => m.qualified).join(', ') || 'none (set API keys)'}.`,
        tags: ['image', 'generation', 'editing', 'gemini', 'nano-banana', 'gpt-image', 'flux', 'azure'],
        examples: [
          'A flat vector icon of a smart kitchen scale, teal and white, transparent background',
          'Hero banner for a recipe app, 16:9, warm morning light, photographic',
        ],
        inputModes: ['text/plain', 'application/json', 'image/png', 'image/jpeg'],
        outputModes: ['image/png', 'image/jpeg', 'application/json'],
        securityRequirements: [],
      },
    ],
  };
}

const PARAM_KEYS = ['model', 'n', 'aspectRatio', 'aspect_ratio', 'size', 'quality', 'seed', 'outputFormat', 'output_format', 'background', 'outputDir', 'output_dir', 'filename', 'extra'] as const;

/** Turns an A2A user message into GenerateOptions. */
export async function messageToOptions(message: Message): Promise<GenerateOptions> {
  const texts: string[] = [];
  const references: ImageInput[] = [];
  const referencePaths: string[] = [];
  let params: Record<string, unknown> = {};
  for (const part of message.parts ?? []) {
    const c = part.content;
    if (!c) continue;
    switch (c.$case) {
      case 'text':
        texts.push(c.value);
        break;
      case 'data':
        if (c.value && typeof c.value === 'object' && !Array.isArray(c.value)) {
          const obj = c.value as Record<string, unknown>;
          if (typeof obj.prompt === 'string') texts.push(obj.prompt);
          params = { ...params, ...obj };
        }
        break;
      case 'raw':
        references.push({ data: Buffer.from(c.value), mimeType: part.mediaType || 'image/png', name: part.filename || undefined });
        break;
      case 'url':
        if (part.mediaType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(c.value) || c.value.startsWith('data:image/')) {
          references.push(await loadImageInput(c.value));
        } else {
          referencePaths.push(c.value);
        }
        break;
    }
  }
  const prompt = texts.join('\n').trim();
  const pick = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) if (params[k] !== undefined) return params[k] as T;
    return undefined;
  };
  void PARAM_KEYS;
  return {
    prompt,
    model: pick('model'),
    n: pick('n'),
    aspectRatio: pick('aspectRatio', 'aspect_ratio'),
    size: pick('size'),
    quality: pick('quality'),
    seed: pick('seed'),
    outputFormat: pick('outputFormat', 'output_format'),
    background: pick('background'),
    outputDir: pick('outputDir', 'output_dir'),
    filename: pick('filename'),
    extra: pick('extra'),
    references,
    referencePaths: referencePaths.length ? referencePaths : undefined,
  };
}

export class ImagenAgentExecutor implements AgentExecutor {
  private readonly cancelled = new Set<string>();

  constructor(private readonly service: ImagenService) {}

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = ctx;
    const now = () => new Date().toISOString();
    const agentText = (text: string): Message => ({
      messageId: randomUUID(),
      contextId,
      taskId,
      role: Role.ROLE_AGENT,
      parts: [textPart(text)],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    });

    if (!ctx.task) {
      bus.publish({
        kind: 'task',
        data: { id: taskId, contextId, status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: now() }, artifacts: [], history: [ctx.userMessage], metadata: undefined },
      });
    }

    let opts: GenerateOptions;
    try {
      opts = await messageToOptions(ctx.userMessage);
    } catch (err) {
      bus.publish({ kind: 'statusUpdate', data: { taskId, contextId, status: { state: TaskState.TASK_STATE_FAILED, message: agentText(`Could not read request: ${errorMessage(err)}`), timestamp: now() }, metadata: undefined } });
      bus.finished();
      return;
    }
    if (!opts.prompt) {
      bus.publish({ kind: 'statusUpdate', data: { taskId, contextId, status: { state: TaskState.TASK_STATE_INPUT_REQUIRED, message: agentText('Please provide a text prompt describing the image to generate.'), timestamp: now() }, metadata: undefined } });
      bus.finished();
      return;
    }

    bus.publish({ kind: 'statusUpdate', data: { taskId, contextId, status: { state: TaskState.TASK_STATE_WORKING, message: agentText(`Generating with ${opts.model ?? 'default model'}…`), timestamp: now() }, metadata: undefined } });

    try {
      const outcome = await this.service.generate(opts);
      if (this.cancelled.has(taskId)) {
        this.cancelled.delete(taskId);
        bus.publish({ kind: 'statusUpdate', data: { taskId, contextId, status: { state: TaskState.TASK_STATE_CANCELED, message: undefined, timestamp: now() }, metadata: undefined } });
        bus.finished();
        return;
      }
      const parts: Part[] = [];
      outcome.saved.forEach((s, i) => {
        const img = outcome.images[i];
        parts.push({ content: { $case: 'raw', value: img.data }, metadata: { path: s.path, url: s.url }, filename: s.path.split('/').pop() ?? `image-${i + 1}`, mediaType: s.mimeType });
        if (s.url) parts.push({ content: { $case: 'url', value: s.url }, metadata: { path: s.path }, filename: s.path.split('/').pop() ?? '', mediaType: s.mimeType });
      });
      parts.push({
        content: { $case: 'data', value: { model: outcome.qualified, durationMs: outcome.durationMs, text: outcome.text, files: outcome.saved.map((s) => ({ path: s.path, url: s.url, mimeType: s.mimeType, bytes: s.bytes })) } },
        metadata: undefined,
        filename: 'result.json',
        mediaType: 'application/json',
      });
      bus.publish({
        kind: 'artifactUpdate',
        data: { taskId, contextId, artifact: { artifactId: randomUUID(), name: 'images', description: opts.prompt, parts, metadata: undefined, extensions: [] }, append: false, lastChunk: true, metadata: undefined },
      });
      bus.publish({ kind: 'statusUpdate', data: { taskId, contextId, status: { state: TaskState.TASK_STATE_COMPLETED, message: agentText(`Generated ${outcome.saved.length} image(s) with ${outcome.qualified}.`), timestamp: now() }, metadata: undefined } });
    } catch (err) {
      bus.publish({ kind: 'statusUpdate', data: { taskId, contextId, status: { state: TaskState.TASK_STATE_FAILED, message: agentText(`Image generation failed: ${errorMessage(err)}`), timestamp: now() }, metadata: undefined } });
    } finally {
      bus.finished();
    }
  }

  async cancelTask(taskId: string, _bus: ExecutionEventBus): Promise<void> {
    // Provider calls are not abortable mid-flight; the result is discarded when it lands.
    this.cancelled.add(taskId);
  }
}

function textPart(text: string): Part {
  return { content: { $case: 'text', value: text }, metadata: undefined, filename: '', mediaType: 'text/plain' };
}

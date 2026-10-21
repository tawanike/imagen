import OpenAI, { toFile } from 'openai';
import type { GenerateRequest, GenerateResult, GeneratedImage, ImageProvider, ModelInfo } from '../types.js';
import { ImagenError } from '../types.js';
import { aspectToSize, formatToMime } from '../util.js';

const MODELS: ModelInfo[] = [
  {
    id: 'gpt-image-2',
    provider: 'openai',
    description: 'GPT Image 2: current flagship, up to 2K+, strong text rendering and editing.',
    supportsReferences: true,
    aliases: ['gpt-image', 'codex-image', 'openai'],
  },
  {
    id: 'gpt-image-1.5',
    provider: 'openai',
    description: 'GPT Image 1.5: previous flagship; supports transparent backgrounds.',
    supportsReferences: true,
  },
  {
    id: 'gpt-image-1-mini',
    provider: 'openai',
    description: 'GPT Image 1 mini: cheapest OpenAI option for quick drafts.',
    supportsReferences: true,
    aliases: ['gpt-image-mini'],
  },
  {
    id: 'gpt-image-1',
    provider: 'openai',
    description: 'GPT Image 1: original model; supports transparent backgrounds.',
    supportsReferences: true,
  },
];

export interface OpenAIOptions {
  apiKey?: string;
  baseUrl?: string;
}

/** Shared implementation for OpenAI and OpenAI-compatible image endpoints (Azure Image API). */
export async function generateViaImagesApi(
  client: OpenAI,
  req: GenerateRequest & { model: string },
  providerId: string,
  opts: { allowBackground?: boolean; forceB64?: boolean } = {},
): Promise<GenerateResult> {
  const started = Date.now();
  const n = Math.max(1, req.n ?? 1);
  const size = req.size ?? aspectToSize(req.aspectRatio) ?? 'auto';
  const common = {
    model: req.model,
    prompt: req.prompt,
    n,
    size: size as never,
    ...(req.quality ? { quality: req.quality } : {}),
    ...(req.outputFormat ? { output_format: req.outputFormat } : {}),
    ...(req.background && opts.allowBackground !== false ? { background: req.background } : {}),
    ...(opts.forceB64 ? { response_format: 'b64_json' as const } : {}),
    ...(req.extra ?? {}),
  };
  let response;
  if (req.references?.length) {
    const files = await Promise.all(
      req.references.map((r, i) => toFile(r.data, r.name ?? `reference-${i + 1}.png`, { type: r.mimeType })),
    );
    response = await client.images.edit({ ...common, image: files.length === 1 ? files[0] : files } as never);
  } else {
    response = await client.images.generate(common as never);
  }
  const mime = formatToMime(req.outputFormat);
  const images: GeneratedImage[] = [];
  for (const item of (response as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }).data ?? []) {
    if (item.b64_json) {
      images.push({ data: Buffer.from(item.b64_json, 'base64'), mimeType: mime, revisedPrompt: item.revised_prompt });
    } else if (item.url) {
      const res = await fetch(item.url);
      if (!res.ok) throw new ImagenError(`Failed to download image from ${providerId}: HTTP ${res.status}`, 'DOWNLOAD_FAILED');
      const ct = res.headers.get('content-type')?.split(';')[0];
      images.push({ data: Buffer.from(await res.arrayBuffer()), mimeType: ct || mime, revisedPrompt: item.revised_prompt });
    }
  }
  if (images.length === 0) throw new ImagenError(`${providerId} returned no image data`, 'NO_IMAGE');
  return { images, provider: providerId, model: req.model, durationMs: Date.now() - started };
}

export class OpenAIProvider implements ImageProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI (gpt-image)';
  private client: OpenAI | undefined;

  constructor(private readonly opts: OpenAIOptions) {}

  isConfigured(): boolean {
    return !!this.opts.apiKey;
  }

  configurationHint(): string {
    return 'Set OPENAI_API_KEY. Codex CLI / ChatGPT subscription logins are not usable for the Images API; create a key at https://platform.openai.com/api-keys';
  }

  models(): ModelInfo[] {
    return MODELS;
  }

  async generate(req: GenerateRequest & { model: string }): Promise<GenerateResult> {
    if (!this.client) this.client = new OpenAI({ apiKey: this.opts.apiKey, baseURL: this.opts.baseUrl });
    return generateViaImagesApi(this.client, req, this.id, { allowBackground: true });
  }
}

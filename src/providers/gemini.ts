import { GoogleGenAI } from '@google/genai';
import type { GenerateRequest, GenerateResult, GeneratedImage, ImageProvider, ModelInfo } from '../types.js';
import { ImagenError } from '../types.js';

const MODELS: ModelInfo[] = [
  {
    id: 'gemini-nano-banana-2.1',
    provider: 'gemini',
    description: 'Nano Banana 2.1: default workhorse. 1K/2K/4K output, reference images, multi-turn editing, search grounding.',
    supportsReferences: true,
    aliases: ['nano-banana', 'nano-banana-2.1', 'banana'],
  },
  {
    id: 'gemini-3-pro-image',
    provider: 'gemini',
    description: 'Nano Banana Pro: premium model for complex scenes, text rendering and brand consistency.',
    supportsReferences: true,
    aliases: ['nano-banana-pro', 'banana-pro'],
  },
  {
    id: 'gemini-3.1-flash-image',
    provider: 'gemini',
    description: 'Nano Banana 2: previous generation, 0.5K-4K output, up to 14 reference images.',
    supportsReferences: true,
    aliases: ['nano-banana-2'],
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    provider: 'gemini',
    description: 'Nano Banana 2 Lite: fastest and cheapest, 1K only.',
    supportsReferences: true,
    aliases: ['nano-banana-lite', 'banana-lite'],
  },
  {
    id: 'gemini-2.5-flash-image',
    provider: 'gemini',
    description: 'Nano Banana (legacy). Uses the generateContent API.',
    supportsReferences: true,
    aliases: ['nano-banana-legacy'],
  },
];

/** Models that are only reachable through the older generateContent API. */
const GENERATE_CONTENT_ONLY = new Set(['gemini-2.5-flash-image']);

export interface GeminiOptions {
  apiKey?: string;
  baseUrl?: string;
  useGenerateContent?: boolean;
}

export class GeminiProvider implements ImageProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini (Nano Banana)';
  private client: GoogleGenAI | undefined;

  constructor(private readonly opts: GeminiOptions) {}

  isConfigured(): boolean {
    return !!this.opts.apiKey;
  }

  configurationHint(): string {
    return 'Set GEMINI_API_KEY (or GOOGLE_API_KEY). Get a key at https://aistudio.google.com/apikey';
  }

  models(): ModelInfo[] {
    return MODELS;
  }

  private get ai(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey: this.opts.apiKey,
        ...(this.opts.baseUrl ? { httpOptions: { baseUrl: this.opts.baseUrl } } : {}),
      });
    }
    return this.client;
  }

  async generate(req: GenerateRequest & { model: string }): Promise<GenerateResult> {
    const started = Date.now();
    const useLegacy = this.opts.useGenerateContent || GENERATE_CONTENT_ONLY.has(req.model);
    const n = Math.max(1, req.n ?? 1);
    const images: GeneratedImage[] = [];
    const texts: string[] = [];
    for (let i = 0; i < n; i++) {
      const out = useLegacy ? await this.viaGenerateContent(req) : await this.viaInteractions(req);
      images.push(...out.images);
      if (out.text) texts.push(out.text);
    }
    if (images.length === 0) {
      throw new ImagenError(
        `Gemini returned no image${texts.length ? `: ${texts.join(' ')}` : ' (the prompt may have been blocked)'}`,
        'NO_IMAGE',
      );
    }
    return { images, provider: this.id, model: req.model, text: texts.join('\n') || undefined, durationMs: Date.now() - started };
  }

  /** Interactions API: the GA path for Nano Banana 2.x / Pro. */
  private async viaInteractions(req: GenerateRequest & { model: string }): Promise<{ images: GeneratedImage[]; text?: string }> {
    const input: Array<Record<string, unknown>> = [{ type: 'text', text: req.prompt }];
    for (const ref of req.references ?? []) {
      input.push({ type: 'image', data: ref.data.toString('base64'), mime_type: ref.mimeType });
    }
    const responseFormat: Record<string, unknown> = { type: 'image' };
    if (req.aspectRatio) responseFormat.aspect_ratio = req.aspectRatio;
    const imageSize = sizeToGeminiSize(req.size, req.extra?.imageSize);
    if (imageSize) responseFormat.image_size = imageSize;
    if (req.outputFormat === 'jpeg') responseFormat.mime_type = 'image/jpeg';
    else if (req.outputFormat === 'png') responseFormat.mime_type = 'image/png';

    const params: Record<string, unknown> = {
      model: req.model,
      input,
      response_format: responseFormat,
    };
    const thinking = req.extra?.thinkingLevel ?? qualityToThinking(req.quality);
    if (thinking) params.generation_config = { thinking_level: thinking };
    if (req.extra?.previousInteractionId) params.previous_interaction_id = req.extra.previousInteractionId;
    if (req.extra?.googleSearch) params.tools = [{ type: 'google_search' }];

    // The SDK's union types are very wide; cast once at the boundary.
    const interaction = (await this.ai.interactions.create(params as never)) as unknown as {
      output_image?: { data?: string; mime_type?: string };
      output_text?: string;
      steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string; text?: string }> }>;
      errors?: Array<{ message?: string }>;
    };
    if (interaction.errors?.length) {
      throw new ImagenError(interaction.errors.map((e) => e.message).join('; '), 'PROVIDER_ERROR');
    }
    const images: GeneratedImage[] = [];
    // Prefer walking steps so interleaved outputs with several images are all captured.
    for (const step of interaction.steps ?? []) {
      if (step.type && step.type !== 'model_output') continue;
      for (const block of step.content ?? []) {
        if (block.type === 'image' && block.data) {
          images.push({ data: Buffer.from(block.data, 'base64'), mimeType: block.mime_type ?? 'image/png' });
        }
      }
    }
    if (images.length === 0 && interaction.output_image?.data) {
      images.push({
        data: Buffer.from(interaction.output_image.data, 'base64'),
        mimeType: interaction.output_image.mime_type ?? 'image/png',
      });
    }
    return { images, text: interaction.output_text };
  }

  /** Classic generateContent path (legacy Nano Banana, or forced via GEMINI_USE_GENERATE_CONTENT=1). */
  private async viaGenerateContent(req: GenerateRequest & { model: string }): Promise<{ images: GeneratedImage[]; text?: string }> {
    const parts: Array<Record<string, unknown>> = [{ text: req.prompt }];
    for (const ref of req.references ?? []) {
      parts.push({ inlineData: { data: ref.data.toString('base64'), mimeType: ref.mimeType } });
    }
    const imageConfig: Record<string, unknown> = {};
    if (req.aspectRatio) imageConfig.aspectRatio = req.aspectRatio;
    const imageSize = sizeToGeminiSize(req.size, req.extra?.imageSize);
    if (imageSize) imageConfig.imageSize = imageSize;

    const response = await this.ai.models.generateContent({
      model: req.model,
      contents: [{ role: 'user', parts }] as never,
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
      } as never,
    });
    const images: GeneratedImage[] = [];
    const texts: string[] = [];
    const candidateParts = (response.candidates?.[0]?.content?.parts ?? []) as Array<{
      inlineData?: { data?: string; mimeType?: string };
      text?: string;
    }>;
    for (const part of candidateParts) {
      if (part.inlineData?.data) {
        images.push({ data: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType ?? 'image/png' });
      } else if (part.text) {
        texts.push(part.text);
      }
    }
    return { images, text: texts.join('\n') || undefined };
  }
}

function qualityToThinking(quality: GenerateRequest['quality']): string | undefined {
  switch (quality) {
    case 'low':
      return 'minimal';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      return undefined;
  }
}

/** Accepts "1K" | "2K" | "4K" | "512" directly, or derives from a WxH size string. */
function sizeToGeminiSize(size: string | undefined, explicit: unknown): string | undefined {
  if (typeof explicit === 'string') return explicit;
  if (!size) return undefined;
  const upper = size.toUpperCase();
  if (/^(512|1K|2K|4K)$/.test(upper)) return upper;
  const m = /^(\d+)x(\d+)$/i.exec(size);
  if (!m) return undefined;
  const longest = Math.max(Number(m[1]), Number(m[2]));
  if (longest <= 640) return '512';
  if (longest <= 1536) return '1K';
  if (longest <= 3072) return '2K';
  return '4K';
}

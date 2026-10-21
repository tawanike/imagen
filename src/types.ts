/** Shared types for the imagen server. */

export interface ImageInput {
  data: Buffer;
  mimeType: string;
  name?: string;
}

export type OutputFormat = 'png' | 'jpeg' | 'webp';

export interface GenerateRequest {
  prompt: string;
  /** Fully-qualified model id, e.g. "gemini/gemini-nano-banana-2.1". Resolved by the registry. */
  model?: string;
  /** Number of images to generate (providers that can't batch loop internally). */
  n?: number;
  /** Aspect ratio such as "1:1", "16:9", "9:16". */
  aspectRatio?: string;
  /** Explicit size such as "1024x1024". Overrides aspectRatio where supported. */
  size?: string;
  /** Provider-specific quality hint: low | medium | high | auto. */
  quality?: 'low' | 'medium' | 'high' | 'auto';
  seed?: number;
  outputFormat?: OutputFormat;
  /** Transparent backgrounds (OpenAI gpt-image-1/1.5 only). */
  background?: 'transparent' | 'opaque' | 'auto';
  /** Reference / source images for editing and style transfer. */
  references?: ImageInput[];
  /** Escape hatch for provider-specific parameters, passed through untouched. */
  extra?: Record<string, unknown>;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  revisedPrompt?: string;
}

export interface GenerateResult {
  images: GeneratedImage[];
  provider: string;
  model: string;
  /** Any text the model returned alongside the image(s). */
  text?: string;
  /** Wall time in ms. */
  durationMs?: number;
}

export interface ModelInfo {
  /** Bare model id as the provider knows it. */
  id: string;
  provider: string;
  description: string;
  supportsReferences: boolean;
  aliases?: string[];
}

export interface ImageProvider {
  readonly id: string;
  readonly name: string;
  /** True when the required credentials are present. */
  isConfigured(): boolean;
  /** Why the provider is not configured, for diagnostics. */
  configurationHint(): string;
  models(): ModelInfo[];
  generate(req: GenerateRequest & { model: string }): Promise<GenerateResult>;
}

export interface SavedImage {
  path: string;
  url?: string;
  mimeType: string;
  bytes: number;
}

export interface ManifestEntry {
  id: string;
  createdAt: string;
  prompt: string;
  provider: string;
  model: string;
  files: string[];
  params: Record<string, unknown>;
  durationMs?: number;
}

export class ImagenError extends Error {
  constructor(message: string, public readonly code: string = 'IMAGEN_ERROR') {
    super(message);
    this.name = 'ImagenError';
  }
}

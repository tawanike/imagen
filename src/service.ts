import path from 'node:path';
import type { Config } from './config.js';
import { ProviderRegistry } from './registry.js';
import { saveImages, readManifest } from './storage.js';
import type { GenerateRequest, ImageInput, ManifestEntry, SavedImage } from './types.js';
import { expandHome } from './config.js';
import { loadImageInput } from './util.js';

export interface GenerateOptions extends Omit<GenerateRequest, 'references'> {
  /** File paths, http(s) URLs or data: URLs of reference images. */
  referencePaths?: string[];
  references?: ImageInput[];
  /** Directory to write into (defaults to config.outputDir). */
  outputDir?: string;
  /** Base filename without extension. */
  filename?: string;
}

export interface GenerateOutcome {
  qualified: string;
  provider: string;
  model: string;
  text?: string;
  durationMs?: number;
  saved: SavedImage[];
  entry: ManifestEntry;
  images: Array<{ data: Buffer; mimeType: string }>;
}

/** Thin façade shared by the MCP tools, the A2A executor and the CLI. */
export class ImagenService {
  readonly registry: ProviderRegistry;

  constructor(readonly config: Config, registry?: ProviderRegistry) {
    this.registry = registry ?? ProviderRegistry.fromConfig(config);
  }

  async generate(opts: GenerateOptions): Promise<GenerateOutcome> {
    const references = [...(opts.references ?? [])];
    for (const ref of opts.referencePaths ?? []) references.push(await loadImageInput(ref));
    const { referencePaths: _rp, references: _r, outputDir, filename, ...req } = opts;
    const result = await this.registry.generate({ ...req, references });
    const dir = outputDir ? path.resolve(expandHome(outputDir)) : this.config.outputDir;
    const { saved, entry } = await saveImages(result, {
      dir,
      baseName: filename,
      prompt: opts.prompt,
      publicUrl: this.config.publicUrl,
      publicRoot: this.config.outputDir,
      params: {
        model: result.qualified,
        n: opts.n,
        aspectRatio: opts.aspectRatio,
        size: opts.size,
        quality: opts.quality,
        seed: opts.seed,
        outputFormat: opts.outputFormat,
        background: opts.background,
        references: opts.referencePaths,
        extra: opts.extra,
      },
    });
    return {
      qualified: result.qualified,
      provider: result.provider,
      model: result.model,
      text: result.text,
      durationMs: result.durationMs,
      saved,
      entry,
      images: result.images,
    };
  }

  recent(limit = 20): Promise<ManifestEntry[]> {
    return readManifest(this.config.outputDir, limit);
  }
}

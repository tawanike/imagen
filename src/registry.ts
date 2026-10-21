import type { Config } from './config.js';
import type { GenerateRequest, GenerateResult, ImageProvider, ModelInfo } from './types.js';
import { ImagenError } from './types.js';
import { AzureFoundryProvider } from './providers/azure.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';

export interface ResolvedModel {
  provider: ImageProvider;
  model: string;
  qualified: string;
}

export class ProviderRegistry {
  private readonly providers: ImageProvider[];

  constructor(providers: ImageProvider[], private readonly defaultModel?: string) {
    this.providers = providers;
  }

  static fromConfig(config: Config): ProviderRegistry {
    return new ProviderRegistry(
      [new GeminiProvider(config.gemini), new OpenAIProvider(config.openai), new AzureFoundryProvider(config.azure)],
      config.defaultModel,
    );
  }

  all(): ImageProvider[] {
    return this.providers;
  }

  configured(): ImageProvider[] {
    return this.providers.filter((p) => p.isConfigured());
  }

  get(id: string): ImageProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  listModels(): Array<ModelInfo & { qualified: string; configured: boolean }> {
    return this.providers.flatMap((p) =>
      p.models().map((m) => ({ ...m, qualified: `${p.id}/${m.id}`, configured: p.isConfigured() })),
    );
  }

  /**
   * Resolves "provider/model", a bare model id, an alias, or a bare provider id
   * (-> that provider's first model). With no input, uses IMAGEN_DEFAULT_MODEL or
   * the first configured provider's first model.
   */
  resolve(input?: string): ResolvedModel {
    const spec = (input ?? this.defaultModel ?? '').trim();
    if (!spec) {
      const provider = this.configured()[0];
      if (!provider) {
        throw new ImagenError(
          `No image provider is configured. ${this.providers.map((p) => `${p.id}: ${p.configurationHint()}`).join(' | ')}`,
          'NOT_CONFIGURED',
        );
      }
      return this.finish(provider, provider.models()[0].id);
    }
    const slash = spec.indexOf('/');
    if (slash > 0) {
      const providerId = spec.slice(0, slash);
      const model = spec.slice(slash + 1);
      const provider = this.get(providerId);
      if (!provider) throw new ImagenError(`Unknown provider "${providerId}". Known: ${this.providers.map((p) => p.id).join(', ')}`, 'UNKNOWN_PROVIDER');
      return this.finish(provider, model);
    }
    const byProvider = this.get(spec);
    if (byProvider) return this.finish(byProvider, byProvider.models()[0].id);
    const lower = spec.toLowerCase();
    for (const provider of this.providers) {
      for (const m of provider.models()) {
        if (m.id.toLowerCase() === lower || m.aliases?.some((a) => a.toLowerCase() === lower)) {
          return this.finish(provider, m.id);
        }
      }
    }
    // Heuristics for bare ids we don't list explicitly.
    if (/^gemini|nano|banana|imagen/.test(lower)) return this.finish(this.get('gemini')!, spec);
    if (/^gpt-image|^dall-e|^chatgpt/.test(lower)) return this.finish(this.get('openai')!, spec);
    if (/flux/.test(lower)) return this.finish(this.get('azure')!, spec);
    throw new ImagenError(`Unknown model "${spec}". Use list_models to see available ids.`, 'UNKNOWN_MODEL');
  }

  private finish(provider: ImageProvider, model: string): ResolvedModel {
    if (!provider.isConfigured()) {
      throw new ImagenError(`Provider "${provider.id}" is not configured. ${provider.configurationHint()}`, 'NOT_CONFIGURED');
    }
    return { provider, model, qualified: `${provider.id}/${model}` };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult & { qualified: string }> {
    const resolved = this.resolve(req.model);
    const result = await resolved.provider.generate({ ...req, model: resolved.model });
    return { ...result, qualified: resolved.qualified };
  }
}

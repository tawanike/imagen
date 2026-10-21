import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../src/registry.js';
import type { GenerateRequest, GenerateResult, ImageProvider, ModelInfo } from '../src/types.js';

function fake(id: string, models: ModelInfo[], configured = true): ImageProvider & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  return {
    id,
    name: id,
    calls,
    isConfigured: () => configured,
    configurationHint: () => `configure ${id}`,
    models: () => models,
    async generate(req): Promise<GenerateResult> {
      calls.push(req);
      return { images: [{ data: Buffer.from('x'), mimeType: 'image/png' }], provider: id, model: req.model };
    },
  };
}

const gemini = fake('gemini', [{ id: 'gemini-nano-banana-2.1', provider: 'gemini', description: '', supportsReferences: true, aliases: ['nano-banana'] }]);
const openai = fake('openai', [{ id: 'gpt-image-2', provider: 'openai', description: '', supportsReferences: true, aliases: ['gpt-image'] }]);
const azure = fake('azure', [{ id: 'FLUX.2-pro', provider: 'azure', description: '', supportsReferences: true }], false);

describe('ProviderRegistry.resolve', () => {
  const reg = new ProviderRegistry([gemini, openai, azure]);

  it('resolves provider/model', () => {
    expect(reg.resolve('openai/gpt-image-1.5').qualified).toBe('openai/gpt-image-1.5');
  });
  it('resolves aliases and bare ids', () => {
    expect(reg.resolve('nano-banana').qualified).toBe('gemini/gemini-nano-banana-2.1');
    expect(reg.resolve('gpt-image-2').qualified).toBe('openai/gpt-image-2');
  });
  it('resolves a bare provider id to its first model', () => {
    expect(reg.resolve('openai').model).toBe('gpt-image-2');
  });
  it('falls back to the first configured provider', () => {
    expect(reg.resolve().provider.id).toBe('gemini');
  });
  it('honours the default model', () => {
    expect(new ProviderRegistry([gemini, openai], 'openai/gpt-image-2').resolve().qualified).toBe('openai/gpt-image-2');
  });
  it('rejects unconfigured providers with a hint', () => {
    expect(() => reg.resolve('azure/FLUX.2-pro')).toThrow(/not configured/);
  });
  it('rejects unknown models', () => {
    expect(() => reg.resolve('definitely-not-a-model')).toThrow(/Unknown model/);
  });
  it('passes the bare model id to the provider', async () => {
    await reg.generate({ prompt: 'hi', model: 'gpt-image' });
    expect(openai.calls.at(-1)?.model).toBe('gpt-image-2');
  });
});

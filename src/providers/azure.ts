import OpenAI from 'openai';
import type { GenerateRequest, GenerateResult, GeneratedImage, ImageProvider, ModelInfo } from '../types.js';
import { ImagenError } from '../types.js';
import { aspectToDims } from '../util.js';
import { generateViaImagesApi } from './openai.js';

export interface AzureOptions {
  endpoint?: string;
  apiKey?: string;
  apiVersion: string;
  deployments: string[];
}

type Route = 'openai' | 'bfl';

interface Deployment {
  name: string;
  route: Route;
}

/** Model path segments for the Black Forest Labs provider API on Foundry. */
const BFL_PATHS: Record<string, string> = {
  'flux.2-flex': 'flux-2-flex',
  'flux.2-pro': 'flux-2-pro',
  'flux.1-kontext-pro': 'flux-kontext-pro',
  'flux-1.1-pro': 'flux-pro-1.1',
};

function detectRoute(name: string): Route {
  const lower = name.toLowerCase();
  if (/flux[.-]?2/.test(lower)) return 'bfl';
  return 'openai';
}

function bflPath(name: string): string {
  const lower = name.toLowerCase();
  if (BFL_PATHS[lower]) return BFL_PATHS[lower];
  for (const [id, p] of Object.entries(BFL_PATHS)) if (lower.includes(id.replace(/\./g, ''))) return p;
  // Fallback: normalise "FLUX.2-pro" style names into "flux-2-pro".
  return lower.replace(/\./g, '-').replace(/-+/g, '-');
}

/**
 * Azure AI Foundry. Two routes:
 *  - "openai": the OpenAI-compatible Image API (gpt-image-* deployments, FLUX-1.1-pro, FLUX.1-Kontext-pro)
 *  - "bfl": the Black Forest Labs provider API (FLUX.2-pro / FLUX.2-flex, with seed/guidance/steps controls)
 */
export class AzureFoundryProvider implements ImageProvider {
  readonly id = 'azure';
  readonly name = 'Azure AI Foundry';
  private client: OpenAI | undefined;
  private readonly deployments: Deployment[];

  constructor(private readonly opts: AzureOptions) {
    this.deployments = opts.deployments.map((entry) => {
      const [name, route] = entry.split(':');
      return { name, route: route === 'bfl' || route === 'openai' ? route : detectRoute(name) };
    });
  }

  isConfigured(): boolean {
    return !!this.opts.endpoint && !!this.opts.apiKey;
  }

  configurationHint(): string {
    return 'Set AZURE_FOUNDRY_ENDPOINT (https://<resource>.services.ai.azure.com), AZURE_FOUNDRY_API_KEY and AZURE_FOUNDRY_DEPLOYMENTS (comma-separated deployment names, optionally suffixed :openai or :bfl).';
  }

  models(): ModelInfo[] {
    if (this.deployments.length === 0) {
      return [
        {
          id: '<deployment-name>',
          provider: 'azure',
          description: 'List your deployments in AZURE_FOUNDRY_DEPLOYMENTS, e.g. "gpt-image-1.5,FLUX.2-pro,FLUX-1.1-pro".',
          supportsReferences: true,
        },
      ];
    }
    return this.deployments.map((d) => ({
      id: d.name,
      provider: 'azure',
      description: d.route === 'bfl' ? `FLUX deployment via Black Forest Labs API (${bflPath(d.name)})` : 'Deployment via Azure Image API (OpenAI-compatible)',
      supportsReferences: true,
    }));
  }

  private findDeployment(model: string): Deployment {
    const found = this.deployments.find((d) => d.name.toLowerCase() === model.toLowerCase());
    if (found) return found;
    // Allow ad-hoc deployment names not pre-listed; route by name.
    return { name: model, route: detectRoute(model) };
  }

  async generate(req: GenerateRequest & { model: string }): Promise<GenerateResult> {
    const dep = this.findDeployment(req.model);
    if (dep.route === 'bfl') return this.generateBfl(req, dep);
    return this.generateOpenAI(req, dep);
  }

  private get endpoint(): string {
    return (this.opts.endpoint ?? '').replace(/\/+$/, '');
  }

  private async generateOpenAI(req: GenerateRequest & { model: string }, dep: Deployment): Promise<GenerateResult> {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.opts.apiKey,
        baseURL: `${this.endpoint}/openai/v1`,
        defaultQuery: { 'api-version': this.opts.apiVersion },
        defaultHeaders: { 'api-key': this.opts.apiKey ?? '' },
      });
    }
    const isGptImage = /gpt-image/i.test(dep.name);
    return generateViaImagesApi(this.client, { ...req, model: dep.name }, this.id, {
      allowBackground: isGptImage,
      forceB64: !isGptImage,
    });
  }

  private async generateBfl(req: GenerateRequest & { model: string }, dep: Deployment): Promise<GenerateResult> {
    const started = Date.now();
    const url = `${this.endpoint}/providers/blackforestlabs/v1/${bflPath(dep.name)}?api-version=${encodeURIComponent(this.opts.apiVersion)}`;
    const { width, height } = aspectToDims(req.aspectRatio, req.size);
    const body: Record<string, unknown> = {
      model: dep.name,
      prompt: req.prompt,
      width,
      height,
      output_format: req.outputFormat === 'jpeg' ? 'jpeg' : 'png',
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
      ...(req.extra ?? {}),
    };
    (req.references ?? []).forEach((ref, i) => {
      body[i === 0 ? 'input_image' : `input_image_${i + 1}`] = ref.data.toString('base64');
    });
    const n = Math.max(1, req.n ?? 1);
    const images: GeneratedImage[] = [];
    for (let i = 0; i < n; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new ImagenError(`Azure FLUX request failed: HTTP ${res.status} ${await res.text()}`, 'PROVIDER_ERROR');
      }
      let json = (await res.json()) as Record<string, unknown>;
      json = await this.pollIfPending(json);
      const img = await extractImage(json, body.output_format === 'jpeg' ? 'image/jpeg' : 'image/png');
      if (!img) throw new ImagenError(`Azure FLUX returned no image. Response keys: ${Object.keys(json).join(', ')}`, 'NO_IMAGE');
      images.push(img);
    }
    return { images, provider: this.id, model: dep.name, durationMs: Date.now() - started };
  }

  /** BFL's native API is asynchronous; handle a polling_url if Foundry surfaces one. */
  private async pollIfPending(json: Record<string, unknown>): Promise<Record<string, unknown>> {
    const pollingUrl = typeof json.polling_url === 'string' ? json.polling_url : undefined;
    if (!pollingUrl) return json;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'api-key': this.opts.apiKey ?? '' } });
      if (!res.ok) throw new ImagenError(`Azure FLUX polling failed: HTTP ${res.status}`, 'PROVIDER_ERROR');
      const next = (await res.json()) as Record<string, unknown>;
      const status = String(next.status ?? '').toLowerCase();
      if (status === 'ready' || status === 'succeeded' || status === 'completed') return next;
      if (status.includes('fail') || status.includes('error') || status === 'content moderated') {
        throw new ImagenError(`Azure FLUX generation ${status}`, 'PROVIDER_ERROR');
      }
    }
    throw new ImagenError('Azure FLUX generation timed out', 'TIMEOUT');
  }
}

/** Tolerant extractor for the various shapes Foundry/BFL responses can take. */
async function extractImage(json: Record<string, unknown>, fallbackMime: string): Promise<GeneratedImage | undefined> {
  const candidates: unknown[] = [
    (json.result as Record<string, unknown> | undefined)?.sample,
    json.sample,
    json.image,
    (json.images as unknown[] | undefined)?.[0],
    (json.data as Array<Record<string, unknown>> | undefined)?.[0]?.b64_json,
    (json.data as Array<Record<string, unknown>> | undefined)?.[0]?.url,
    (json.output as unknown[] | undefined)?.[0],
  ];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    if (/^https?:\/\//i.test(c)) {
      const res = await fetch(c);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type')?.split(';')[0];
      return { data: Buffer.from(await res.arrayBuffer()), mimeType: ct || fallbackMime };
    }
    if (c.startsWith('data:')) {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(c);
      if (m) return { data: Buffer.from(m[2], 'base64'), mimeType: m[1] };
    }
    if (c.length > 100) return { data: Buffer.from(c, 'base64'), mimeType: fallbackMime };
  }
  return undefined;
}

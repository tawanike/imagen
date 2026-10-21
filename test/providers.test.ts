import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AzureFoundryProvider } from '../src/providers/azure.js';
import { OpenAIProvider } from '../src/providers/openai.js';

// 1x1 transparent PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let base: string;
let seen: Seen[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.setHeader('content-type', 'application/json');
      if (req.url?.includes('/providers/blackforestlabs/')) {
        res.end(JSON.stringify({ result: { sample: PNG_B64 } }));
      } else {
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: PNG_B64 }] }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  seen = [];
});

describe('OpenAIProvider (mock server)', () => {
  it('posts to images/generations with mapped size and decodes b64_json', async () => {
    const p = new OpenAIProvider({ apiKey: 'test-key', baseUrl: `${base}/v1` });
    const out = await p.generate({ prompt: 'a fox', model: 'gpt-image-2', aspectRatio: '16:9', quality: 'high', outputFormat: 'png' });
    expect(out.images).toHaveLength(1);
    expect(out.images[0].mimeType).toBe('image/png');
    expect(out.images[0].data.length).toBeGreaterThan(20);
    const req = seen[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/images/generations');
    expect(req.headers.authorization).toBe('Bearer test-key');
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ model: 'gpt-image-2', prompt: 'a fox', size: '1536x1024', quality: 'high', output_format: 'png' });
  });
});

describe('AzureFoundryProvider (mock server)', () => {
  const opts = () => ({ endpoint: base, apiKey: 'azure-test-key', apiVersion: 'preview', deployments: ['gpt-image-1.5', 'FLUX.2-pro'] });

  it('routes gpt-image deployments to the OpenAI-compatible Image API with api-key auth', async () => {
    const out = await new AzureFoundryProvider(opts()).generate({ prompt: 'a fox', model: 'gpt-image-1.5', size: '1024x1024' });
    expect(out.images).toHaveLength(1);
    const req = seen[0];
    expect(req.url).toBe('/openai/v1/images/generations?api-version=preview');
    expect(req.headers['api-key']).toBe('azure-test-key');
    expect(JSON.parse(req.body)).toMatchObject({ model: 'gpt-image-1.5', size: '1024x1024' });
  });

  it('routes FLUX.2 to the Black Forest Labs endpoint with dimensions, seed and reference images', async () => {
    const png = Buffer.from(PNG_B64, 'base64');
    const out = await new AzureFoundryProvider(opts()).generate({
      prompt: 'a fox',
      model: 'FLUX.2-pro',
      aspectRatio: '16:9',
      seed: 7,
      outputFormat: 'jpeg',
      references: [{ data: png, mimeType: 'image/png' }, { data: png, mimeType: 'image/png' }],
    });
    expect(out.images).toHaveLength(1);
    // The mock returns PNG bytes, so the detected type wins over the requested jpeg.
    expect(out.images[0].mimeType).toBe('image/png');
    const req = seen[0];
    expect(req.url).toBe('/providers/blackforestlabs/v1/flux-2-pro?api-version=preview');
    expect(req.headers.authorization).toBe('Bearer azure-test-key');
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ model: 'FLUX.2-pro', prompt: 'a fox', seed: 7, output_format: 'jpeg' });
    expect(body.width % 16).toBe(0);
    expect(body.width).toBeGreaterThan(body.height);
    expect(body.input_image).toBe(PNG_B64);
    expect(body.input_image_2).toBe(PNG_B64);
  });
});

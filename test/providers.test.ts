import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AzureFoundryProvider } from '../src/providers/azure.js';
import { GeminiProvider } from '../src/providers/gemini.js';
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
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: bodyStr });
      res.setHeader('content-type', 'application/json');
      if (req.url?.includes('/providers/blackforestlabs/')) {
        res.end(JSON.stringify({ result: { sample: PNG_B64 } }));
      } else if (req.url?.includes('/interactions')) {
        if (bodyStr.includes('error-fail')) {
          res.end(JSON.stringify({ errors: [{ message: 'Prompt violated safety policy' }] }));
        } else if (bodyStr.includes('output-image-only')) {
          res.end(
            JSON.stringify({
              output_image: { data: PNG_B64, mime_type: 'image/png' },
              output_text: 'fallback output image',
            }),
          );
        } else {
          res.end(
            JSON.stringify({
              steps: [
                {
                  type: 'model_output',
                  content: [{ type: 'image', data: PNG_B64, mime_type: 'image/png' }],
                },
              ],
              output_image: { data: PNG_B64, mime_type: 'image/png' },
              output_text: 'Generated image of a fox',
            }),
          );
        }
      } else if (req.url?.includes(':generateContent')) {
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { data: PNG_B64, mimeType: 'image/png' } },
                    { text: 'A fox in the woods' },
                  ],
                },
              },
            ],
          }),
        );
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

describe('GeminiProvider (mock server)', () => {
  it('posts to interactions with mapped aspect ratio, image size and decodes steps image', async () => {
    const p = new GeminiProvider({ apiKey: 'gemini-test-key', baseUrl: base });
    const out = await p.generate({
      prompt: 'a fox',
      model: 'gemini-nano-banana-2.1',
      aspectRatio: '16:9',
      size: '1024x1024',
      quality: 'high',
      outputFormat: 'png',
    });
    expect(out.images).toHaveLength(1);
    expect(out.images[0].mimeType).toBe('image/png');
    expect(out.images[0].data.length).toBeGreaterThan(20);
    expect(out.text).toBe('Generated image of a fox');
    expect(out.provider).toBe('gemini');
    expect(out.model).toBe('gemini-nano-banana-2.1');

    const req = seen[0];
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/interactions');
    expect(req.headers['x-goog-api-key']).toBe('gemini-test-key');
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({
      model: 'gemini-nano-banana-2.1',
      input: [{ type: 'text', text: 'a fox' }],
      response_format: {
        type: 'image',
        aspect_ratio: '16:9',
        image_size: '1K',
        mime_type: 'image/png',
      },
      generation_config: {
        thinking_level: 'high',
      },
    });
  });

  it('falls back to output_image when steps contain no images', async () => {
    const p = new GeminiProvider({ apiKey: 'gemini-test-key', baseUrl: base });
    const out = await p.generate({
      prompt: 'a fox output-image-only',
      model: 'gemini-3-pro-image',
      size: '2048x2048',
      aspectRatio: '1:1',
    });
    expect(out.images).toHaveLength(1);
    expect(out.images[0].mimeType).toBe('image/png');
    expect(out.text).toBe('fallback output image');

    const req = seen[0];
    const body = JSON.parse(req.body);
    expect(body.response_format.image_size).toBe('2K');
    expect(body.response_format.aspect_ratio).toBe('1:1');
  });

  it('routes legacy models to generateContent with aspect ratio, image size and decodes inlineData', async () => {
    const p = new GeminiProvider({ apiKey: 'gemini-test-key', baseUrl: base });
    const out = await p.generate({
      prompt: 'a fox',
      model: 'gemini-2.5-flash-image',
      aspectRatio: '16:9',
      size: '1024x1024',
    });
    expect(out.images).toHaveLength(1);
    expect(out.images[0].mimeType).toBe('image/png');
    expect(out.images[0].data.length).toBeGreaterThan(20);
    expect(out.text).toBe('A fox in the woods');
    expect(out.provider).toBe('gemini');
    expect(out.model).toBe('gemini-2.5-flash-image');

    const req = seen[0];
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/models/gemini-2.5-flash-image:generateContent');
    expect(req.headers['x-goog-api-key']).toBe('gemini-test-key');
    const body = JSON.parse(req.body);
    expect(body.contents[0].parts[0]).toMatchObject({ text: 'a fox' });
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE', 'TEXT']);
    expect(body.generationConfig.imageConfig).toMatchObject({ aspectRatio: '16:9', imageSize: '1K' });
  });

  it('honours useGenerateContent option to force generateContent for newer models', async () => {
    const p = new GeminiProvider({ apiKey: 'gemini-test-key', baseUrl: base, useGenerateContent: true });
    const out = await p.generate({
      prompt: 'a fox',
      model: 'gemini-nano-banana-2.1',
      aspectRatio: '4:3',
      size: '512x512',
    });
    expect(out.images).toHaveLength(1);
    const req = seen[0];
    expect(req.url).toContain('/models/gemini-nano-banana-2.1:generateContent');
    const body = JSON.parse(req.body);
    expect(body.generationConfig.imageConfig).toMatchObject({ aspectRatio: '4:3', imageSize: '512' });
  });

  it('passes reference images as base64 in both interactions and generateContent', async () => {
    const png = Buffer.from(PNG_B64, 'base64');
    const p = new GeminiProvider({ apiKey: 'gemini-test-key', baseUrl: base });

    // Interactions
    await p.generate({
      prompt: 'edit this',
      model: 'gemini-nano-banana-2.1',
      references: [{ data: png, mimeType: 'image/png' }],
    });
    const req1 = seen[0];
    const body1 = JSON.parse(req1.body);
    expect(body1.input).toEqual([
      { type: 'text', text: 'edit this' },
      { type: 'image', data: PNG_B64, mime_type: 'image/png' },
    ]);

    // Legacy generateContent
    seen = [];
    await p.generate({
      prompt: 'edit this too',
      model: 'gemini-2.5-flash-image',
      references: [{ data: png, mimeType: 'image/png' }],
    });
    const req2 = seen[0];
    const body2 = JSON.parse(req2.body);
    expect(body2.contents[0].parts).toEqual([
      { text: 'edit this too' },
      { inlineData: { data: PNG_B64, mimeType: 'image/png' } },
    ]);
  });

  it('throws ImagenError when provider returns errors', async () => {
    const p = new GeminiProvider({ apiKey: 'gemini-test-key', baseUrl: base });
    await expect(
      p.generate({
        prompt: 'error-fail',
        model: 'gemini-nano-banana-2.1',
      }),
    ).rejects.toThrow(/Prompt violated safety policy/);
  });
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

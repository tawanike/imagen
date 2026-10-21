import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readManifest, saveImages } from '../src/storage.js';
import { aspectToDims, aspectToSize, slugify } from '../src/util.js';

describe('storage', () => {
  it('writes files, urls and a manifest', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'imagen-'));
    const { saved, entry } = await saveImages(
      { images: [{ data: Buffer.from('a'), mimeType: 'image/png' }, { data: Buffer.from('b'), mimeType: 'image/jpeg' }], provider: 'x', model: 'y' },
      { dir, prompt: 'Hello World!', publicUrl: 'http://127.0.0.1:4747', params: { n: 2 } },
    );
    expect(saved).toHaveLength(2);
    expect(saved[0].path).toMatch(/hello-world_.*_1\.png$/);
    expect(saved[1].path).toMatch(/_2\.jpg$/);
    expect(saved[0].url).toMatch(/^http:\/\/127\.0\.0\.1:4747\/images\//);
    const recent = await readManifest(dir, 5);
    expect(recent[0].id).toBe(entry.id);
    expect(recent[0].files).toEqual(saved.map((s) => s.path));
  });
});

describe('util', () => {
  it('slugifies', () => expect(slugify('  A Red Fox, in Autumn! ')).toBe('a-red-fox-in-autumn'));
  it('maps aspect to OpenAI sizes', () => {
    expect(aspectToSize('1:1')).toBe('1024x1024');
    expect(aspectToSize('16:9')).toBe('1536x1024');
    expect(aspectToSize('9:16')).toBe('1024x1536');
  });
  it('maps aspect to FLUX dims in multiples of 16', () => {
    const d = aspectToDims('16:9');
    expect(d.width % 16).toBe(0);
    expect(d.height % 16).toBe(0);
    expect(d.width).toBeGreaterThan(d.height);
    expect(aspectToDims(undefined, '1024x768')).toEqual({ width: 1024, height: 768 });
  });
});

import { describe, expect, it } from 'vitest';
import { Role, type Message } from '@a2a-js/sdk';
import { messageToOptions } from '../src/a2a/agent.js';

const base = { messageId: 'm1', contextId: 'c1', taskId: 't1', role: Role.ROLE_USER, metadata: undefined, extensions: [], referenceTaskIds: [] };

describe('messageToOptions', () => {
  it('collects text, params and image bytes', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const msg: Message = {
      ...base,
      parts: [
        { content: { $case: 'text', value: 'a red fox' }, metadata: undefined, filename: '', mediaType: 'text/plain' },
        { content: { $case: 'data', value: { model: 'nano-banana', aspect_ratio: '16:9', n: 2 } }, metadata: undefined, filename: '', mediaType: 'application/json' },
        { content: { $case: 'raw', value: png }, metadata: undefined, filename: 'ref.png', mediaType: 'image/png' },
      ],
    };
    const opts = await messageToOptions(msg);
    expect(opts.prompt).toBe('a red fox');
    expect(opts.model).toBe('nano-banana');
    expect(opts.aspectRatio).toBe('16:9');
    expect(opts.n).toBe(2);
    expect(opts.references).toHaveLength(1);
    expect(opts.references?.[0].mimeType).toBe('image/png');
  });
  it('accepts a prompt inside the data part', async () => {
    const msg: Message = { ...base, parts: [{ content: { $case: 'data', value: { prompt: 'logo', outputFormat: 'jpeg' } }, metadata: undefined, filename: '', mediaType: 'application/json' }] };
    const opts = await messageToOptions(msg);
    expect(opts.prompt).toBe('logo');
    expect(opts.outputFormat).toBe('jpeg');
  });
});

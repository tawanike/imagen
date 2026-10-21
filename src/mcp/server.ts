import { McpServer } from '@modelcontextprotocol/server';
import { pathToFileURL } from 'node:url';
import * as z from 'zod';
import type { ImagenService } from '../service.js';
import { errorMessage } from '../util.js';

const generateInput = {
  prompt: z.string().min(1).describe('What to generate. Be specific about subject, style, composition, lighting and any text to render.'),
  model: z
    .string()
    .optional()
    .describe('Model id: "gemini/gemini-nano-banana-2.1", "openai/gpt-image-2", "azure/<deployment>", or an alias like "nano-banana", "gpt-image". Omit for the default.'),
  n: z.number().int().min(1).max(8).optional().describe('How many images (default 1).'),
  aspect_ratio: z.string().optional().describe('e.g. "1:1", "16:9", "9:16", "4:3", "3:2", "21:9".'),
  size: z.string().optional().describe('Explicit size: "1024x1024" / "1536x1024" (OpenAI/Azure) or "1K" / "2K" / "4K" (Gemini). Overrides aspect_ratio where applicable.'),
  quality: z.enum(['low', 'medium', 'high', 'auto']).optional().describe('Quality / thinking level hint.'),
  seed: z.number().int().optional().describe('Seed where the model supports it (FLUX).'),
  output_format: z.enum(['png', 'jpeg', 'webp']).optional().describe('File format (default png).'),
  background: z.enum(['transparent', 'opaque', 'auto']).optional().describe('Transparent backgrounds (OpenAI gpt-image-1 / 1.5 only).'),
  output_dir: z.string().optional().describe('Directory to save into. Defaults to IMAGEN_OUTPUT_DIR. Use a project path (e.g. ./public/assets) to drop assets straight into a repo.'),
  filename: z.string().optional().describe('Base filename without extension. Defaults to a slug of the prompt plus a timestamp.'),
  reference_images: z.array(z.string()).optional().describe('Paths or URLs of reference/source images for editing, style transfer or character consistency.'),
  return_image: z.boolean().optional().describe('Also return the image bytes inline (base64). Off by default to keep context small; the file path is always returned.'),
  extra: z.record(z.string(), z.unknown()).optional().describe('Provider-specific passthrough parameters (e.g. {"guidance": 4, "steps": 30} for FLUX, {"googleSearch": true} for Gemini).'),
};

export function createMcpServer(service: ImagenService): McpServer {
  const server = new McpServer({ name: 'imagen', version: '0.1.0' });

  server.registerTool(
    'generate_image',
    {
      title: 'Generate image',
      description:
        'Generate one or more images from a text prompt using Gemini (Nano Banana), OpenAI (gpt-image) or Azure AI Foundry (gpt-image, FLUX). Saves files to disk and returns their paths. Pass reference_images to edit or restyle existing images.',
      inputSchema: z.object(generateInput),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => runGenerate(service, args),
  );

  server.registerTool(
    'edit_image',
    {
      title: 'Edit image',
      description: 'Edit, restyle or combine existing images according to a prompt. Equivalent to generate_image with reference_images required.',
      inputSchema: z.object({
        ...generateInput,
        reference_images: z.array(z.string()).min(1).describe('Paths or URLs of the images to edit (first image is the primary source).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => runGenerate(service, args),
  );

  server.registerTool(
    'list_models',
    {
      title: 'List image models',
      description: 'List available image providers and models, and whether each provider is configured with credentials.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const providers = service.registry.all().map((p) => ({
        id: p.id,
        name: p.name,
        configured: p.isConfigured(),
        hint: p.isConfigured() ? undefined : p.configurationHint(),
        models: p.models().map((m) => ({ id: `${p.id}/${m.id}`, aliases: m.aliases ?? [], description: m.description, supportsReferences: m.supportsReferences })),
      }));
      const defaultModel = service.config.defaultModel ?? (service.registry.configured()[0] ? `${service.registry.configured()[0].id}/${service.registry.configured()[0].models()[0].id}` : undefined);
      return { content: [{ type: 'text', text: JSON.stringify({ defaultModel, outputDir: service.config.outputDir, providers }, null, 2) }] };
    },
  );

  server.registerTool(
    'list_recent_images',
    {
      title: 'List recent images',
      description: 'List recently generated images (newest first) from the default output directory manifest.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const entries = await service.recent(limit ?? 20);
      return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
    },
  );

  return server;
}

type GenerateArgs = z.infer<z.ZodObject<typeof generateInput>>;

async function runGenerate(service: ImagenService, args: GenerateArgs) {
  try {
    const outcome = await service.generate({
      prompt: args.prompt,
      model: args.model,
      n: args.n,
      aspectRatio: args.aspect_ratio,
      size: args.size,
      quality: args.quality,
      seed: args.seed,
      outputFormat: args.output_format,
      background: args.background,
      outputDir: args.output_dir,
      filename: args.filename,
      referencePaths: args.reference_images,
      extra: args.extra,
    });
    const summary = {
      model: outcome.qualified,
      durationMs: outcome.durationMs,
      text: outcome.text,
      files: outcome.saved.map((s) => ({ path: s.path, url: s.url, mimeType: s.mimeType, bytes: s.bytes })),
    };
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
    for (const s of outcome.saved) {
      content.push({ type: 'resource_link', uri: pathToFileURL(s.path).href, name: s.path.split('/').pop(), mimeType: s.mimeType });
    }
    if (args.return_image) {
      for (const img of outcome.images) content.push({ type: 'image', data: img.data.toString('base64'), mimeType: img.mimeType });
    }
    return { content: content as never, structuredContent: summary };
  } catch (err) {
    return { isError: true, content: [{ type: 'text' as const, text: `Image generation failed: ${errorMessage(err)}` }] };
  }
}

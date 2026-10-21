# Contributing to imagen

Thanks for wanting to help! imagen is small on purpose, so most changes are easy to understand and
easy to review. This guide gets you from zero to a pull request.

## Ways to contribute

- **Test a provider with your own key** and tell us what happened. This is the single most valuable
  contribution right now (see [Project status](README.md#project-status)). Use the
  [provider report](https://github.com/tawanike/imagen/issues/new?template=provider_report.yml) form.
- **Fix a bug or pick up an issue.** Look for
  [`good first issue`](https://github.com/tawanike/imagen/labels/good%20first%20issue) and
  [`help wanted`](https://github.com/tawanike/imagen/labels/help%20wanted).
- **Add a provider or model.** See [Adding a provider](#adding-a-provider).
- **Improve the docs.** Clearer wording, more recipes, other MCP clients' setup instructions.
- **Write tests.** Especially Gemini adapter tests against a mock server.

Not sure where to start, or want to check an idea before building it? Open an issue or a discussion.
A quick "is this welcome?" saves everyone time.

## Development setup

You need Node.js 22+ and pnpm 10+.

```bash
git clone https://github.com/<your-username>/imagen.git
cd imagen
pnpm install
pnpm dev models        # run the CLI from source with tsx
pnpm check             # typecheck + tests + build, the same as CI
```

You do **not** need API keys to work on most of the code. The tests use fakes and local mock servers.
To try a real provider, put your key in `~/.imagen/.env` (never in the repo).

Useful scripts:

| Script | What it does |
| --- | --- |
| `pnpm dev <args>` | Run the CLI from source (`pnpm dev generate "a fox"`). |
| `pnpm mcp` | MCP server over stdio from source. |
| `pnpm serve` | HTTP server (MCP + A2A) from source. |
| `pnpm test` | Run vitest once. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm build` | Compile to `dist/`. |
| `pnpm check` | All of the above. Run before opening a PR. |

## Project layout

```text
src/index.ts          CLI entry (mcp | serve | generate | models)
src/service.ts        ImagenService: the one façade every front end calls
src/registry.ts       Provider lookup, aliases, default model
src/providers/        gemini.ts, openai.ts, azure.ts
src/mcp/server.ts     MCP tools
src/a2a/agent.ts      A2A agent card and executor
src/http.ts           Express host: /mcp, /a2a, agent card, /images, /health
src/guard.ts          Host/Origin protection for the loopback server
src/storage.ts        File naming and manifest.jsonl
src/config.ts         Env and env-file loading
src/types.ts          Shared types and the ImageProvider interface
test/                 vitest tests
```

## Adding a provider

1. Create `src/providers/<name>.ts` that implements `ImageProvider` from `src/types.ts`:
   `id`, `name`, `isConfigured()`, `configurationHint()`, `models()` and `generate()`.
   Return `{ images, provider, model }` where each image is a `Buffer` plus a MIME type.
2. Add its settings to `Config` and `getConfig()` in `src/config.ts`, and document the variables in
   `.env.example` and the README configuration table.
3. Register it in `ProviderRegistry.fromConfig` in `src/registry.ts`. Add a sensible model-name
   heuristic in `resolve()` if bare ids should route to it.
4. Add tests. The pattern in `test/providers.test.ts` (spin up a local HTTP server, point the provider
   at it, assert on the request and the decoded response) works well and needs no key.
5. Update the README provider table and the parameter-mapping table.

Guidelines for adapters:

- Map the shared request fields (`aspectRatio`, `size`, `quality`, `seed`, `references`, ...) to the
  vendor's vocabulary, and ignore fields the vendor can't honour instead of failing.
- Pass `extra` through so users can reach vendor-specific features without a code change.
- Never log or return API keys. Error messages should include the vendor's error text, not request headers.
- Throw `ImagenError` with a short `code` for failures callers may want to handle.

## Code style

- TypeScript, strict mode, ES modules. Keep dependencies few; justify new ones in the PR.
- Prefer small functions and plain data over clever abstractions.
- Comments should explain *why*, not restate the code.
- There is no formatter to fight with yet. Match the surrounding style (2-space indent, single quotes,
  trailing commas, semicolons).

## Tests

- Every behaviour change needs a test, or a sentence in the PR explaining why it can't have one.
- Tests must be hermetic: no network, no real keys, no writes outside a temp directory.
- Use `fs.mkdtemp(os.tmpdir())` for files and `server.listen(0)` for mock servers.

## Commits and pull requests

- Branch from `main` and keep each PR focused on one thing.
- Write commit messages in the imperative ("Add Stability provider"), with a short body explaining why.
- Fill in the pull request template. Link the issue it closes.
- CI must pass (`pnpm check`). A maintainer will review; small PRs are reviewed fastest.
- By contributing you agree your work is licensed under the project's [MIT license](LICENSE).

## Reporting bugs and security issues

- Bugs: use the [bug report form](https://github.com/tawanike/imagen/issues/new?template=bug_report.yml).
  Include your Node version, OS, the command or tool call, and the error. **Redact API keys, endpoints and
  any private prompts.**
- Security vulnerabilities: do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

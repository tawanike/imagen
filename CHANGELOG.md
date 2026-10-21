# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

### Added
- Host/Origin guard that protects the loopback HTTP server from DNS rebinding and cross-site requests.
- Provider tests for OpenAI and Azure Foundry (Image API and FLUX.2 route) using a local mock server.
- Contributor docs, issue and pull request templates, security policy and CI.

### Changed
- FLUX image responses are detected by magic bytes, so the saved MIME type matches the real image.

## [0.1.0] - 2026-10-20

### Added
- Initial release: MCP (stdio and Streamable HTTP) and A2A (v1.0, v0.3 compatible) front ends over
  Gemini (Nano Banana), OpenAI (gpt-image) and Azure AI Foundry (gpt-image, FLUX) providers.
- CLI with `mcp`, `serve`, `generate` and `models` commands.
- Image storage with a `manifest.jsonl` log.

# Contributing

1. Keep the companion CLI as the single source of truth for Codex work.
2. Commands, the rescue agent, and the MCP server should only forward to `scripts/codex-companion.mjs`.
3. Do not reimplement review / rescue / transfer in prompt-only skills.
4. Run `npm test` before opening a PR.
5. Bump every manifest together with `npm run bump-version -- <version>`.

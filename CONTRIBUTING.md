# Contributing

## Scope

P2P Message is a browser-based encrypted chat project with a hexagonal architecture. Contributions should preserve the separation between core logic, ports, and adapters.

## Workflow

1. Fork the repository.
2. Create a focused branch.
3. Add or update tests with the code change.
4. Run `npm run test:ci` before opening a pull request.
5. Open a pull request with a concise problem statement and validation notes.

## Contribution Rules

- Keep changes small and specific.
- Do not couple core use cases to browser APIs.
- Do not weaken security wording or claims without updating the security documentation.
- Prefer additive adapters over changing domain contracts unless the domain model is actually wrong.
- Document user-visible behavior changes in the README or docs when relevant.

## Pull Request Checklist

- tests added or updated
- `npm run test:ci` passes locally
- no unrelated refactors included
- docs updated if behavior or setup changed
- security-sensitive changes explained clearly

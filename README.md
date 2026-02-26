# Hive Mind Routing Agent

This repository is the initialization baseline for the Post Fiat Hive Mind Routing Agent. It centralizes live network audit outputs, typed schemas, a sample dataset, and the core matching algorithm specification.

## Repository Structure

- `docs/` - design and algorithm documentation
- `data/` - sample datasets for prototype ingestion
- `src/` - implementation code scaffold
- `network-data-audit.md` - live observed network data field audit
- `hivemind-routing-schemas.md` - `OperatorProfile`, `NetworkTask`, and `MatchResult` schemas
- `sample-data.json` - 5 operators, 5 tasks, 5 match results test harness

## Core Documents

- Live audit: [`network-data-audit.md`](./network-data-audit.md)
- Schemas: [`hivemind-routing-schemas.md`](./hivemind-routing-schemas.md)
- Matching pseudocode: [`docs/matching-logic.md`](./docs/matching-logic.md)
- Sample ingestion data: [`sample-data.json`](./sample-data.json)

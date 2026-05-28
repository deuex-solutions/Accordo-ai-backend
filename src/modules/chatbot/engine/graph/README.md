# Multi-Agent Negotiation Graph

This directory contains the core LangGraph-based multi-agent system.

## The Node-Contract Method
...
3. **Isolation**: Keep implementation logic in the `nodes/` folder, organized by track.
4. **Logic Parity (Synergy)**: Every node implementation MUST reference its legacy workflow source. Use the `@source` tag in JSDoc to point to the file in `src/modules/chatbot/` being replaced.

## Synergy Traceability Matrix
| Agent | Legacy Source | Status |
| :--- | :--- | :--- |
| `state_management` | `negotiation-state-machine.ts` | [DONE] |
| `offer_parser` | `parse-offer.ts` | [IN PROGRESS] |
| `negotiation_decision` | `decide.ts`, `weighted-utility.ts` | [TODO] |
| `meso_generator` | `meso.ts` | [TODO] |
- `state.ts`: The central state schema (The Contract).
- `types.ts`: Shared enums and interfaces.
- `index.ts`: The main graph assembly (The Skeleton).
- `checkpointer.ts`: Postgres persistence logic.
- `nodes/`: Track-specific agent implementations.

## How to Contribute
- **Vatsal (Track 1)**: Focus on `index.ts` orchestration and parsing nodes.
- **Yug (Track 2)**: Add analysis nodes to the `nodes/` folder and wire them in `index.ts`.
- **Adarsh (Track 3)**: Add strategy and MESO nodes to the `nodes/` folder and wire them in `index.ts`.

## Running the Demo
```bash
npx tsx src/modules/chatbot/engine/test-graph.ts
```

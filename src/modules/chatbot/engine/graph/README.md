# Multi-Agent Negotiation Graph

This directory contains the core LangGraph-based multi-agent system.

## The Node-Contract Method
All tracks (Vatsal, Yug, Adarsh) must adhere to the `NegotiationState` defined in `state.ts`. 

1. **State as Truth**: No agent should store internal state. All updates must flow through the graph state.
2. **Functional Nodes**: Implement agents as pure functions that take `NegotiationState` and return a `Partial<NegotiationState>`.
3. **Isolation**: Keep implementation logic in the `nodes/` folder, organized by track.

## Directory Structure
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

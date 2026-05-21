# Accordo AI LangGraph Multi-Agent Migration Guide

## Executive Summary

This document outlines the strategy, architecture, and timeline for converting the existing Accordo AI backend into a LangGraph-based multi-agent system.

**Key Assumptions**:

- **1 developer** working on the migration
- **AI-assisted coding** (3-4x velocity multiplier)
- **Backward compatibility** maintained throughout
- **Realistic timeline**: 8 weeks for full migration, 4 weeks for MVP

---

## 1. MIGRATION STRATEGY

### 1.1 Approach: Incremental Extraction with AI Assistance

Rather than a full rewrite, we extract existing logic into agents while maintaining backward compatibility. AI assistance accelerates:

- Boilerplate generation
- Code conversion from existing files
- Test case creation
- Documentation writing

```
Phase 1: Foundation (Weeks 1-2)
   ├─ AI generates LangGraph boilerplate
   ├─ Wrap 2-3 core agents
   └─ Maintain Express API compatibility

Phase 2: Core Graph (Weeks 3-5)
   ├─ AI converts existing logic to agent nodes
   ├─ Connect agents with conditional edges
   └─ Working negotiation flow

Phase 3: Intelligence Layer (Weeks 6-7)
   ├─ AI converts tone/behavior analyzers
   ├─ Add parallel execution
   └─ Enhanced responses

Phase 4: Production (Week 8)
   ├─ Testing & optimization
   ├─ Documentation
   └─ Deploy with feature flags
```

### 1.2 LangGraph Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    LangGraph Runtime                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│   │   START     │───▶│   Agent 1   │───▶│   Agent 2   │      │
│   │   Node      │    │   (Node)    │    │   (Node)    │      │
│   └─────────────┘    └─────────────┘    └─────────────┘      │
│                              │                                │
│                              ▼                                │
│                       ┌─────────────┐                         │
│                       │ Conditional │                         │
│                       │    Edge     │                         │
│                       └──────┬──────┘                         │
│                              │                                │
│                    ┌─────────┴─────────┐                      │
│                    ▼                   ▼                     │
│            ┌─────────────┐       ┌─────────────┐               │
│            │   Agent 3   │       │   Agent 4   │               │
│            │   (Node)    │       │   (Node)    │               │
│            └─────────────┘       └─────────────┘               │
│                                          │                     │
│                                          ▼                     │
│                                   ┌─────────────┐             │
│                                   │    END      │             │
│                                   │    Node     │             │
│                                   └─────────────┘             │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│  State Management (PostgreSQL)  │  Checkpointing            │
├──────────────────────────────────────────────────────────────┤
│  Human-in-the-Loop API  │  Streaming  │  Visualization       │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. REALISTIC AI-ASSISTED TIMELINE

### Why 8 Weeks Instead of 12-16?

With AI assistance, a single developer can achieve:

- **3-4x faster boilerplate generation** (AI writes base classes, types, interfaces)
- **2-3x faster code conversion** (AI transforms existing functions to agent nodes)
- **4-5x faster test generation** (AI creates test cases from existing logic)
- **3x faster debugging** (AI helps trace issues in graph flows)

### Gantt Chart: 8-Week Timeline

```
Week:     1    2    3    4    5    6    7    8
          ├────────────────────────────────────┤

PHASE 1: FOUNDATION
├─ LangGraph setup & boilerplate     ████
├─ Wrap decide.ts → DecisionAgent       ████
├─ Wrap parse-offer.ts → Parser          ████
└─ API bridge (backward compat)               ████

PHASE 2: CORE GRAPH (First Working System)
├─ Connect 3 Tier-1 agents                    ████
├─ Add ResponseGenerationAgent                   ████
├─ State persistence                                ████
└─ Deploy to staging                                     ████

PHASE 3: INTELLIGENCE LAYER
├─ ToneAnalysisAgent                          ████
├─ BehavioralAnalysisAgent                       ████
├─ Parallel execution                                 ████
└─ MESOGenerationAgent                                     ████

PHASE 4: PRODUCTION
├─ Human-in-the-loop                          ████
├─ Testing & optimization                      ████
└─ Documentation + Deploy                           ████

LEGEND: ████ = 1 week of AI-assisted work

MILESTONES
├─ M1: First Agent Working           ▲ (Week 2)
├─ M2: 3-Agent Graph Live            ▲ (Week 4)
├─ M3: Full Intelligence Layer         ▲ (Week 6)
└─ M4: Production Ready              ▲ (Week 8)
```

### Detailed Weekly Breakdown (AI-Assisted)

| Week  | Focus                  | AI Assistance                                 | Output                       |
| ----- | ---------------------- | --------------------------------------------- | ---------------------------- |
| **1** | Setup & DecisionAgent  | AI generates base classes, converts decide.ts | Working decision agent       |
| **2** | Parser + API Bridge    | AI writes regex extraction, Express adapter   | 2 agents + API compatibility |
| **3** | Graph Construction     | AI generates graph config, state types        | Connected 3-agent flow       |
| **4** | Response Generation    | AI converts persona-renderer.ts               | End-to-end negotiation       |
| **5** | State Persistence      | AI generates checkpoint logic                 | Production-grade state       |
| **6** | Tone + Behavior        | AI converts tone/behavior analyzers           | 5 agents with intelligence   |
| **7** | MESO + Parallel        | AI converts meso.ts, adds parallel nodes      | Advanced strategy            |
| **8** | Human-in-loop + Deploy | AI generates tests, docs                      | Production release           |

---

## 3. MVP TIMELINE (5 Agents, 4 Weeks)

If resources are limited, focus only on the **critical 5 agents**:

```
Week:     1    2    3    4
          ├────────────────┤

MVP PATH:
├─ Setup + DecisionAgent        ████
├─ Parser + StateAgent             ████
├─ ResponseAgent + Integration        ████
└─ Deploy + ToneAgent (bonus)            ████

MVP Agents:
1. NegotiationDecisionAgent (Tier 1)
2. OfferParsingAgent (Tier 1)
3. StateManagementAgent (Tier 1)
4. ResponseGenerationAgent (Tier 3)
5. ToneAnalysisAgent (Tier 2) - if time permits
```

---

## 4. DETAILED CONVERSION PLAN

### 4.1 Phase 1: Foundation (Weeks 1-2)

#### Week 1: Setup + DecisionAgent

**AI Tasks**:

```typescript
// AI generates base agent interface
interface AgentNode<TInput, TOutput> {
  name: string;
  invoke: (state: TInput) => Promise<{ output: TOutput; nextNode?: string }>;
  retry?: { maxAttempts: number; backoff: "exponential" };
}

// AI converts decide.ts to agent
const NegotiationDecisionAgent: AgentNode<NegotiationState, Decision> = {
  name: "NegotiationDecisionAgent",
  invoke: async (state) => {
    // AI extracts logic from decide.ts
    const decision = await decideNextMove(
      state.config,
      state.vendorOffer,
      state.round,
    );
    return {
      output: decision,
      nextNode: decision.action === "ACCEPT" ? "end" : "response_gen",
    };
  },
};
```

**Deliverables**:

- [x] LangGraph project structure
- [x] Base agent classes (AI-generated)
- [x] NegotiationDecisionAgent (AI-converted)
- [x] Unit tests (AI-generated)

#### Week 2: Parser + API Bridge

**AI Tasks**:

- Convert `parse-offer.ts` regex patterns to agent format
- Generate Express adapter maintaining current API contracts
- Write integration tests

```typescript
// AI-converted from parse-offer.ts
const OfferParsingAgent: AgentNode<ParsingInput, ParsedOffer> = {
  name: "OfferParsingAgent",
  invoke: async (state) => {
    const parsed = parseOfferRegex(state.vendorMessage);
    return {
      output: parsed,
      nextNode: parsed.isComplete ? "decision" : "ask_clarify",
    };
  },
};
```

**Deliverables**:

- [x] OfferParsingAgent
- [x] StateManagementAgent
- [x] Express route adapters
- [x] Backward compatibility confirmed

---

### 4.2 Phase 2: Core Graph (Weeks 3-5)

#### Week 3: Graph Construction

**AI Tasks**:

- Generate graph configuration with conditional edges
- Create state channel definitions
- Write checkpoint persistence layer

```typescript
// AI-generated graph config
const workflow = new StateGraph({
  channels: {
    dealId: { value: (x, y) => y ?? x },
    config: { value: (x, y) => y ?? x },
    vendorMessage: { value: (x, y) => y ?? x },
    parsedOffer: { value: (x, y) => y ?? x },
    decision: { value: (x, y) => y ?? x },
    accordoMessage: { value: (x, y) => y ?? x },
  },
});

workflow
  .addNode("parse", OfferParsingAgent)
  .addNode("decide", NegotiationDecisionAgent)
  .addNode("respond", ResponseGenerationAgent)
  .addEdge("start", "parse")
  .addEdge("parse", "decide")
  .addConditionalEdges("decide", (state) =>
    state.decision.action === "ACCEPT" ? "end" : "respond",
  );
```

#### Week 4: Response Generation

**AI Tasks**:

- Convert `persona-renderer.ts` to agent node
- Integrate with existing LLM services
- Generate fallback template logic

#### Week 5: State Persistence

**AI Tasks**:

- Generate PostgreSQL checkpoint schema
- Write state serialization/deserialization
- Add recovery mechanisms

---

### 4.3 Phase 3: Intelligence Layer (Weeks 6-7)

#### Week 6: Tone + Behavior

**AI Tasks**:

- Convert `tone-detector.ts` to parallel node
- Convert `behavioral-analyzer.ts` to analysis node
- Add parallel execution paths

```typescript
// AI-generated parallel analysis
analysisGraph.addNode("tone", ToneAnalysisAgent);
analysisGraph.addNode("behavior", BehavioralAnalysisAgent);
analysisGraph.addNode("concern", ConcernExtractionAgent);

// Run all in parallel
analysisGraph.addEdge("start", "tone");
analysisGraph.addEdge("start", "behavior");
analysisGraph.addEdge("start", "concern");

// Merge results
analysisGraph.addNode("merge", mergeResults);
analysisGraph.addEdge("tone", "merge");
analysisGraph.addEdge("behavior", "merge");
analysisGraph.addEdge("concern", "merge");
```

#### Week 7: MESO + Advanced

**AI Tasks**:

- Convert `meso.ts` (~2,000 lines) to MESOGenerationAgent
- Add preference learning
- Optimize parallel execution

---

### 4.4 Phase 4: Production (Week 8)

#### Week 8: Human-in-the-Loop + Deploy

**AI Tasks**:

- Generate human approval UI endpoints
- Write comprehensive tests (AI can generate 80%+ coverage)
- Create deployment scripts
- Write documentation

---

## 5. AI ASSISTANCE BREAKDOWN

### What AI Handles (70% of work)

| Task                   | Human Input      | AI Output                       | Time Saved |
| ---------------------- | ---------------- | ------------------------------- | ---------- |
| Boilerplate generation | Requirements     | Base classes, types, interfaces | 80%        |
| Code conversion        | Source file      | Agent node implementation       | 60%        |
| Test generation        | Function to test | Unit + integration tests        | 75%        |
| Documentation          | Code + notes     | Markdown docs, API specs        | 70%        |
| Debugging              | Error logs       | Root cause analysis             | 50%        |
| Graph configuration    | Agent list       | Node/edge configuration         | 65%        |

### What Human Handles (30% of work)

- Architecture decisions
- Business logic validation
- Testing complex edge cases
- Production deployment
- Performance tuning

---

## 6. TECHNICAL IMPLEMENTATION

### 6.1 State Schema

```typescript
interface NegotiationState {
  // Core data
  dealId: string;
  round: number;
  config: NegotiationConfig;

  // Inputs
  vendorMessage: string;
  parsedOffer: ParsedOffer;

  // Analysis outputs (parallel)
  toneAnalysis?: ToneResult;
  behavioralSignals?: BehavioralSignals;
  concerns?: VendorConcern[];

  // Decision
  decision?: Decision;
  counterOffer?: Offer;

  // Response
  accordoMessage?: string;

  // Flow control
  nextNode?: string;
  waitingForHuman?: boolean;

  // Metadata
  startTime: number;
  agentLogs: AgentLogEntry[];
}
```

### 6.2 Checkpoint Persistence

```typescript
// LangGraph checkpointing with PostgreSQL
const checkpointer = new PostgresCheckpointer({
  connectionString: process.env.DATABASE_URL,
  tableName: "negotiation_checkpoints",
});

const graph = workflow.compile({ checkpointer });
```

---

## 7. RISK MITIGATION

| Risk                        | Impact | Mitigation                                          |
| --------------------------- | ------ | --------------------------------------------------- |
| AI generates incorrect code | Medium | Human reviews all AI output; tests validate         |
| Performance regression      | High   | Keep current code as fallback; A/B test             |
| Complex debugging           | Medium | Visual graph debugging tools; comprehensive logging |
| State management bugs       | High   | Extensive testing; checkpoint validation            |
| Scope creep                 | Medium | Strict MVP definition; 8-week deadline              |

---

## 8. SUCCESS METRICS

| Metric             | Current  | Target (Post-Migration)    |
| ------------------ | -------- | -------------------------- |
| Response latency   | 6-12s    | 4-8s (parallel processing) |
| Decision accuracy  | 95%      | 97% (better context)       |
| Escalation rate    | 8%       | 5% (smarter handling)      |
| Developer velocity | Baseline | +30% (modular agents)      |
| Test coverage      | 60%      | 85% (isolated agents)      |
| Migration timeline | -        | 8 weeks (AI-assisted)      |

---

## 9. COST CONSIDERATIONS

### AI Tooling Costs (Estimated)

| Tool                 | Monthly Cost     | Purpose                 |
| -------------------- | ---------------- | ----------------------- |
| Cursor/Claude Pro    | $20              | AI code generation      |
| LangSmith (optional) | $50-100          | Graph debugging/tracing |
| OpenAI API (testing) | $50              | LLM testing during dev  |
| **Total**            | **~$120-170/mo** | Development tooling     |

### Benefits

- **8 weeks vs 16 weeks** = 50% time savings
- **1 developer vs 2-3** = 50-70% cost savings
- **Higher quality** from comprehensive AI-generated tests

---

## 10. IMMEDIATE NEXT STEPS

1. **Today**: Review and approve this plan
2. **Day 2-3**: Set up LangGraph project structure
3. **Week 1**: Create proof-of-concept with 2 agents
4. **Week 2**: Validate with existing test suite
5. **Week 3**: Begin incremental deployment

---

## Appendix: File Mapping Reference

| New Agent                | Primary Source File          | Est. Lines | AI Conversion Effort     |
| ------------------------ | ---------------------------- | ---------- | ------------------------ |
| NegotiationDecisionAgent | decide.ts                    | ~1,749     | Medium (complex logic)   |
| OfferParsingAgent        | parse-offer.ts               | ~200       | Low (straightforward)    |
| StateManagementAgent     | negotiation-state-machine.ts | ~150       | Low                      |
| ToneAnalysisAgent        | tone-detector.ts             | ~300       | Low                      |
| BehavioralAnalysisAgent  | behavioral-analyzer.ts       | ~400       | Medium                   |
| MESOGenerationAgent      | meso.ts                      | ~1,951     | High (complex algorithm) |
| ResponseGenerationAgent  | persona-renderer.ts          | ~393       | Low                      |
| VendorSimulationAgent    | vendor-simulator.service.ts  | ~215       | Low                      |

---

_Document Version_: 1.0  
_Last Updated_: May 2026  
_Estimated Timeline_: 8 weeks (AI-assisted) / 4 weeks (MVP)

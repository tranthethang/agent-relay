# Component Diagrams

This document illustrates the internal module structure of the `atry` CLI and how components interact.

## High-Level Component Interaction

```mermaid
graph TD
    CLI[CLI Entrypoint: src/cli.ts] --> Router[Command Router: src/cli/commands.ts]
    
    subgraph CLI Commands
        Router --> CmdLifecycle[Lifecycle Commands: run, stage, approve, close]
        Router --> CmdPlan[Plan Commands: plan, task]
        Router --> CmdClaim[Claim Commands: claim, release, steal, guard]
        Router --> CmdReview[Review Commands: review, decide]
        Router --> CmdDistill[Distill Command: distill]
    end

    subgraph Core Engines
        CmdLifecycle --> CoreLifecycle[src/core/lifecycle.ts]
        CmdPlan --> CorePlan[src/core/plan.ts]
        CmdClaim --> CoreClaim[src/core/claim.ts]
        CmdReview --> CoreReview[src/core/review.ts]
        CmdDistill --> CoreDistill[src/core/distill.ts]
    end

    subgraph State & Concurrency
        CoreLifecycle --> Mutate[src/core/mutate.ts]
        CorePlan --> Mutate
        CoreReview --> Mutate
        Mutate --> Lock[locks/run.lock in mutate.ts]
        Mutate --> Event[src/core/event.ts: events.jsonl]
        Mutate --> Reducer[src/core/reduce.ts: run.json]
    end

    subgraph Git & File Operations
        CoreLifecycle --> Git[src/core/git.ts: temporary index write-tree]
        CoreReview --> Git
        CoreClaim --> Overlap[src/core/overlap.ts: Path overlap check]
        CorePlan --> Scaffold[src/core/scaffold.ts]
    end
```

## Concurrency and Storage Lock Flow

```mermaid
sequenceDiagram
    participant CLI as CLI Command
    participant Mutate as withRunLock (mutate.ts)
    participant Lock as locks/run.lock
    participant Events as events.jsonl
    participant Cache as run.json

    CLI->>Mutate: Request state mutation
    Mutate->>Lock: Open with 'wx' (atomic create)
    alt Lock Contention
        Lock-->>Mutate: EEXIST
        Mutate->>Mutate: Drop lock when mtime is 30s old
        Mutate->>Mutate: Wait 50ms and retry until 10s
    end
    Lock-->>Mutate: Lock Acquired
    Mutate->>Events: Read existing event lines
    Mutate->>Mutate: Reduce to current state (reduceEvents)
    Mutate->>Mutate: Validate gate preconditions
    Mutate->>Events: Append new JSONL line
    Mutate->>Cache: Write updated run.json snapshot
    Mutate->>Lock: Unlink lock file
    Lock-->>Mutate: Lock Released
    Mutate-->>CLI: Return mutation result
```

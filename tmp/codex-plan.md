# Plan: Fix All Issues in RealTimeAgent-ElysiaJS-Expo

**Generated**: 2026-01-22
**Estimated Complexity**: High
**Branch**: `fix/code-quality-security-refactor`

## Overview
This plan addresses security gaps, reliability issues, performance bottlenecks, and type-safety problems across both backend (Bun + Elysia) and frontend (Expo). The approach is phased: secure the WebSocket channel and memory usage first, then replace logging, fix correctness bugs, improve type safety, refactor for maintainability, and finish with documentation and configuration alignment.

## Prerequisites
- Dependencies:
  - Backend: `pino`, `pino-pretty`, `@elysiajs/cors` (for CORS), optional `@sinonjs/fake-timers` for deterministic backoff tests.
- Add or update scripts:
  - `backend/package.json` test script -> `"test": "bun test"`.
  - Optional: `"typecheck": "tsc --noEmit"` for backend and frontend.
- Environment variables to standardize:
  - `OPENAI_API_KEY` (validated format)
  - `PORT`
  - `WS_AUTH_TOKEN` (or `WS_AUTH_SECRET`)
  - `WS_AUTH_REQUIRED` (boolean)
  - `EXPO_PUBLIC_BACKEND_URL`

## Phase 1: Critical Security & Stability Fixes
**Goal**: Eliminate security vulnerabilities and memory/stability risks first.

### Task 1.1: Validate OPENAI_API_KEY format (Issue 1)
- **Location**: `backend/src/config.ts` (or new `backend/src/config/env.ts`)
- **Description**: Add explicit format validation for `OPENAI_API_KEY` and fail fast with a descriptive error. Example regex:
  ```ts
  const OPENAI_KEY_PATTERN = /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/;
  ```
- **Dependencies**: None
- **Complexity**: 3
- **Test-First Approach**:
  - Test: invalid key format throws during config load
  - Test: valid key passes
- **Acceptance Criteria**:
  - Invalid keys are rejected with clear error message
  - Valid keys allow server startup

### Task 1.2: Add token-based WebSocket authentication (Issue 3)
- **Location**: `backend/src/index.ts`, `frontend/src/hooks/useWebSocket.ts`, `frontend/src/utils/config.ts`
- **Description**: Require a token via query param (compatible with React Native WebSocket) and optionally accept `Authorization` header. Add `WS_AUTH_REQUIRED` to allow dev opt-out. Reject unauthorized connections early.
- **Dependencies**: Task 1.1
- **Complexity**: 8
- **Test-First Approach**:
  - Test: connection rejected without token when `WS_AUTH_REQUIRED=true`
  - Test: connection accepted with valid token
  - Test: invalid token returns 401/close with policy violation
- **Acceptance Criteria**:
  - Unauthorized connections are rejected immediately
  - Valid token connections succeed
  - Backward compatibility preserved when `WS_AUTH_REQUIRED=false`

### Task 1.3: Add rate limiting for WebSocket messages (Issue 6)
- **Location**: `backend/src/index.ts`, new `backend/src/ws/rate-limit.ts`
- **Description**: Implement a per-connection token bucket (message count per interval) and close on abuse. Configurable via constants (e.g., `WS_RATE_LIMIT_MESSAGES`, `WS_RATE_LIMIT_WINDOW_MS`).
- **Dependencies**: Task 1.2
- **Complexity**: 6
- **Test-First Approach**:
  - Test: under limit passes
  - Test: exceeding limit triggers close with code 1008
- **Acceptance Criteria**:
  - Rate limits enforced per connection
  - Clear log event emitted on violation

### Task 1.4: Validate audio packet size and cap buffers (Issues 4, 7, 9, 19)
- **Location**: `backend/src/index.ts`, `backend/src/ws/client.ts`, `backend/src/config.ts`, `frontend/src/components/AudioPlayer.tsx`, `frontend/src/hooks/useAudioRecording.ts`
- **Description**: Enforce `MAX_AUDIO_PACKET_BYTES` and `MAX_AUDIO_BUFFER_BYTES` on backend and frontend. Drop or close on oversize packets. Cap `audioBuffer` growth and reset if exceeded.
- **Dependencies**: Task 1.3
- **Complexity**: 7
- **Test-First Approach**:
  - Backend test: oversize packet is rejected and logged
  - Backend test: buffer cap triggers reset/close
  - Frontend test: buffer cap triggers error state
- **Acceptance Criteria**:
  - Audio buffers have explicit max size
  - Oversized packets are handled safely
  - No unbounded memory growth

### Task 1.5: OpenAI reconnection with exponential backoff + circuit breaker (Issues 5, 24, 37)
- **Location**: `backend/src/ws/openai.ts`, `backend/src/ws/client.ts`, `backend/src/config.ts`
- **Description**: Add reconnection with exponential backoff (with jitter), connect timeout, and circuit breaker after repeated failures. Track connection state via a single source of truth.
- **Dependencies**: Task 1.4
- **Complexity**: 8
- **Test-First Approach**:
  - Test: reconnect attempts increase delay on failure
  - Test: circuit breaker opens after N failures and blocks new attempts during cooldown
  - Test: connection state is consistent during reconnect cycles
- **Acceptance Criteria**:
  - OpenAI reconnects with backoff
  - Circuit breaker prevents thrashing
  - Connection state stays accurate

### Task 1.6: Add WebSocket operation timeouts + safe send (Issues 10, 11)
- **Location**: `backend/src/ws/client.ts`, `backend/src/ws/openai.ts`, `backend/src/index.ts`
- **Description**: Add timeouts for OpenAI response completion and client activity. Implement a safe send wrapper to avoid sending during close.
- **Dependencies**: Task 1.5
- **Complexity**: 6
- **Test-First Approach**:
  - Test: send after close is no-op and logged
  - Test: response timeout resets state and notifies client
- **Acceptance Criteria**:
  - No sends occur after close
  - Timeouts are enforced for long-running operations

### Task 1.7: Graceful shutdown handler (Issue 12)
- **Location**: `backend/src/index.ts`
- **Description**: Handle SIGINT/SIGTERM to close WebSockets, stop OpenAI connections, and shut down server cleanly.
- **Dependencies**: Task 1.6
- **Complexity**: 4
- **Test-First Approach**:
  - Test: shutdown triggers cleanup hooks
- **Acceptance Criteria**:
  - Server exits cleanly with no dangling connections

### Task 1.8: Add CORS configuration (Issue 25)
- **Location**: `backend/src/index.ts`
- **Description**: Use `@elysiajs/cors` to set allowed origins and methods for HTTP endpoints.
- **Dependencies**: None
- **Complexity**: 3
- **Test-First Approach**:
  - Test: CORS headers present on health endpoint
- **Acceptance Criteria**:
  - CORS is configurable and enabled

## Phase 2: Logging Infrastructure Overhaul
**Goal**: Replace console logging with structured logging and remove silent failures.

### Task 2.1: Install and configure Pino (Issue 8)
- **Location**: `backend/package.json`, `backend/src/logger.ts`, optional `frontend/src/utils/logger.ts`
- **Description**: Add `pino` and `pino-pretty`. Create logger module with env-based config (pretty in dev, JSON in prod).
- **Dependencies**: None
- **Complexity**: 4
- **Test-First Approach**:
  - Test: logger outputs expected level and structure
- **Acceptance Criteria**:
  - Pino is installed
  - Logger module is used across backend

### Task 2.2: Replace console.* with logger (Issue 8)
- **Location**: `backend/src/**/*.ts`, `frontend/src/**/*.tsx`
- **Description**: Replace all console calls with logger calls (info/warn/error/debug). Keep frontend logging minimal if pino is too heavy; use a thin wrapper with same API.
- **Dependencies**: Task 2.1
- **Complexity**: 6
- **Test-First Approach**:
  - Test: logging calls do not throw during normal flows
- **Acceptance Criteria**:
  - No console.* remains in runtime paths
  - Logs include structured context (connectionId, state)

### Task 2.3: Replace silent catches with explicit logging (Issue 22)
- **Location**: `frontend/src/components/AudioPlayer.tsx`, `frontend/src/hooks/useWebSocket.ts`, `backend/src/ws/openai.ts`
- **Description**: Remove empty catch blocks and log errors with context, while keeping the app resilient.
- **Dependencies**: Task 2.1
- **Complexity**: 3
- **Test-First Approach**:
  - Test: errors are logged when exceptions occur
- **Acceptance Criteria**:
  - All catch blocks log or propagate errors

## Phase 3: Bug Fixes & Error Handling
**Goal**: Fix state bugs and propagate errors to the UI.

### Task 3.1: Fix ensureOpenAIConnected logic + state sync (Issues 18, 37)
- **Location**: `backend/src/ws/client.ts`, `backend/src/ws/openai.ts`
- **Description**: Ensure `ensureOpenAIConnected` attempts reconnect when a connection exists but is not connected. Use `openai.getIsConnected()` or a shared state.
- **Dependencies**: Task 1.5
- **Complexity**: 5
- **Test-First Approach**:
  - Test: if OpenAI disconnects, next audio triggers reconnect
- **Acceptance Criteria**:
  - Connection state does not drift
  - Reconnect path is reliable

### Task 3.2: Enforce safe send during close (Issue 10)
- **Location**: `backend/src/index.ts`, `backend/src/ws/client.ts`
- **Description**: Add a `isClosing` flag to connection data and ensure send attempts are skipped after close initiated.
- **Dependencies**: Task 1.6
- **Complexity**: 4
- **Test-First Approach**:
  - Test: send after close does not throw
- **Acceptance Criteria**:
  - No race condition on close

### Task 3.3: Add operation timeouts for response lifecycle (Issue 11)
- **Location**: `backend/src/ws/client.ts`, `backend/src/ws/openai.ts`
- **Description**: Add timeouts for `response.create` and `response.done` phases, reset state and notify client on timeout.
- **Dependencies**: Task 1.6
- **Complexity**: 5
- **Test-First Approach**:
  - Test: response timeout transitions state to IDLE and signals error
- **Acceptance Criteria**:
  - Timeouts enforced and visible in logs

### Task 3.4: Propagate errors to UI + handle permissions (Issues 17, 35, 39)
- **Location**: `frontend/src/components/VoiceScreen.tsx`, `frontend/src/hooks/useAudioRecording.ts`, `frontend/src/hooks/useWebSocket.ts`, `frontend/src/components/AudioPlayer.tsx`
- **Description**: Add error state plumbing: return errors from hooks, expose `onError` in AudioPlayer, and display errors in the UI with retry paths.
- **Dependencies**: Task 2.1
- **Complexity**: 6
- **Test-First Approach**:
  - Test: permission denied sets UI error state
  - Test: audio player failure surfaces error to UI
- **Acceptance Criteria**:
  - Errors are visible to user
  - App recovers without reload

### Task 3.5: Add OpenAI status to health check (Issue 36)
- **Location**: `backend/src/index.ts`, `backend/src/ws/client.ts`
- **Description**: Expand `GET /` (or new `/health`) to include OpenAI connection status (e.g., any active connection + last error).
- **Dependencies**: Task 1.5
- **Complexity**: 4
- **Test-First Approach**:
  - Test: health check returns `openai: connected|disconnected|unknown`
- **Acceptance Criteria**:
  - Health response includes OpenAI status

### Task 3.6: Frontend WebSocket exponential backoff (Issue 38)
- **Location**: `frontend/src/hooks/useWebSocket.ts`
- **Description**: Replace fixed reconnect delay with exponential backoff + jitter. Add max cap and reset on success.
- **Dependencies**: Task 1.2
- **Complexity**: 4
- **Test-First Approach**:
  - Test: reconnect delay increases on failures and resets on success
- **Acceptance Criteria**:
  - Reconnect uses exponential backoff

### Task 3.7: Fix state transitions and redundant updates (Issues 32, 33, 34)
- **Location**: `backend/src/agent/state.ts`, `frontend/src/components/VoiceScreen.tsx`
- **Description**: Make invalid transitions explicit (return boolean or throw). Memoize status text/color via `useMemo` and remove redundant state updates.
- **Dependencies**: Task 2.1
- **Complexity**: 5
- **Test-First Approach**:
  - Test: invalid transitions emit error and do not mutate state
  - Test: state change only on real transitions
- **Acceptance Criteria**:
  - State machine behavior is deterministic
  - UI state updates are minimal and memoized

## Phase 4: Type Safety & Strict Mode
**Goal**: Enable strict linting and eliminate unsafe types.

### Task 4.1: Enable `noUnusedLocals` and `noUnusedParameters` (Issue 28)
- **Location**: `backend/tsconfig.json`, `frontend/tsconfig.json`
- **Description**: Enable unused checks and fix all errors.
- **Dependencies**: None
- **Complexity**: 4
- **Test-First Approach**:
  - Run typecheck to capture errors before fixes
- **Acceptance Criteria**:
  - No unused locals/params in build

### Task 4.2: Replace `any` and add explicit WebSocket types (Issues 2, 29, 30)
- **Location**: `backend/src/index.ts`, `backend/src/ws/client.ts`, `frontend/src/types/websocket.ts`
- **Description**: Create `WsConnectionData` interface for `ws.data` and use typed message contracts across frontend/backend. Add guards for runtime parsing.
- **Dependencies**: Task 4.1
- **Complexity**: 6
- **Test-First Approach**:
  - Test: message parsing rejects invalid shapes
- **Acceptance Criteria**:
  - No `any` remains in ws data or message parsing

### Task 4.3: Remove unused code and exports (Issues 21, 40)
- **Location**: `frontend/src/hooks/useWebSocket.ts`, `frontend/src/utils/vad.ts`, `frontend/src/utils/audioUtils.ts`
- **Description**: Remove unused `reconnect` if not used, unused exports, and dead code flagged by strict mode.
- **Dependencies**: Task 4.1
- **Complexity**: 3
- **Test-First Approach**:
  - Typecheck confirms no unused symbols
- **Acceptance Criteria**:
  - No unused exports remain

## Phase 5: Performance & Maintainability Refactor
**Goal**: Improve efficiency and reduce coupling.

### Task 5.1: Optimize binary string conversion (Issue 20)
- **Location**: `frontend/src/hooks/useAudioRecording.ts`, `frontend/src/utils/audioUtils.ts`
- **Description**: Replace manual loops with a faster conversion path (e.g., `Buffer.from(base64, "base64")` or `base64-js`).
- **Dependencies**: Task 4.1
- **Complexity**: 4
- **Test-First Approach**:
  - Test: conversion produces identical bytes
- **Acceptance Criteria**:
  - Conversion is correct and measurably faster

### Task 5.2: Remove frontend VAD duplication (Issue 15)
- **Location**: `frontend/src/utils/vad.ts`
- **Description**: Remove unused VAD implementation or relocate to shared module only if needed.
- **Dependencies**: Task 4.3
- **Complexity**: 2
- **Test-First Approach**:
  - Typecheck ensures no missing imports
- **Acceptance Criteria**:
  - No unused VAD code remains

### Task 5.3: Extract hardcoded values and magic numbers (Issues 14, 16)
- **Location**: `backend/src/config.ts`, `frontend/src/utils/config.ts`, `frontend/src/components/AudioPlayer.tsx`, `frontend/src/components/VoiceScreen.tsx`
- **Description**: Move constants into config modules (buffer sizes, thresholds, timeouts). Use `satisfies` to keep typing strict.
- **Dependencies**: Task 4.1
- **Complexity**: 5
- **Test-First Approach**:
  - Test: constants are used and overrideable via env
- **Acceptance Criteria**:
  - No magic numbers in core logic

### Task 5.4: Decouple components for testability (Issue 13)
- **Location**: `backend/src/ws/client.ts`, `backend/src/ws/openai.ts`
- **Description**: Inject OpenAI connection factory and logger into `ClientHandler` to allow mocking in tests.
- **Dependencies**: Task 4.2
- **Complexity**: 5
- **Test-First Approach**:
  - Test: ClientHandler works with mocked OpenAI connection
- **Acceptance Criteria**:
  - Core logic is testable without real WebSocket

### Task 5.5: Add optional metrics collection (Issue 23)
- **Location**: `backend/src/metrics.ts`, `backend/src/index.ts`
- **Description**: Add simple counters for connections, audio bytes, errors, and OpenAI reconnects. Expose via `/metrics` or log periodically. Behind env flag.
- **Dependencies**: Task 2.1
- **Complexity**: 4
- **Test-First Approach**:
  - Test: metrics counters increment correctly
- **Acceptance Criteria**:
  - Metrics are available without heavy overhead

## Phase 6: Documentation & Configuration Alignment
**Goal**: Remove confusion and document new behavior.

### Task 6.1: Remove hardcoded dev IP and align port (Issues 26, 27)
- **Location**: `frontend/src/utils/config.ts`, `README.md`, `frontend/README.md`, `backend/README.md`
- **Description**: Use env-driven config with safe defaults; update port references to match backend default (3000 unless changed).
- **Dependencies**: Task 5.3
- **Complexity**: 3
- **Test-First Approach**:
  - Manual check: app connects using env config
- **Acceptance Criteria**:
  - No hardcoded IPs remain
  - Docs and defaults are consistent

### Task 6.2: Improve README documentation (Issue 31)
- **Location**: `README.md`, `backend/README.md`, `frontend/README.md`
- **Description**: Document auth token usage, rate limits, error handling, health/metrics endpoints, and test commands.
- **Dependencies**: Tasks 1.2, 1.3, 5.5
- **Complexity**: 3
- **Test-First Approach**:
  - Manual review checklist
- **Acceptance Criteria**:
  - README reflects current behavior and setup

## Testing Strategy
- **Unit Tests**: `bun test` in backend (and frontend for pure utilities).
- **Coverage Targets**: 80%+ for modified backend files.
- **Key Test Areas**:
  - Security: auth, API key validation, rate limit enforcement.
  - Stability: buffer limits, reconnection backoff, circuit breaker.
  - Error Handling: timeouts, UI error propagation, audio playback failures.

## Dependency Graph
- **Can start in parallel**:
  - Phase 2 logging (after Task 1.1), Phase 4 type safety, Phase 6 docs
- **Critical path**:
  - Task 1.1 -> 1.2 -> 1.3 -> 1.4 -> 1.5 -> 1.6 -> 3.1

## Potential Risks
- WebSocket auth may break existing clients if env flags are misconfigured.
- Reconnect backoff and circuit breaker may change perceived latency.
- Logging changes may affect performance if not configured by env.

## Rollback Plan
- Use `fix/code-quality-security-refactor` branch with phase-based commits.
- Each phase can be reverted independently.

## Issue Coverage Map
- 1: Task 1.1
- 2: Task 4.2
- 3: Task 1.2
- 4: Task 1.4
- 5: Task 1.5
- 6: Task 1.3
- 7: Task 1.4
- 8: Tasks 2.1-2.2
- 9: Task 1.4
- 10: Tasks 1.6, 3.2
- 11: Task 1.6, 3.3
- 12: Task 1.7
- 13: Task 5.4
- 14: Task 5.3
- 15: Task 5.2
- 16: Task 5.3
- 17: Task 3.4
- 18: Task 3.1
- 19: Task 1.4
- 20: Task 5.1
- 21: Task 4.3
- 22: Task 2.3
- 23: Task 5.5
- 24: Task 1.5
- 25: Task 1.8
- 26: Task 6.1
- 27: Task 6.1
- 28: Task 4.1
- 29: Task 4.2
- 30: Task 4.2
- 31: Task 6.2
- 32: Task 3.7
- 33: Task 3.7
- 34: Task 3.7
- 35: Task 3.4
- 36: Task 3.5
- 37: Task 3.1
- 38: Task 3.6
- 39: Task 3.4
- 40: Task 4.3

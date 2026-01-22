# Voice Agent - Realtime AI Conversation CLAUDE.md

<!-- AUTO-MANAGED: project-description -->
Real-time voice conversation application with React Native (Expo) frontend and Bun/Elysia backend, powered by OpenAI's Realtime API. Features turn-based conversation flow where users speak, AI processes, and responds with complete audio.

**Architecture:**
- Frontend: React Native Expo with Expo AV for audio playback
- Backend: Bun runtime + Elysia framework + Pino logging
- AI: OpenAI Realtime API (gpt-4o-realtime-preview)

**Conversation Flow:** IDLE → LISTENING → THINKING → SPEAKING → IDLE
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build and Run Commands

**Backend:**
```bash
cd backend && bun install
cd backend && bun run dev  # Starts on PORT (default 3000)
cd backend && bun test
```

**Frontend:**
```bash
cd frontend && bun install
cd frontend && bunx expo start          # Start dev server
cd frontend && bunx expo run:android    # Run on Android
cd frontend && bunx expo run:ios        # Run on iOS
```

**Root directory:**
```bash
bun install  # Install deps in both backend and frontend
```
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Project Architecture

```
backend/
├── src/
│   ├── agent/
│   │   ├── prompt.ts      # System prompt for AI
│   │   └── state.ts       # State machine (IDLE/LISTENING/THINKING/SPEAKING)
│   ├── audio/
│   │   └── vad.ts         # Voice Activity Detection
│   ├── types/
│   │   ├── config.ts      # Type definitions for config
│   │   └── index.ts       # Type barrel export
│   ├── ws/
│   │   ├── client.ts      # Client handler (per connection, VAD debouncing, audio buffering)
│   │   └── openai.ts      # OpenAI Realtime API wrapper
│   ├── config.ts          # Configuration (constants, env vars, VAD settings)
│   ├── index.ts           # Server entry point
│   └── logger.ts          ## Centralized Pino logger
│
frontend/
├── src/
│   ├── components/
│   │   ├── AudioPlayer.tsx    # Audio playback component
│   │   └── VoiceScreen.tsx    # Main UI component
│   ├── hooks/
│   │   ├── useAudioRecording.ts # Audio recording hook
│   │   └── useWebSocket.ts     # WebSocket hook with RFC 6455 close code handling
│   ├── types/
│   │   ├── config.ts      # Config types
│   │   ├── index.ts       # Type barrel export
│   │   └── websocket.ts   # WebSocket message types
│   └── utils/
│       ├── audioUtils.ts        # Audio utilities
│       ├── config.ts            # Frontend config
│       └── logger.ts          ## Frontend logger utility
```
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Coding Conventions

**TypeScript:**
- Use explicit types for function parameters and return values when clarifying intent
- Export types from `types/index.ts` barrel files
- Use `unknown` instead of `any` for genuinely unknown types

**Logging (Backend):**
- Use Pino logger from `@/logger`
- Create child loggers with context: `logger.child({ component: "Name" }, { msgPrefix: "[Name] " })`
- Logger redacts sensitive data automatically (OPENAI_API_KEY, wsAuthToken, token)

**Logging (Frontend):**
- Use logger from `@/utils/logger`
- Create module-specific loggers: `const logger = createLogger("ModuleName")`

**State Machine:**
- Only transition between valid states; invalid transitions are logged and ignored
- States: `IDLE`, `LISTENING`, `THINKING`, `SPEAKING`

**Audio Buffering (Backend):**
- Use single pre-allocated buffer with write pointer (writeOffset) for memory efficiency
- Track buffer size via `getBufferSize()` and check limits with `wouldExceedBufferLimit()`
- Use `resetAudioBuffer()` to clear and reallocate on new recording

**WebSocket:**
- Use `safeSend()` wrapper with `isClosing` flag to prevent sends during connection close
- Verify OpenAI connection with `getIsConnected()` before operations
- Handle close codes per RFC 6455 with human-readable error messages
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: patterns -->
## Coding Patterns

**VAD Debouncing Pattern:**
```typescript
// Require minimum speech duration to confirm speech has started
private SPEAKING_CONFIRMATION_MS = 200;

// Wait before accepting new speech after speech ends
private SPEECH_COOLDOWN_MS = 300;

// Track timing
private speechStartedTime: number | null = null;
private speechEndedTime: number | null = null;
```

**Safe Send Pattern (WebSocket):**
```typescript
private isClosing = false;  // Set to true when closing

private safeSend(data: string): boolean {
  if (this.isClosing) return false;
  return this.sendToClient(data);
}
```

**Connection State Verification Pattern:**
```typescript
// Always use getter for actual connection state
if (this.openai && this.openai.getIsConnected()) {
  return;  // Already connected
}
```

**Audio Buffer Management Pattern:**
```typescript
// Single buffer with write pointer
private audioBuffer: Buffer | null = null;
private writeOffset = 0;

// Reset for new recording
private resetAudioBuffer(): void {
  this.audioBuffer = null;
  this.writeOffset = 0;
}
```

**Type Barrel Export Pattern:**
```typescript
// In types/index.ts
export * from './config';
export * from './other';
```

**Stale Closure Prevention Pattern:**
```typescript
// Use useRefs to access current state in callbacks and async handlers
const conversationStateRef = useRef(conversationState);
const isSessionActiveRef = useRef(isSessionActive);

// Keep refs updated with useEffect
useEffect(() => {
  conversationStateRef.current = conversationState;
}, [conversationState]);

// Read from ref in callbacks to get current value (not stale closure)
const handleClick = () => {
  const currentState = conversationStateRef.current;
  if (currentState === "idle") {
    // ...
  }
};
```

**Chunked Processing Pattern:**
```typescript
// Process large arrays/buffers in 32KB chunks for better cache locality
const CHUNK_SIZE = 0x8000; // 32KB chunks
let i = 0;
while (i < binaryString.length) {
  const chunkEnd = Math.min(i + CHUNK_SIZE, binaryString.length);
  for (let j = i; j < chunkEnd; j++) {
    bytes[j] = binaryString.charCodeAt(j);
  }
  i = chunkEnd;
}
```

**WAV Header Cache Pattern:**
```typescript
// Cache constant-size headers to avoid recreation
const WAV_HEADER_CACHE = new Map<string, Uint8Array>();

const cacheKey = `${sampleRate}-${channels}-${bitsPerSample}`;

if (WAV_HEADER_CACHE.has(cacheKey)) {
  // Clone cached header and update variable fields
  const header = new Uint8Array(WAV_HEADER_CACHE.get(cacheKey)!);
  const view = new DataView(header.buffer);
  view.setUint32(4, 36 + dataLength, true); // Update data length
  return header;
}

// Create and cache new header...
WAV_HEADER_CACHE.set(cacheKey, headerWithZeroLength);
```
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: git-insights -->
## Git History Insights

**Commit 06050aa: Phase 2-6 - Logging, bug fixes, performance optimization, and types**
- Added Pino logging library with pretty printing for dev, JSON for prod
- Created centralized logger utilities for both backend and frontend
- Added VAD debouncing (200ms confirmation, 300ms cooldown) to prevent false positives
- Optimized audio buffer with single pre-allocated buffer and write pointer tracking
- Fixed ensureOpenAIConnected logic with getIsConnected() method for accurate state
- Added safe send pattern with isClosing flag for clean connection shutdowns
- Implemented RFC 6455 WebSocket close code handling with human-readable errors
- Created type definition directories in both backend/src/types/ and frontend/src/types/
- Logger automatically redacts sensitive tokens for security
<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Environment Setup

**Backend (.env):**
```env
OPENAI_API_KEY=sk-...
PORT=3000
WS_AUTH_REQUIRED=true
WS_AUTH_TOKEN=your-auth-token
CORS_ORIGIN=*
LOG_LEVEL=debug
```

**Frontend (.env or src/utils/config.ts):**
```env
EXPO_PUBLIC_BACKEND_URL=ws://10.0.2.2:3000/ws  # Android emulator
# or ws://localhost:3000/ws  # iOS simulator
# or ws://192.168.1.100:3000/ws  # Physical device
```

**Audio Constants:**
- Sample rate: 16kHz (input), 24kHz (output)
- Format: PCM16, Mono
- VAD: 20ms frames, 500ms threshold, 600ms silence duration
<!-- END MANUAL -->

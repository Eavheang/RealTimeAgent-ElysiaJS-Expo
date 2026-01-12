# Voice Agent - Real-time AI Conversation

A real-time voice conversation application built with React Native (Expo) frontend and Bun/Elysia backend, powered by OpenAI's Realtime API. Features turn-based conversation flow where users speak, AI processes, and responds with complete audio.

## 🏗️ Architecture

### System Overview

```
┌─────────────┐      WebSocket (PCM16 Audio)      ┌─────────────┐
│   Frontend  │ ────────────────────────────────► │   Backend   │
│  (React     │                                   │   (Bun +    │
│   Native)   │ ◄──────────────────────────────── │   Elysia)   │
└─────────────┘      WebSocket (Base64 Audio)     └─────────────┘
                                                          │
                                                          │ WebSocket
                                                          │ (PCM16)
                                                          ▼
                                                  ┌─────────────┐
                                                  │   OpenAI    │
                                                  │  Realtime   │
                                                  │     API     │
                                                  └─────────────┘
```

### Components

**Frontend (`frontend/`):**
- React Native Expo app
- Real-time audio recording using `react-native-live-audio-stream`
- WebSocket client for bidirectional communication
- Audio playback using Expo AV
- State management for conversation flow

**Backend (`backend/`):**
- Bun runtime with Elysia web framework
- WebSocket server handling multiple client connections
- OpenAI Realtime API integration
- State machine for conversation management
- Per-connection audio buffering and processing

### Conversation Flow

1. **User speaks** → Frontend records PCM16 audio → Streams to backend via WebSocket
2. **Backend receives** → Forwards to OpenAI Realtime API → OpenAI detects speech start/stop
3. **User stops** → OpenAI triggers response → Backend requests AI response
4. **AI generates** → Audio chunks stream back → Backend forwards to frontend
5. **Frontend accumulates** → Waits for all audio → Plays complete response
6. **Playback finishes** → User can speak again → Cycle repeats

### State Machine

The backend uses a simple state machine for turn-based conversation:

```
IDLE → LISTENING → THINKING → SPEAKING → IDLE
```

- **IDLE**: Ready for user input
- **LISTENING**: User is speaking
- **THINKING**: Processing user input, waiting for AI response
- **SPEAKING**: AI is responding

## 📋 Prerequisites

- **Bun** (latest version) - [Install Bun](https://bun.sh/docs/installation)
- **Node.js** (v18+) - For Expo CLI (if not using Bun)
- **OpenAI API Key** - Get from [OpenAI Platform](https://platform.openai.com/api-keys)
- **Expo CLI** (optional) - `npm install -g expo-cli` or use `npx expo`

## 🚀 Setup Instructions

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd agent_expo
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies using Bun
bun install

# Create .env file
echo "OPENAI_API_KEY=your_openai_api_key_here" > .env
echo "PORT=3000" >> .env

# Edit .env and add your OpenAI API key
# OPENAI_API_KEY=sk-...
# PORT=3000
```

### 3. Frontend Setup

```bash
# Navigate to frontend directory
cd ../frontend

# Install dependencies using Bun
bun install

# Configure backend URL (see Configuration section below)
# Edit src/utils/config.ts or create .env file
```

### 4. Configuration

#### Backend Configuration

Edit `backend/.env`:
```env
OPENAI_API_KEY=sk-your-api-key-here
PORT=3000
```

#### Frontend Configuration

**Option 1: Edit `frontend/src/utils/config.ts`**
```typescript
export const BACKEND_WS_URL = "ws://YOUR_LOCAL_IP:3000/ws";
```

**Option 2: Use environment variable**
Create `frontend/.env`:
```env
EXPO_PUBLIC_BACKEND_URL=ws://YOUR_LOCAL_IP:3000/ws
```

**Finding Your Local IP:**
- **Windows**: Run `ipconfig` → Look for IPv4 Address
- **Mac/Linux**: Run `ifconfig` or `ip addr` → Look for local network IP
- **Example**: `192.168.1.100` or `192.168.0.5`

**For Android Emulator**: Use `10.0.2.2` instead of localhost
**For iOS Simulator**: Use `localhost` or `127.0.0.1`

## 🏃 Running the Project

### Start Backend

```bash
cd backend
bun run dev
```

Backend will start on `http://localhost:3000` (or your configured PORT).

### Start Frontend

**Using Bun (recommended):**
```bash
cd frontend
bunx expo start
```

**Using npm:**
```bash
cd frontend
npm start
# or
npx expo start
```

### Run on Device/Emulator

**Android:**
```bash
cd frontend
bunx expo run:android
# or
npm run android
```

**iOS:**
```bash
cd frontend
bunx expo run:ios
# or
npm run ios
```

**Physical Device:**
1. Start Expo dev server (`bunx expo start`)
2. Install Expo Go app on your phone
3. Scan QR code from terminal
4. Make sure phone and computer are on same WiFi network

## 📁 Project Structure

```
agent_expo/
├── backend/
│   ├── src/
│   │   ├── agent/
│   │   │   ├── prompt.ts      # System prompt for AI
│   │   │   └── state.ts       # State machine
│   │   ├── audio/
│   │   │   └── vad.ts         # Voice Activity Detection
│   │   ├── ws/
│   │   │   ├── client.ts       # Client handler (per connection)
│   │   │   └── openai.ts      # OpenAI Realtime API wrapper
│   │   ├── config.ts          # Configuration
│   │   └── index.ts           # Server entry point
│   ├── package.json
│   └── .env                    # Environment variables
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AudioPlayer.tsx    # Audio playback component
│   │   │   └── VoiceScreen.tsx    # Main UI component
│   │   ├── hooks/
│   │   │   ├── useAudioRecording.ts # Audio recording hook
│   │   │   └── useWebSocket.ts     # WebSocket hook
│   │   ├── types/
│   │   │   └── websocket.ts        # TypeScript types
│   │   └── utils/
│   │       ├── audioUtils.ts        # Audio utilities
│   │       ├── config.ts            # Frontend config
│   │       └── vad.ts              # Frontend VAD (if needed)
│   ├── package.json
│   └── .env                    # Environment variables (optional)
│
└── README.md                   # This file
```

## 🔧 Technical Details

### Audio Format

- **Input (User → Backend)**: PCM16, 16kHz, Mono
- **Output (Backend → Frontend)**: Base64-encoded PCM16, 24kHz, Mono
- **Chunk Size**: ~4096 bytes per chunk

### WebSocket Protocol

**Client → Backend:**
- Binary messages: Raw PCM16 audio data

**Backend → Client:**
- JSON messages:
  - `{ type: "audio", data: "base64..." }` - Audio chunk
  - `{ type: "audio_done" }` - All audio sent, ready to play

### OpenAI Realtime API

- **Model**: `gpt-4o-realtime-preview`
- **Input Format**: PCM16
- **Output Format**: PCM16
- **VAD**: Server-side VAD (turn detection)
- **Features**: Full-duplex audio, real-time transcription

## 🐛 Troubleshooting

### Backend Issues

**"OPENAI_API_KEY environment variable is required"**
- Make sure `.env` file exists in `backend/` directory
- Check that `OPENAI_API_KEY` is set correctly

**Port already in use**
- Change `PORT` in `backend/.env`
- Update frontend config to match new port

### Frontend Issues

**Can't connect to backend**
- Check backend is running (`http://localhost:3000`)
- Verify IP address in `frontend/src/utils/config.ts`
- Ensure phone/emulator and computer are on same network
- Check firewall settings

**Audio not playing**
- Check microphone permissions
- Verify audio format compatibility
- Check console logs for errors

**"Agent ready for next turn" but can't speak**
- Wait for audio playback to complete
- Check conversation state in UI debug info

### Network Issues

**Android Emulator:**
- Use `10.0.2.2` instead of `localhost` or local IP
- Example: `ws://10.0.2.2:3000/ws`

**iOS Simulator:**
- Use `localhost` or `127.0.0.1`
- Example: `ws://localhost:3000/ws`

**Physical Device:**
- Use your computer's local IP address
- Both devices must be on same WiFi network
- Example: `ws://192.168.1.100:3000/ws`

## 📝 Development Notes

### State Management

The conversation follows a strict turn-based flow:
- User can only speak when AI is idle
- AI response must complete before user can speak again
- Audio is accumulated and played as one continuous sound

### Audio Buffering

- Frontend accumulates all audio chunks
- Waits for `audio_done` signal from backend
- Plays entire response as one WAV file
- Prevents stuttering and cut-off responses

### Error Handling

- Backend ignores audio during THINKING/SPEAKING states
- Frontend prevents sending audio while AI is speaking
- Automatic reconnection on WebSocket disconnect
- Graceful error recovery


# Voice Agent Frontend

React Native Expo frontend for the real-time voice agent application.

## Features

- Real-time WebSocket connection to backend
- Audio recording from device microphone
- PCM16 audio streaming to backend
- Audio playback of AI responses
- Connection status display
- Minimalist UI matching design specifications

## Setup

1. Install dependencies:
```bash
cd frontend
npm install
# or
bun install
```

2. Configure backend URL:
   - Edit `src/utils/config.ts` to set your backend WebSocket URL
   - For local development (emulator): `ws://localhost:3000/ws`
   - For physical device: `ws://192.168.x.x:3000/ws` (replace with your computer's local IP)

3. Start the development server:
```bash
npm start
# or
expo start
```

## Configuration

### Backend URL

Update the backend WebSocket URL in `src/utils/config.ts`:

```typescript
export const BACKEND_WS_URL = "ws://192.168.1.100:3000/ws";
```

Or use an environment variable:
- Create `.env` file with: `EXPO_PUBLIC_BACKEND_URL=ws://192.168.1.100:3000/ws`

### Finding Your Local IP

- Windows: Run `ipconfig` in Command Prompt, look for IPv4 Address
- Mac/Linux: Run `ifconfig` or `ip addr`, look for your local network IP

## Audio Format

- **Input:** PCM16, 16kHz, Mono (sent to backend as binary)
- **Output:** Base64-encoded PCM16 (received from backend, converted to WAV for playback)

## Development

- **iOS Simulator:** `npm run ios` or `expo start --ios`
- **Android Emulator:** `npm run android` or `expo start --android`
- **Physical Device:** Scan QR code from Expo Go app

## Notes

- Microphone permission is required for audio recording
- For real-time audio streaming, expo-av sends audio after recording stops
- True real-time streaming may require a custom native module

/**
 * Configuration for backend connection
 * Supports localhost (emulator) and local IP (physical device)
 */

import Constants from "expo-constants";

// Get backend URL from environment variable or use default
const getBackendUrl = (): string => {
  // Check for environment variable (EXPO_PUBLIC_BACKEND_URL)
  const envUrl = Constants.expoConfig?.extra?.backendUrl || 
                 process.env.EXPO_PUBLIC_BACKEND_URL;

  if (envUrl) {
    // Ensure it has ws:// protocol and /ws path
    let url = envUrl.trim();
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = `ws://${url}`;
    }
    // Ensure it ends with /ws if not already
    if (!url.endsWith('/ws')) {
      url = url.endsWith('/') ? `${url}ws` : `${url}/ws`;
    }
    return url;
  }

  // Default - Backend runs on port 8080
  return "ws://192.168.1.2:8080/ws";
};

export const BACKEND_WS_URL = getBackendUrl();

// For development: you can hardcode your local IP here
// Uncomment and replace with your actual IP address:
// export const BACKEND_WS_URL = "ws://192.168.1.100:3000/ws";

console.log("[Config] Backend WebSocket URL:", BACKEND_WS_URL);

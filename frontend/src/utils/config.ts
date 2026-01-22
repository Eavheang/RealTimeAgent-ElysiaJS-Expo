/**
 * Configuration for backend connection
 * Supports localhost (emulator) and local IP (physical device)
 */

import Constants from "expo-constants";

// WebSocket auth token (optional, required if WS_AUTH_REQUIRED=true on backend)
export const WS_AUTH_TOKEN = Constants.expoConfig?.extra?.wsAuthToken ||
                             process.env.EXPO_PUBLIC_WS_AUTH_TOKEN ||
                             "";

// Get backend URL from environment variable or use default
const getBackendUrl = (): string => {
  // Check for environment variable (EXPO_PUBLIC_BACKEND_URL)
  // Format can include port: "localhost:3000" or "192.168.1.x:3000"
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

  // Default - Backend runs on port 3000 (matching backend default)
  return "ws://192.168.1.2:3000/ws";
};

/**
 * Get WebSocket URL with auth token as query parameter
 * Format: ws://host:port/ws?token=xxx
 */
export const getWebSocketUrl = (): string => {
  const baseUrl = getBackendUrl();
  const url = new URL(baseUrl, "http://dummy");

  if (WS_AUTH_TOKEN) {
    url.searchParams.set("token", WS_AUTH_TOKEN);
  }

  // Replace http://dummy with the original protocol
  const protocol = baseUrl.startsWith("wss://") ? "wss://" : "ws://";
  return `${protocol}${url.host}${url.pathname}${url.search}`;
};

// For development: you can hardcode your local IP here
// Uncomment and replace with your actual IP address:
// export const BACKEND_WS_URL = "ws://192.168.1.100:3000/ws";

console.log("[Config] Backend WebSocket URL:", BACKEND_WS_URL);

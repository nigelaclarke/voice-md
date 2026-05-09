import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The realtime-voice-component is linked from a sibling source checkout.
  // Telling Next to transpile it makes turbopack honour the package's
  // "exports" field through the link.
  transpilePackages: ["realtime-voice-component"],
  // Disable strict mode in dev — the realtime-voice-component controller
  // owns a long-lived WebRTC peer connection. Strict mode mounts the Voice
  // component twice on every render, which races two controller.connect()
  // attempts against each other and can cause one to hang for ~15s before
  // the second's destroy() resolves. The library is correct in production
  // (no double-mount); this only affects dev.
  reactStrictMode: false,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The realtime-voice-component is linked from a sibling source checkout
  // (pnpm `link:` protocol). Telling Next to transpile it makes turbopack
  // honour the package's "exports" field through the symlink.
  transpilePackages: ["realtime-voice-component"],
};

export default nextConfig;

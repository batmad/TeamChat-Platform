import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const appOrigin = process.env.APP_ORIGIN || "localhost";
const appBasePath = process.env.APP_BASE_PATH || "";

const nextConfig: NextConfig = {
  allowedDevOrigins: [appOrigin],
  basePath: appBasePath,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BASE_PATH: appBasePath,
    NEXT_PUBLIC_APP_URL: process.env.APP_URL || "",
    NEXT_PUBLIC_REALTIME_URL: process.env.REALTIME_URL || "",
    NEXT_PUBLIC_METADATA_TITLE: process.env.METADATA_TITLE,
    NEXT_PUBLIC_METADATA_DESCRIPTION: process.env.METADATA_DESCRIPTION,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

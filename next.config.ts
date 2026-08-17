import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;


/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // מתעלם משגיאות טייפסקריפט בזמן ההעלאה לשרת
    ignoreBuildErrors: true,
  },
  eslint: {
    // מתעלם משגיאות ESLint בזמן ההעלאה לשרת
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
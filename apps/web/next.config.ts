import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  output: isGitHubPages ? 'export' : 'standalone',
  ...(isGitHubPages
    ? {
        basePath: '/tool-messager',
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { optimizePackageImports: ['lucide-react'] },
};

export default nextConfig;

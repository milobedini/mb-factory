import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@mb-factory/core'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css'
      },
      // Project definitions (`projects/*/factory.yaml`) are bundled as text and parsed by core.
      '*.yaml': { type: 'text' }
    }
  }
};

export default nextConfig;

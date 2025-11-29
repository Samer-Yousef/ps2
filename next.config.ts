import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-libsql',
    '@libsql/client',
  ],
  webpack: (config, { isServer }) => {
    // Ignore non-code files from any node_modules
    config.module.rules.push({
      test: /\.(md|txt)$/,
      type: 'asset/source',
    });

    // Ignore LICENSE files without extension
    config.module.rules.push({
      test: /\/LICENSE$/,
      type: 'asset/source',
    });

    // Ignore README files
    config.module.rules.push({
      test: /\/README(\.md)?$/i,
      type: 'asset/source',
    });

    return config;
  },
};

export default nextConfig;

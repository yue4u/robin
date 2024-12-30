import { defineConfig } from "rolldown";
import dotenv from "dotenv";
dotenv.config();

const ENV_KEYS = [
  "ROBIN_TOKEN",
  "ROBIN_AUTHOR_ID",
  "ROBIN_CHANNEL_ID",
  "MASTODON_HOST",
  "MASTODON_USERNAME",
  "MASTODON_ACCESS_TOKEN",
  "BSKY_USERNAME",
  "BSKY_PASSWORD",
];

const define = Object.fromEntries(
  ENV_KEYS.filter((k) => process.env[k]).map((k) => [
    `process.env.${k}`,
    JSON.stringify(process.env[k]),
  ])
);

export default defineConfig({
  input: "src/robin.ts",
  define,
  output: {
    format: "cjs",
    file: "dist/robin.cjs",
    inlineDynamicImports: true,
  },
});

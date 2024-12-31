import dotenv from "dotenv";
import { createBot, createDesiredPropertiesObject, Intents } from "discordeno";
import { AtpAgent, RichText } from "@atproto/api";
import ogs from "open-graph-scraper";

dotenv.config();

const ROBIN_TOKEN = process.env.ROBIN_TOKEN!;
const ROBIN_AUTHOR_ID = BigInt(process.env.ROBIN_AUTHOR_ID!);
const ROBIN_CHANNEL_ID = BigInt(process.env.ROBIN_CHANNEL_ID!);

const BSKY_USERNAME = process.env.BSKY_USERNAME!;
const BSKY_PASSWORD = process.env.BSKY_PASSWORD!;
const MASTODON_HOST = process.env.MASTODON_HOST;
const MASTODON_USERNAME = process.env.MASTODON_USERNAME;
const MASTODON_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN;

interface Post {
  content: string;
  media: {
    contentType?: string;
    height?: number;
    width?: number;
    buffer: ArrayBuffer;
    alt: string;
  }[];
}

const bot = createBot({
  token: ROBIN_TOKEN,
  intents: Intents.DirectMessages | Intents.MessageContent,
  desiredProperties: createDesiredPropertiesObject({}, true),
  events: {
    ready(_bot, payload) {
      console.log(`${payload.user.username} is ready!`);
    },
    async messageCreate(message) {
      if (message.author.id !== ROBIN_AUTHOR_ID) return;
      if (message.channelId !== ROBIN_CHANNEL_ID) return;

      const media = await Promise.all(
        (message.attachments || [])?.map(async (attachment) => {
          const res = await fetch(attachment.url);
          const buffer = await res.arrayBuffer();
          return {
            contentType: attachment.contentType,
            width: attachment.width,
            height: attachment.height,
            buffer,
            alt: attachment.description || attachment.filename,
          };
        })
      );
      const post: Post = {
        content: message.content,
        media,
      };

      const results = await Promise.all(
        [bsky, mastodon].map(async (fn) => {
          const result = await fn(post);
          return `${fn.name}: ${result}`;
        })
      );

      await bot.helpers.sendMessage(message.channelId, {
        content: results.join("\n"),
        messageReference: {
          messageId: message.id,
          channelId: message.channelId,
          failIfNotExists: false,
        },
      });
    },
  },
});

async function bsky(post: Post) {
  const rt = new RichText({ text: post.content });
  await rt.detectFacets(aptAgent);

  const images = await Promise.all(
    post.media.map(async (m) => {
      const res = await aptAgent.uploadBlob(new Uint8Array(m.buffer));
      return { image: res.data.blob, alt: m.alt };
    })
  );

  const hasImages = images.length > 0;
  const embed = hasImages
    ? {
        $type: "app.bsky.embed.images",
        images,
      }
    : await bskyOgp(aptAgent, rt).catch((e) => {
        console.error(e);
        return undefined;
      });

  const { uri } = await aptAgent.post({
    text: rt.text,
    facets: rt.facets,
    embed,
  });
  // https://github.com/bluesky-social/atproto/discussions/2523
  const [_did, _collection, rkey] = uri.replace("at://", "").split("/");
  return `https://bsky.app/profile/${BSKY_USERNAME}/post/${rkey}`;
}

async function bskyOgp(agent: AtpAgent, rt: RichText) {
  let ogUri: string | null = null;
  rt.facets?.find((facet) =>
    facet.features.find((feature) => {
      if (typeof feature.uri === "string" && URL.canParse(feature.uri)) {
        ogUri = feature.uri;
        return true;
      }
      return false;
    })
  );

  if (!ogUri) return undefined;
  const og = await ogs({
    url: ogUri,
    fetchOptions: {
      headers: {
        "User-Agent": "Robin Bot OGP Fetcher",
      },
    },
  });
  if (og.error) throw new Error("failed to fetch ogp");

  const ogImage = og.result.ogImage?.[0];
  if (!ogImage?.url)
    return {
      $type: "app.bsky.embed.external",
      external: {
        uri: ogUri,
        title: og.result.ogTitle,
        description: og.result.ogDescription,
      },
    };

  const ogImageRes = await fetch(ogImage.url);
  const ogImageBuffer = await ogImageRes.arrayBuffer();
  const uploadRes = await agent.uploadBlob(new Uint8Array(ogImageBuffer));

  return {
    $type: "app.bsky.embed.external",
    external: {
      uri: ogUri,
      thumb: {
        $type: "blob",
        ref: uploadRes.data.blob.ref,
        mimeType: uploadRes.data.blob.mimeType,
        size: uploadRes.data.blob.size,
      },
      title: og.result.ogTitle,
      description: og.result.ogDescription,
    },
  };
}

async function mastodon(post: Post) {
  if (!MASTODON_HOST) return "";
  if (!MASTODON_ACCESS_TOKEN) return "";
  if (!MASTODON_USERNAME) return "";

  const mediaUrl = `https://${MASTODON_HOST}/api/v2/media`;

  const headers = {
    Authorization: `Bearer ${MASTODON_ACCESS_TOKEN}`,
  };
  const mediaIds = await Promise.all(
    post.media.map(async (m) => {
      const data = new FormData();
      data.append("file", new Blob([m.buffer]));
      data.append("description", m.alt);
      const res = await fetch(mediaUrl, {
        method: "POST",
        headers,
        body: data,
      });
      const content = await res.json();
      return content.id;
    })
  );

  const statusesUrl = `https://${MASTODON_HOST}/api/v1/statuses`;
  const data = new FormData();
  data.append("status", post.content);
  mediaIds.forEach((media) => {
    data.append("media_ids[]", media);
  });

  const res = await fetch(statusesUrl, {
    method: "POST",
    headers,
    body: data,
  });
  const content = await res.json();

  // https://null.ptr.fm/@yue/113719232846116510
  return `https://${MASTODON_HOST}/@${MASTODON_USERNAME}/${content.id}`;
}

const aptAgent = new AtpAgent({
  service: "https://bsky.social",
});

async function main() {
  await aptAgent.login({
    identifier: BSKY_USERNAME,
    password: BSKY_PASSWORD,
  });
  await bot.start();
}

main();

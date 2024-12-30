import dotenv from "dotenv";
import {
  createBot,
  createDesiredPropertiesObject,
  Intents,
  Message,
} from "discordeno";
import { AtpAgent, RichText } from "@atproto/api";

dotenv.config();

const ROBIN_TOKEN = process.env.ROBIN_TOKEN!;
const ROBIN_AUTHOR_ID = BigInt(process.env.ROBIN_AUTHOR_ID!);
const ROBIN_CHANNEL_ID = BigInt(process.env.ROBIN_CHANNEL_ID!);

const BSKY_USERNAME = process.env.BSKY_USERNAME!;
const BSKY_PASSWORD = process.env.BSKY_PASSWORD!;
const MASTODOM_ACCESS_TOKEN = process.env.MASTODOM_ACCESS_TOKEN;

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

      const results = await Promise.all([bsky(message), mastodon(message)]);

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

async function bsky(message: Message) {
  const rt = new RichText({ text: message.content });
  await rt.detectFacets(aptAgent);
  const { uri } = await aptAgent.post({
    text: rt.text,
    facets: rt.facets,
  });
  // https://github.com/bluesky-social/atproto/discussions/2523
  const [_did, _collection, rkey] = uri.replace("at://", "").split("/");
  return `bsky: https://bsky.app/profile/${BSKY_USERNAME}/post/${rkey}`;
}

async function mastodon(message: Message) {
  if (!MASTODOM_ACCESS_TOKEN) return "";

  const host = "null.ptr.fm";
  const url = `https://${host}/api/v1/statuses`;
  const data = new FormData();
  data.append("status", message.content);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MASTODOM_ACCESS_TOKEN}`,
    },
    body: data,
  });
  const content = await res.json();

  // https://null.ptr.fm/@yue/113719232846116510
  return `mastodon: https://${host}/@yue/${content.id}`;
}

const aptAgent = new AtpAgent({
  service: "https://bsky.social",
});

await aptAgent.login({
  identifier: BSKY_USERNAME,
  password: BSKY_PASSWORD,
});
await bot.start();

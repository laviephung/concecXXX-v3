// src/config.ts
import * as dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`❌ Thiếu biến môi trường: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  // Telegram
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  adminUserIds: required("ADMIN_USER_IDS")
    .split(",")
    .map((id) => parseInt(id.trim())),

  // OpenAI
  openaiApiKey: required("OPENAI_API_KEY"),

  // Twitter
  twitter: {
    apiKey: required("TWITTER_API_KEY"),
    apiSecret: required("TWITTER_API_SECRET"),
    accessToken: required("TWITTER_ACCESS_TOKEN"),
    accessSecret: required("TWITTER_ACCESS_SECRET"),
  },

  // Lịch đăng bài theo khung giờ
  publishSlot1Hour: parseInt(optional("PUBLISH_SLOT_1_HOUR", "8")),
  publishSlot1Videos: parseInt(optional("PUBLISH_SLOT_1_VIDEOS", "3")),
  publishSlot2Hour: parseInt(optional("PUBLISH_SLOT_2_HOUR", "20")),
  publishSlot2Videos: parseInt(optional("PUBLISH_SLOT_2_VIDEOS", "3")),
  publishIntervalMinutes: parseInt(optional("PUBLISH_INTERVAL_MINUTES", "30")),
  downloadConcurrency: parseInt(optional("DOWNLOAD_CONCURRENCY", "2")),

  // Cookie files (dùng trên VPS)
  youtubeCookieFile: optional("YOUTUBE_COOKIE_FILE", ""),
  instagramCookieFile: optional("INSTAGRAM_COOKIE_FILE", ""),

  // Giới hạn video cho Twitter
  maxVideoDurationSec: 140,
  maxVideoSizeMB: 512,

  // Thư mục lưu video
  videoDir: "data/videos",
};
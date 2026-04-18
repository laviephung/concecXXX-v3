// src/publisher/twitter-publisher.ts
// Upload video + đăng tweet lên X + thông báo về Telegram

import { TwitterApi } from "twitter-api-v2";
import TelegramBot from "node-telegram-bot-api";
import * as fs from "fs";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const logger = createLogger("Twitter");

const client = new TwitterApi({
  appKey: config.twitter.apiKey,
  appSecret: config.twitter.apiSecret,
  accessToken: config.twitter.accessToken,
  accessSecret: config.twitter.accessSecret,
});

const rwClient = client.readWrite;
const tgBot = new TelegramBot(config.telegramBotToken);

// ─── Gửi thông báo về Telegram ───────────────────────────────────────────────

async function notify(message: string) {
  for (const adminId of config.adminUserIds) {
    try {
      await tgBot.sendMessage(adminId, message, { parse_mode: "Markdown" });
    } catch (err: any) {
      logger.error(`Không gửi được thông báo Telegram: ${err.message}`);
    }
  }
}

// ─── Upload video lên Twitter ─────────────────────────────────────────────────

async function uploadVideo(filePath: string): Promise<string> {
  logger.info(`Đang upload video: ${filePath}`);

  const fileSize = fs.statSync(filePath).size;

  const initResponse = await rwClient.v1.uploadMedia(filePath, {
    mimeType: "video/mp4",
    longVideo: fileSize > 5 * 1024 * 1024,
  });

  logger.success(`Upload xong, media_id: ${initResponse}`);
  return initResponse;
}

// ─── Đăng 1 tweet kèm video ──────────────────────────────────────────────────

export async function publishOne(): Promise<boolean> {
  const video = await db.videoLibrary.findFirst({
    where: { status: "ready" },
    orderBy: { createdAt: "asc" },
  });

  if (!video) {
    logger.info("Không có video sẵn sàng để đăng");
    return false;
  }

  // Kiểm tra file còn tồn tại không
  if (!fs.existsSync(video.localPath)) {
    logger.error(`File không tồn tại: ${video.localPath}`);
    await db.videoLibrary.update({
      where: { id: video.id },
      data: { status: "failed" },
    });
    await notify(
      `⚠️ *File video bị mất*\n\n` +
      `📹 ${video.title || "Untitled"}\n` +
      `❌ File không tồn tại trên disk\n` +
      `🔄 Đã đánh dấu failed, bỏ qua video này`
    );
    return false;
  }

  // Đánh dấu đang publish
  await db.videoLibrary.update({
    where: { id: video.id },
    data: { status: "publishing" },
  });

  try {
    // Upload video
    const mediaId = await uploadVideo(video.localPath);

    // Đăng tweet
    const caption = video.caption || "Check this out 🔥 #viral #trending";
    const tweet = await rwClient.v2.tweet({
      text: caption,
      media: { media_ids: [mediaId] },
    });

    const tweetId = tweet.data.id;

    // Cập nhật DB
    await db.videoLibrary.update({
      where: { id: video.id },
      data: {
        status: "published",
        publishedAt: new Date(),
        tweetId,
      },
    });

    await db.publishLog.create({
      data: { videoId: video.id, tweetId, status: "success" },
    });

    logger.success(`Đã đăng tweet: https://x.com/i/status/${tweetId}`);

    // ✅ Thông báo thành công
    await notify(
      `✅ *Đã đăng tweet thành công!*\n\n` +
      `📹 ${(video.title || "Untitled").substring(0, 60)}\n` +
      `💬 ${caption.substring(0, 100)}\n` +
      `🔗 https://x.com/i/status/${tweetId}`
    );

    return true;
  } catch (err: any) {
    logger.error(`Lỗi đăng tweet: ${err.message}`);

    // Rollback về ready để thử lại
    await db.videoLibrary.update({
      where: { id: video.id },
      data: { status: "ready" },
    });

    await db.publishLog.create({
      data: { videoId: video.id, status: "failed", error: err.message },
    });

    // ❌ Thông báo lỗi + gợi ý nguyên nhân
    let hint = "";
    if (err.message.includes("402")) {
      hint = "💳 Tài khoản X hết credits, vào console.x.com để nạp thêm";
    } else if (err.message.includes("401")) {
      hint = "🔑 API key sai hoặc hết hạn, kiểm tra lại file .env";
    } else if (err.message.includes("403")) {
      hint = "🚫 App chưa có quyền Write, vào developer.x.com kiểm tra lại";
    } else if (err.message.includes("429")) {
      hint = "⏱️ Đăng quá nhiều, X đang rate limit. Bot sẽ tự thử lại sau";
    } else {
      hint = `Chi tiết: ${err.message}`;
    }

    await notify(
      `❌ *Đăng tweet thất bại!*\n\n` +
      `📹 ${(video.title || "Untitled").substring(0, 60)}\n\n` +
      `${hint}`
    );

    return false;
  }
}

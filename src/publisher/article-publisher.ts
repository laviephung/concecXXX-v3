// src/publisher/article-publisher.ts
import { TwitterApi } from "twitter-api-v2";
import TelegramBot from "node-telegram-bot-api";
import * as fs from "fs-extra";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const logger = createLogger("ArticlePublisher");

const client = new TwitterApi({
  appKey: config.twitter.apiKey,
  appSecret: config.twitter.apiSecret,
  accessToken: config.twitter.accessToken,
  accessSecret: config.twitter.accessSecret,
});

const rwClient = client.readWrite;
const tgBot = new TelegramBot(config.telegramBotToken);

async function notify(message: string) {
  for (const adminId of config.adminUserIds) {
    try {
      await tgBot.sendMessage(adminId, message, { parse_mode: "Markdown" });
    } catch (err: any) {
      logger.error(`Không gửi được thông báo Telegram: ${err.message}`);
    }
  }
}

export async function publishOneArticle(): Promise<boolean> {
  // Thứ tự ưu tiên nguồn tin: Al Jazeera (geopolitics) > TWZ (twz) > CoinDesk (market)
  const sourcePriority = ["geopolitics", "twz", "market"];
  let article = null;

  for (const source of sourcePriority) {
    article = await db.articleLibrary.findFirst({
      where: { status: "ready", source: source },
      orderBy: { createdAt: "asc" },
    });
    if (article) {
      logger.info(`Tìm thấy bài báo từ nguồn ưu tiên: ${source}`);
      break;
    }
  }

  // Nếu không tìm thấy bài từ các nguồn ưu tiên, lấy bài bất kỳ còn lại
  if (!article) {
    article = await db.articleLibrary.findFirst({
      where: { status: "ready" },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!article) {
    logger.info("Không có bài báo nào sẵn sàng để đăng");
    return false;
  }

  await db.articleLibrary.update({
    where: { id: article.id },
    data: { status: "publishing" },
  });

  try {
    let mediaIds: string[] = [];
    // 80% chance to include image if it exists (increased from 50% for better visual)
    const shouldIncludeImage = Math.random() > 0.2;
    
    if (shouldIncludeImage && article.localPath && fs.existsSync(article.localPath)) {
      logger.info(`Đang upload ảnh bài báo: ${article.localPath}`);
      const mediaId = await rwClient.v1.uploadMedia(article.localPath);
      mediaIds.push(mediaId);
    } else if (article.localPath && fs.existsSync(article.localPath)) {
      logger.info(`Bỏ qua ảnh bài báo theo tỉ lệ ngẫu nhiên: ${article.localPath}`);
    }

    const tweetOpts: any = { text: article.content || article.title };
    if (mediaIds.length > 0) {
      tweetOpts.media = { media_ids: mediaIds };
    }

    const tweet = await rwClient.v2.tweet(tweetOpts);
    const tweetId = tweet.data.id;

    await db.articleLibrary.update({
      where: { id: article.id },
      data: {
        status: "published",
        publishedAt: new Date(),
        tweetId,
      },
    });

    await notify(
      `✅ *Đã đăng bài báo (News) lên X!*\n\n` +
      `📰 ${(article.title || "").substring(0, 60)}\n` +
      `🔗 https://x.com/i/status/${tweetId}`
    );

    logger.success(`Đã đăng bài báo: https://x.com/i/status/${tweetId}`);
    return true;
  } catch (err: any) {
    logger.error(`Lỗi đăng bài báo: ${err.message}`);
    
    await db.articleLibrary.update({
      where: { id: article.id },
      data: { status: "failed" },
    });

    await notify(
      `❌ *Đăng bài báo (News) thất bại!*\n\n` +
      `📰 ${(article.title || "").substring(0, 60)}\n` +
      `Lỗi: ${err.message}`
    );

    return false;
  }
}

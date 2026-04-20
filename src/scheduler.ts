// src/scheduler.ts
// Lịch đăng bài theo 2 khung giờ, mỗi video cách nhau 30 phút

import cron from "node-cron";
import { config } from "./config";
import { createLogger } from "./utils/logger";
import { processPendingCaptions } from "./processor/caption-generator";
import { publishOne } from "./publisher/twitter-publisher";
import { publishOneArticle } from "./publisher/article-publisher";
import { crawlNews } from "./downloader/twz-scraper";
import { crawlMarketNews } from "./downloader/market-scraper";
import { crawlGeoNews } from "./downloader/aljazeera-scraper";
import { cleanupPublishedVideos } from "./downloader/channel-downloader";
import { getPublishingStatus } from "./bot/telegram-bot";
import db from "./db";

const logger = createLogger("Scheduler");

// ─── Trạng thái publish queue ─────────────────────────────────────────────────
// Dùng để theo dõi đang trong khung giờ đăng hay không

let publishQueue: { videosLeft: number; slotName: string } | null = null;
let publishTimer: NodeJS.Timeout | null = null;

// ─── Đăng từng video trong queue theo interval ───────────────────────────────

async function startPublishQueue(totalVideos: number, slotName: string) {
  if (publishQueue) {
    logger.warn(`Đang trong khung giờ ${publishQueue.slotName}, bỏ qua ${slotName}`);
    return;
  }

  logger.info(`Bắt đầu khung giờ ${slotName}: đăng ${totalVideos} video, cách nhau ${config.publishIntervalMinutes} phút`);
  publishQueue = { videosLeft: totalVideos, slotName };

  // Đăng video đầu tiên ngay lập tức
  await publishNextInQueue();
}

async function publishNextInQueue() {
  if (!publishQueue || publishQueue.videosLeft <= 0) {
    if (publishQueue) {
      logger.success(`Khung giờ ${publishQueue.slotName} hoàn tất!`);
      publishQueue = null;
    }
    return;
  }

  if (!getPublishingStatus()) {
    logger.info("Auto-publish đang tạm dừng, hủy khung giờ");
    publishQueue = null;
    return;
  }

  try {
    logger.info(`Đang đăng bài (còn lại: ${publishQueue.videosLeft})`);
    
    // Đọc mode hiện tại
    let mode = "video";
    try {
      const settings = await db.botSettings.findUnique({ where: { id: "default" } });
      if (settings?.mode) mode = settings.mode;
    } catch {}

    let ok = false;
    if (mode === "news") {
      logger.info("Chế độ News, đang dọn dẹp tin cũ và crawl tin mới nhất...");
      try {
        // Xóa tất cả các tin chưa đăng (status: ready) để không đăng tin cũ của ngày hôm trước
        const deleted = await db.articleLibrary.deleteMany({
          where: { status: "ready" }
        });
        logger.info(`Đã dọn dẹp ${deleted.count} tin cũ chưa đăng.`);

        // Tự động crawl từ cả 3 nguồn: Quân sự (TWZ), Thị trường (CoinDesk), Địa chính trị (Al Jazeera)
        // Cào số lượng ít (mỗi nguồn 2-3 tin) để đăng ngay tin nóng nhất
        await crawlNews(2);
        await crawlMarketNews(2);
        await crawlGeoNews(2);
      } catch (crawlErr: any) {
        logger.error(`Lỗi dọn dẹp hoặc crawl news/market/geo: ${crawlErr.message}`);
      }
      
      logger.info("Đang lấy Bài Báo để đăng...");
      ok = await publishOneArticle();
    } else {
      logger.info("Chế độ Video, đang lấy Video...");
      ok = await publishOne();
    }

    if (!ok) {
      logger.warn(`Không có ${mode} để đăng, kết thúc khung giờ sớm`);
      publishQueue = null;
      return;
    }
    publishQueue.videosLeft--;
  } catch (err: any) {
    logger.error(`Lỗi đăng bài: ${err.message}`);
    publishQueue = null;
    return;
  }

  // Còn video → đặt hẹn giờ cho video tiếp theo
  if (publishQueue && publishQueue.videosLeft > 0) {
    const delayMs = config.publishIntervalMinutes * 60 * 1000;
    logger.info(`Video tiếp theo sau ${config.publishIntervalMinutes} phút...`);
    publishTimer = setTimeout(publishNextInQueue, delayMs);
  } else {
    if (publishQueue) {
      logger.success(`Khung giờ ${publishQueue.slotName} hoàn tất!`);
      publishQueue = null;
    }
  }
}

// ─── Khởi động scheduler ──────────────────────────────────────────────────────

export function startScheduler() {
  const slot1Hour = config.publishSlot1Hour;
  const slot2Hour = config.publishSlot2Hour;
  const slot1Videos = config.publishSlot1Videos;
  const slot2Videos = config.publishSlot2Videos;
  const interval = config.publishIntervalMinutes;

  // ─── Tạo caption (mỗi 2 phút) ───────────────────────────────────────────
  cron.schedule("*/2 * * * *", async () => {
    try { await processPendingCaptions(); }
    catch (err: any) { logger.error(`Caption job lỗi: ${err.message}`); }
  });

  // ─── Khung giờ 1 ────────────────────────────────────────────────────────
  cron.schedule(`0 ${slot1Hour} * * *`, async () => {
    if (!getPublishingStatus()) return;
    await startPublishQueue(slot1Videos, `Sáng (${slot1Hour}:00)`);
  });

  // ─── Khung giờ 2 ────────────────────────────────────────────────────────
  cron.schedule(`0 ${slot2Hour} * * *`, async () => {
    if (!getPublishingStatus()) return;
    await startPublishQueue(slot2Videos, `Tối (${slot2Hour}:00)`);
  });

  // ─── Tự động xóa file video đã đăng (mỗi 1 giờ) ─────────────────────────
  cron.schedule("0 * * * *", async () => {
    try { await cleanupPublishedVideos(); }
    catch (err: any) { logger.error(`Cleanup job lỗi: ${err.message}`); }
  });

  // Tính giờ đăng video cuối trong mỗi slot để hiển thị
  const slot1End = slot1Hour + Math.floor(((slot1Videos - 1) * interval) / 60);
  const slot1EndMin = ((slot1Videos - 1) * interval) % 60;
  const slot2End = slot2Hour + Math.floor(((slot2Videos - 1) * interval) / 60);
  const slot2EndMin = ((slot2Videos - 1) * interval) % 60;

  logger.success(
    `Scheduler khởi động:\n` +
    `  📝 Tạo caption  : mỗi 2 phút\n` +
    `  📤 Khung sáng   : ${slot1Hour}:00 → ${slot1Videos} video → kết thúc ~${slot1End}:${slot1EndMin.toString().padStart(2, "0")}\n` +
    `  📤 Khung tối    : ${slot2Hour}:00 → ${slot2Videos} video → kết thúc ~${slot2End}:${slot2EndMin.toString().padStart(2, "0")}\n` +
    `  ⏱️  Cách nhau    : ${interval} phút/video\n` +
    `  📥 Crawl kênh   : mỗi 6 giờ\n` +
    `  🗑️  Xóa file cũ  : mỗi 1 giờ`
  );
}

// ─── Export để telegram bot dùng lệnh /postnow ───────────────────────────────

export async function triggerPublishNow() {
  if (publishQueue) {
    return `⚠️ Đang trong khung giờ *${publishQueue.slotName}*, còn *${publishQueue.videosLeft}* video chờ đăng`;
  }
  await startPublishQueue(1, "Thủ công");
  return `✅ Đang đăng 1 video ngay bây giờ...`;
}
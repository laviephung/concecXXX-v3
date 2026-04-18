// src/downloader/instagram-downloader.ts
// Tải video từ Instagram (Reels + Posts) dùng cookie Chrome

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const execAsync = promisify(exec);
const logger = createLogger("InstagramDL");

// Cookie từ Chrome (tự động lấy, không cần export tay)
const COOKIE_FLAG = "--cookies-from-browser chrome";

// ─── Lấy thông tin video ──────────────────────────────────────────────────────

async function getVideoInfo(url: string) {
  try {
    const { stdout } = await execAsync(
      `yt-dlp ${COOKIE_FLAG} --dump-json --no-download --no-warnings "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const info = JSON.parse(stdout.trim());
    return {
      id: info.id as string,
      title: (info.title || info.description || "Instagram video") as string,
      duration: (info.duration || 0) as number,
      type: url.includes("/reel/") ? "reel" : "post",
    };
  } catch {
    return null;
  }
}

// ─── Tải 1 video ─────────────────────────────────────────────────────────────

export async function downloadInstagramOne(url: string): Promise<boolean> {
  url = url.trim();
  if (!url) return false;

  // Kiểm tra đã tải chưa
  const existing = await db.videoLibrary.findUnique({ where: { originalUrl: url } });
  if (existing && existing.status !== "failed") {
    logger.info(`Đã có sẵn, bỏ qua: ${url}`);
    return true;
  }

  logger.info(`Đang lấy thông tin: ${url}`);
  const info = await getVideoInfo(url);

  if (!info) {
    logger.error(`Không lấy được thông tin (cần đăng nhập Instagram trên Chrome): ${url}`);
    return false;
  }

  if (info.duration > config.maxVideoDurationSec) {
    logger.warn(`Video quá dài (${info.duration}s), bỏ qua`);
    return false;
  }

  if (!fs.existsSync(config.videoDir)) {
    fs.mkdirSync(config.videoDir, { recursive: true });
  }

  const filePath = path.resolve(path.join(config.videoDir, `ig_${info.id}.mp4`));

  try {
    logger.info(`Đang tải: ${info.title.substring(0, 60)}`);

    await execAsync(
      `yt-dlp ${COOKIE_FLAG} ` +
      `-f "best[height<=720][ext=mp4]/best[height<=720]/best" ` +
      `--merge-output-format mp4 ` +
      `--no-playlist ` +
      `--socket-timeout 60 ` +
      `--retries 3 ` +
      `--no-warnings ` +
      `-o "${filePath}" ` +
      `"${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (!fs.existsSync(filePath)) throw new Error("File không tồn tại sau tải");

    const stats = fs.statSync(filePath);

    await db.videoLibrary.upsert({
      where: { originalUrl: url },
      update: {
        status: "pending_caption",
        localPath: filePath,
        title: info.title,
        duration: info.duration,
        fileSize: stats.size,
      },
      create: {
        source: "instagram",
        originalUrl: url,
        localPath: filePath,
        title: info.title,
        duration: info.duration,
        fileSize: stats.size,
        status: "pending_caption",
      },
    });

    logger.success(`Tải xong: ${info.title.substring(0, 50)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err: any) {
    logger.error(`Lỗi tải ${url}: ${err.message}`);
    await db.videoLibrary.upsert({
      where: { originalUrl: url },
      update: { status: "failed" },
      create: { source: "instagram", originalUrl: url, localPath: "", status: "failed" },
    });
    return false;
  }
}

// ─── Tải full profile ─────────────────────────────────────────────────────────

export async function downloadInstagramProfile(
  profileUrl: string,
  batchSize: number = 10
): Promise<number> {
  // Đảm bảo URL đúng format
  // Hỗ trợ: https://www.instagram.com/username/ hoặc @username
  if (profileUrl.startsWith("@")) {
    profileUrl = `https://www.instagram.com/${profileUrl.slice(1)}/`;
  }

  logger.info(`Đang quét profile: ${profileUrl}`);

  const historyFile = "data/downloaded-history.txt";
  const history = fs.existsSync(historyFile)
    ? new Set(fs.readFileSync(historyFile, "utf-8").split("\n").filter(Boolean))
    : new Set<string>();

  try {
    // Lấy danh sách video từ profile
    const { stdout } = await execAsync(
      `yt-dlp ${COOKIE_FLAG} ` +
      `--flat-playlist --dump-json ` +
      `--playlist-end 50 ` +  // Lấy tối đa 50 video mới nhất
      `--no-warnings ` +
      `"${profileUrl}"`,
      { maxBuffer: 20 * 1024 * 1024 }
    );

    const lines = stdout.trim().split("\n").filter(Boolean);
    const videos = lines.map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id as string,
          url: (info.webpage_url || info.url) as string,
          title: (info.title || info.description || "Instagram video") as string,
        };
      } catch { return null; }
    }).filter(Boolean) as Array<{ id: string; url: string; title: string }>;

    logger.info(`Tìm thấy ${videos.length} video trên profile`);

    // Lọc bỏ đã tải
    const newVideos = videos.filter(v => !history.has(`ig_${v.id}`));
    logger.info(`${newVideos.length} video chưa tải`);

    if (newVideos.length === 0) {
      logger.info("Profile này đã tải hết rồi!");
      return 0;
    }

    const batch = newVideos.slice(0, batchSize);
    let downloaded = 0;

    for (const video of batch) {
      const ok = await downloadInstagramOne(video.url);
      if (ok) {
        // Lưu vào history
        fs.appendFileSync(historyFile, `ig_${video.id}\n`);
        downloaded++;
      }
      await new Promise(r => setTimeout(r, 3000)); // Chờ 3s tránh bị chặn
    }

    logger.success(`Batch xong: ${downloaded}/${batch.length} video`);
    return downloaded;
  } catch (err: any) {
    logger.error(`Lỗi quét profile: ${err.message}`);
    // Nếu lỗi do chưa đăng nhập
    if (err.message.includes("login") || err.message.includes("cookie")) {
      logger.error("Cần đăng nhập Instagram trên Chrome trước!");
    }
    return 0;
  }
}

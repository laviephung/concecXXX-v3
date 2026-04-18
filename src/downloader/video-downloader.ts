// src/downloader/video-downloader.ts
// Tải video từ YouTube và Douyin hàng loạt

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const execAsync = promisify(exec);
const logger = createLogger("Downloader");

// ─── Kiểm tra tools ──────────────────────────────────────────────────────────

export async function checkDependencies(): Promise<boolean> {
  try {
    await execAsync("yt-dlp --version");
    logger.success("yt-dlp OK");
  } catch {
    logger.error("Chưa cài yt-dlp! Chạy: pip install yt-dlp");
    return false;
  }

  try {
    await execAsync("ffmpeg -version");
    logger.success("ffmpeg OK");
  } catch {
    logger.warn("Không tìm thấy ffmpeg - không thể compress video lớn");
  }

  return true;
}

// ─── Lấy thông tin video ─────────────────────────────────────────────────────

async function getVideoInfo(url: string) {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-download --no-warnings "${url}"`
    );
    const info = JSON.parse(stdout.trim());
    return {
      id: info.id as string,
      title: (info.title || "Untitled") as string,
      duration: (info.duration || 0) as number,
      filesize: (info.filesize_approx || info.filesize || 0) as number,
    };
  } catch {
    return null;
  }
}

// ─── Compress video nếu quá lớn ──────────────────────────────────────────────

async function compressVideo(inputPath: string): Promise<boolean> {
  const outputPath = inputPath.replace(".mp4", "_c.mp4");
  try {
    logger.info(`Đang compress: ${path.basename(inputPath)}`);
    await execAsync(
      `ffmpeg -i "${inputPath}" -vcodec libx264 -crf 28 -preset fast ` +
      `-acodec aac -b:a 128k "${outputPath}" -y`
    );
    fs.unlinkSync(inputPath);
    fs.renameSync(outputPath, inputPath);
    return true;
  } catch {
    logger.error("Compress thất bại");
    return false;
  }
}

// ─── Tải 1 video ─────────────────────────────────────────────────────────────

export async function downloadOne(url: string): Promise<boolean> {
  url = url.trim();
  if (!url || url.startsWith("#")) return false;

  // Kiểm tra đã tải chưa
  const existing = await db.videoLibrary.findUnique({ where: { originalUrl: url } });
  if (existing && existing.status !== "failed") {
    logger.info(`Đã có sẵn, bỏ qua: ${url}`);
    return true;
  }

  // Lấy thông tin
  logger.info(`Đang lấy thông tin: ${url}`);
  const info = await getVideoInfo(url);
  if (!info) {
    logger.error(`Không lấy được thông tin: ${url}`);
    await saveFailedUrl(url);
    return false;
  }

  // Kiểm tra thời lượng
  if (info.duration > config.maxVideoDurationSec) {
    logger.warn(`Video quá dài (${info.duration}s), bỏ qua: ${url}`);
    await saveFailedUrl(url);
    return false;
  }

  // Chuẩn bị thư mục
  if (!fs.existsSync(config.videoDir)) {
    fs.mkdirSync(config.videoDir, { recursive: true });
  }

  const filePath = path.resolve(path.join(config.videoDir, `${info.id}.mp4`));

  try {
    logger.info(`Đang tải: ${info.title.substring(0, 60)}`);

    await execAsync(
      `yt-dlp ` +
      `-f "best[height<=720][ext=mp4]/best[height<=720]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" ` +
      `--merge-output-format mp4 ` +
      `--no-playlist ` +
      `--socket-timeout 60 ` +
      `--retries 3 ` +
      `-o "${filePath}" ` +
      `"${url}"`
    );

    if (!fs.existsSync(filePath)) throw new Error("File không tồn tại sau tải");

    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / 1024 / 1024;

    // Compress nếu quá lớn
    if (sizeMB > config.maxVideoSizeMB) {
      logger.warn(`File ${sizeMB.toFixed(0)}MB quá lớn, đang compress...`);
      await compressVideo(filePath);
    }

    const finalStats = fs.statSync(filePath);
    const source = url.includes("douyin") ? "douyin" : "youtube";

    // Lưu vào DB
    await db.videoLibrary.upsert({
      where: { originalUrl: url },
      update: {
        status: "pending_caption",
        localPath: filePath,
        title: info.title,
        duration: info.duration,
        fileSize: finalStats.size,
      },
      create: {
        source,
        originalUrl: url,
        localPath: filePath,
        title: info.title,
        duration: info.duration,
        fileSize: finalStats.size,
        status: "pending_caption",
      },
    });

    logger.success(
      `Tải xong: ${info.title.substring(0, 50)} (${(finalStats.size / 1024 / 1024).toFixed(1)}MB)`
    );
    return true;
  } catch (err: any) {
    logger.error(`Lỗi tải ${url}: ${err.message}`);
    await saveFailedUrl(url);
    return false;
  }
}

async function saveFailedUrl(url: string) {
  await db.videoLibrary.upsert({
    where: { originalUrl: url },
    update: { status: "failed" },
    create: {
      source: "unknown",
      originalUrl: url,
      localPath: "",
      status: "failed",
    },
  });
}

// ─── Tải hàng loạt từ file txt ───────────────────────────────────────────────

export async function bulkDownloadFromFile(filePath: string): Promise<void> {
  const ok = await checkDependencies();
  if (!ok) return;

  if (!fs.existsSync(filePath)) {
    logger.error(`File không tồn tại: ${filePath}`);
    return;
  }

  // Đọc danh sách URL
  const urls: string[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) urls.push(trimmed);
  }

  logger.info(`Tìm thấy ${urls.length} URL`);

  let success = 0;
  let failed = 0;

  // Tải theo batch
  const concurrency = config.downloadConcurrency;
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    logger.info(`Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(urls.length / concurrency)}`);

    const results = await Promise.all(batch.map((url) => downloadOne(url)));
    results.forEach((ok) => (ok ? success++ : failed++));

    // Chờ giữa batch tránh bị chặn
    if (i + concurrency < urls.length) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  logger.success(`Hoàn tất! ✅ ${success} thành công | ❌ ${failed} thất bại`);
}

// ─── Lấy số video sẵn sàng ───────────────────────────────────────────────────

export async function getVideoStats() {
  const [ready, pending, published, failed] = await Promise.all([
    db.videoLibrary.count({ where: { status: "ready" } }),
    db.videoLibrary.count({ where: { status: "pending_caption" } }),
    db.videoLibrary.count({ where: { status: "published" } }),
    db.videoLibrary.count({ where: { status: "failed" } }),
  ]);
  return { ready, pending, published, failed, total: ready + pending + published + failed };
}

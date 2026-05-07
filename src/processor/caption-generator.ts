// src/processor/caption-generator.ts
// Dùng OpenAI để tự động viết caption tiếng Anh từ tiêu đề video

import OpenAI from "openai";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";
import { editVideo } from "./video-editor";
import * as fs from "fs";

const logger = createLogger("CaptionAI");

const ai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// ─── Viết caption cho 1 video ─────────────────────────────────────────────────

async function generateCaption(title: string): Promise<string | null> {
  try {
    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a Japanese viral content creator. For a given video title, generate:
1. A punchy Twitter caption (max 140 chars, with hashtags).
2. A "Top Text" for the video (short, catchy title in Japanese).
3. A "Bottom Text" for the video (funny reaction or call to action in Japanese).

Return ONLY a JSON object:
{
  "caption": "...",
  "topText": "...",
  "bottomText": "..."
}`,
        },
        {
          role: "user",
          content: `Video title: "${title}"`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return null;

    try {
      // AI trả về dạng JSON để lấy cả Caption đăng bài và Text trên video
      const parsed = JSON.parse(content);
      return parsed;
    } catch {
      // Nếu AI không trả về JSON, coi như đó là caption thuần
      return { caption: content, topText: title, bottomText: "最後まで見て 😂" };
    }
  } catch (err: any) {
    logger.error(`OpenAI error: ${err.message}`);
    return null;
  }
}

// ─── Xử lý tất cả video chờ caption ─────────────────────────────────────────

export async function processPendingCaptions(): Promise<void> {
  const videos = await db.videoLibrary.findMany({
    where: { status: "pending_caption" },
    take: 10,
  });

  if (videos.length === 0) return;

  logger.info(`Đang tạo caption cho ${videos.length} video...`);

  for (const video of videos) {
    if (!video.title) {
      await db.videoLibrary.update({
        where: { id: video.id },
        data: {
          caption: "最後まで見て 😂 #おもしろ #あるある #爆笑",
          status: "ready",
        },
      });
      continue;
    }

    const aiResult: any = await generateCaption(video.title);

    if (aiResult) {
      let finalPath = video.localPath;

      // Thực hiện Edit Video nếu file tồn tại
      if (fs.existsSync(video.localPath)) {
        const editedPath = await editVideo(video.localPath, {
          topText: aiResult.topText,
          bottomText: aiResult.bottomText,
          zoom: true,
          mirror: true
        });
        
        if (editedPath) {
          // Xóa file gốc để tiết kiệm dung lượng
          try { fs.unlinkSync(video.localPath); } catch {}
          finalPath = editedPath;
        }
      }

      await db.videoLibrary.update({
        where: { id: video.id },
        data: { 
          caption: aiResult.caption, 
          localPath: finalPath,
          status: "ready" 
        },
      });
      logger.success(`Edit & Caption OK: ${aiResult.caption.substring(0, 60)}...`);
    } else {
      // Lỗi AI → dùng caption dự phòng
      await db.videoLibrary.update({
        where: { id: video.id },
        data: {
          caption: "これはヤバい 😳 #おもしろ #衝撃 #あるある",
          status: "ready",
        },
      });
      logger.warn(`Dùng caption dự phòng cho: ${video.title}`);
    }

    // Chờ 1s giữa các request tránh rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }
}
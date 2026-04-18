// src/processor/caption-generator.ts
// Dùng OpenAI để tự động viết caption tiếng Anh từ tiêu đề video

import OpenAI from "openai";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

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
          content: `You write short, punchy English captions for viral entertainment videos (troll, drama, funny moments).
Rules:
- Max 200 characters (Twitter limit)
- Casual, witty tone - like a meme page
- Add 2-3 relevant hashtags at the end
- No Chinese characters
- Never mention the video source or platform
- Make it feel native English, not translated`,
        },
        {
          role: "user",
          content: `Write a caption for this video: "${title}"`,
        },
      ],
    });

    const caption = response.choices[0]?.message?.content?.trim();
    if (!caption) return null;

    return caption.length > 250 ? caption.substring(0, 247) + "..." : caption;
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
          caption: "Wait for it... 😂 #viral #funny #trending",
          status: "ready",
        },
      });
      continue;
    }

    const caption = await generateCaption(video.title);

    if (caption) {
      await db.videoLibrary.update({
        where: { id: video.id },
        data: { caption, status: "ready" },
      });
      logger.success(`Caption OK: ${caption.substring(0, 60)}...`);
    } else {
      // Lỗi AI → dùng caption dự phòng
      await db.videoLibrary.update({
        where: { id: video.id },
        data: {
          caption: "You won't believe this 😳 #viral #drama #trending",
          status: "ready",
        },
      });
      logger.warn(`Dùng caption dự phòng cho: ${video.title}`);
    }

    // Chờ 1s giữa các request tránh rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }
}
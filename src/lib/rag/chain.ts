/**
 * lib/rag/chain.ts
 *
 * 知识问答 + 知识总结
 *
 * 降级策略（无需 API Key 也可运行）：
 *   - AI_API_KEY 未设置 → 使用纯关键词匹配的 mock 检索 + mock 流式回复
 *   - AI_API_KEY 已设置 → 使用提示词工程 + DashScope API（qwen3.5-plus）
 *
 * 注意：原 RAG 检索代码保留，用于为提示词工程提供上下文
 */

import {
  getFavoritesByCategory,
  getFavorites,
  CategoryId,
  getCategories,
} from "@/lib/mock/data";
import { hasAIKey, getAIModel, buildChatSystemPrompt } from "@/lib/ai-client";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface RagResult {
  context: string;
  sources: { id: string; title: string; category: CategoryId }[];
}

// ─────────────────────────────────────────────
// Mock keyword retrieval（no API key needed）
// ─────────────────────────────────────────────

/**
 * 中文分词：将查询拆分为有意义的词组（2-4字词 + 单字回退）
 */
function segmentChinese(text: string): string[] {
  const tokens: string[] = [];
  // 先提取英文单词
  const englishWords = text.match(/[a-zA-Z]{2,}/g) ?? [];
  tokens.push(...englishWords.map((w) => w.toLowerCase()));
  // 中文部分：提取2-4字的ngram作为候选词
  const chineseOnly = text.replace(/[a-zA-Z0-9\s]+/g, "");
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= chineseOnly.length - len; i++) {
      tokens.push(chineseOnly.slice(i, i + len));
    }
  }
  // 单字回退（低权重，仅在无ngram命中时兜底）
  for (const ch of chineseOnly) {
    tokens.push(ch);
  }
  return [...new Set(tokens)];
}

/**
 * 从 transcript 中提取与查询最相关的段落（而非硬截断）
 */
function extractRelevantParagraphs(
  transcript: string,
  query: string,
  maxChars = 600
): string {
  // 按句号、换行等分段
  const paragraphs = transcript
    .split(/[。\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 10);

  if (paragraphs.length === 0) return transcript.slice(0, maxChars);

  const queryTokens = segmentChinese(query);

  // 为每段打分
  const scored = paragraphs.map((p) => {
    const pLower = p.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (pLower.includes(token.toLowerCase())) {
        score += token.length; // 长词命中权重更高
      }
    }
    return { p, score };
  });

  // 按相关度排序，取最相关的段落拼接
  scored.sort((a, b) => b.score - a.score);
  let result = "";
  for (const { p, score } of scored) {
    if (score === 0 && result.length > 0) break; // 无关段落不再追加
    if (result.length + p.length > maxChars) break;
    result += (result ? "。" : "") + p;
  }

  // 如果相关段落太少，补充开头摘要
  if (result.length < 100) {
    const intro = paragraphs.slice(0, 3).join("。");
    result = intro.slice(0, maxChars);
  }

  return result;
}

function keywordSearch(
  query: string,
  category?: CategoryId,
  topK = 3
): RagResult {
  const list = category ? getFavoritesByCategory(category) : getFavorites();
  const queryTokens = segmentChinese(query);

  const scored = list.map((v) => {
    let score = 0;

    // 标题命中权重最高 (x5)
    const titleLower = v.title.toLowerCase();
    for (const t of queryTokens) {
      if (titleLower.includes(t)) score += 5 * t.length;
    }

    // 标签命中权重次之 (x3)
    const tagsText = v.tags.join(" ").toLowerCase();
    for (const t of queryTokens) {
      if (tagsText.includes(t)) score += 3 * t.length;
    }

    // 描述命中 (x2)
    const descLower = v.description.toLowerCase();
    for (const t of queryTokens) {
      if (descLower.includes(t)) score += 2 * t.length;
    }

    // 正文命中 (x1)，只检查前2000字避免大量遍历
    if (v.transcript) {
      const bodyLower = v.transcript.slice(0, 2000).toLowerCase();
      for (const t of queryTokens) {
        if (bodyLower.includes(t)) score += t.length;
      }
    }

    return { v, score };
  });

  const sorted = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  const topDocs = sorted.slice(0, topK);

  // 如果没有任何匹配，回退取前2条
  if (topDocs.length === 0) {
    topDocs.push(...scored.slice(0, 2));
  }

  const context = topDocs
    .map(({ v }) => `【${v.title}】标签：${v.tags.join("、")}`)
    .join("\n");

  const sources = topDocs.map(({ v }) => ({
    id: v.id,
    title: v.title,
    category: v.category,
  }));

  return { context, sources };
}

// ─────────────────────────────────────────────
// Mock streaming reply（no API key needed）
// ─────────────────────────────────────────────

export async function* mockStreamReply(
  _messages: ChatMessage[],
  ragResult: RagResult
): AsyncGenerator<string> {
  // 无匹配：简短回复
  if (!ragResult.sources.length) {
    yield "暂时没找到相关内容，换个关键词试试？";
    return;
  }

  // 提取收藏来源的关键信息
  const refs = ragResult.sources.slice(0, 3);
  const snippets = ragResult.context
    .split(/---/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 构造自然回复：直接回答 + 引用来源
  const parts: string[] = [];

  // 第一段：从上下文中提取要点，直接作为回答
  const mainSnippet = snippets[0] ?? "";
  const keyContent = mainSnippet
    .replace(/^【[^】]+】\n?/, "")
    .replace(/^标签：[^\n]+\n?/, "")
    .replace(/^内容：/, "")
    .replace(/\n/g, " ")
    .trim();
  const brief = keyContent.slice(0, 120) + (keyContent.length > 120 ? "…" : "");

  if (brief) {
    parts.push(brief);
  }

  // 第二段：附上引用来源
  const refLine = refs.map((s) => `📌《${s.title}》`).join("  ");
  parts.push("\n\n" + refLine);

  const reply = parts.join("");

  // 按 chunk 输出（比逐字快得多）
  const chunkSize = 8;
  for (let i = 0; i < reply.length; i += chunkSize) {
    yield reply.slice(i, i + chunkSize);
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/** @deprecated 使用 hasAIKey() 代替，保留以兼容 chat route 的导入 */
export function hasOpenaiKey(): boolean {
  return hasAIKey();
}

/**
 * Retrieve relevant context from mock data using keyword search.
 */
export function retrieveContext(
  query: string,
  category?: CategoryId
): RagResult {
  return keywordSearch(query, category);
}

// ─────────────────────────────────────────────
// LLM 响应缓存（内存级，避免重复请求）
// ─────────────────────────────────────────────

interface CacheEntry {
  response: string;
  timestamp: number;
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟过期

function getCacheKey(query: string, category?: string): string {
  return `${category ?? "all"}::${query.trim().toLowerCase()}`;
}

function getCachedResponse(key: string): string | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    responseCache.delete(key);
    return null;
  }
  return entry.response;
}

function setCachedResponse(key: string, response: string): void {
  // 限制缓存大小
  if (responseCache.size > 100) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { response, timestamp: Date.now() });
}

/**
 * Build a streaming response using Vercel AI SDK + DashScope API.
 * 使用提示词工程代替 RAG，但仍用关键词检索提供上下文。
 * 支持内存缓存，相同问题直接返回缓存结果。
 */
export async function buildOpenaiStream(
  messages: ChatMessage[],
  ragResult: RagResult,
  category?: string
): Promise<ReadableStream<Uint8Array>> {
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const cacheKey = getCacheKey(lastUserMsg, category);
  const cached = getCachedResponse(cacheKey);

  const encoder = new TextEncoder();

  // 命中缓存：直接流式返回缓存内容
  if (cached) {
    return new ReadableStream({
      start(controller) {
        // 分块输出模拟流式效果
        const chunks = cached.match(/.{1,20}/g) ?? [cached];
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
        }
        controller.enqueue(
          encoder.encode(
            `d:${JSON.stringify({
              finishReason: "stop",
              usage: { promptTokens: 0, completionTokens: 0 },
            })}\n`
          )
        );
        controller.close();
      },
    });
  }

  const { streamText } = await import("ai");
  const model = await getAIModel();

  const systemPrompt = buildChatSystemPrompt(ragResult.context, category);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (streamText as any)({
    model,
    system: systemPrompt,
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
  });

  // 手动将 textStream 包装为 Vercel AI Data Stream 协议
  let fullResponse = "";
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          fullResponse += chunk;
          controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
        }
        // 写入缓存
        setCachedResponse(cacheKey, fullResponse);
        controller.enqueue(
          encoder.encode(
            `d:${JSON.stringify({
              finishReason: "stop",
              usage: { promptTokens: 0, completionTokens: 0 },
            })}\n`
          )
        );
      } catch (err) {
        console.error("[buildOpenaiStream] stream error:", err);
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Summarize a category's videos into a skill package (Markdown).
 * Falls back to template-based summary when no API key.
 */
export async function summarizeCategory(
  category: CategoryId
): Promise<string> {
  const videos = getFavoritesByCategory(category);
  const catMeta = getCategories().find((c) => c.id === category);
  const catDisplayName = catMeta?.name ?? category;

  if (videos.length === 0) {
    return `# ${catDisplayName}\n\n> 该分类暂无收藏视频。`;
  }

  if (!hasAIKey()) {
    const tagSet = new Set(videos.flatMap((v) => v.tags));
    const titleList = videos.map((v) => `- **${v.title}**`).join("\n");
    const topVideos = videos
      .slice(0, 3)
      .map((v) => `- 《${v.title}》— ${v.tags.slice(0, 2).join("、")}`)
      .join("\n");

    return (
      `# ${catDisplayName} 技能包\n\n` +
      `> 基于 ${videos.length} 条收藏视频自动生成（Mock 模式）\n\n` +
      `## 核心知识标签\n\n` +
      Array.from(tagSet)
        .slice(0, 12)
        .map((t) => `\`${t}\``)
        .join(" ") +
      `\n\n## 重点推荐视频\n\n` +
      topVideos +
      `\n\n## 完整收藏清单\n\n` +
      titleList +
      `\n\n## 学习路径建议\n\n` +
      `1. **建立框架**：先浏览所有视频标题，了解该领域的知识全貌\n` +
      `2. **精读核心**：优先观看前 3 条视频，掌握核心概念\n` +
      `3. **动手实践**：结合实战类视频，完成至少一个项目练习\n` +
      `4. **费曼复盘**：用自己的话复述所学，检验理解深度\n\n` +
      `> 💡 配置 \`AI_API_KEY\` 后，将使用 AI 生成更深度的个性化技能总结。`
    );
  }

  // 使用 DashScope API 生成总结
  const { generateText } = await import("ai");
  const model = await getAIModel();

  const videoList = videos
    .map((v) => {
      const content = v.transcript
        ? extractRelevantParagraphs(v.transcript, catDisplayName, 400)
        : v.description;
      return `标题：${v.title}\n标签：${v.tags.join("、")}\n内容：${content}`;
    })
    .join("\n\n---\n\n");

  const { text } = await generateText({
    model,
    prompt:
      `根据以下「${catDisplayName}」领域的 ${videos.length} 条收藏视频，生成技能包。\n` +
      `要求：提炼核心知识点（不超10条）、学习路径（3-5步）、重点视频（3-5条及理由）。Markdown格式，简洁专业。\n\n` +
      `${videoList}`,
  });

  return text;
}

/**
 * lib/ai-client.ts
 *
 * 统一 AI 客户端（兼容 OpenAI 协议）
 * 使用 DashScope / 通义千问 API
 *
 * 环境变量：
 *   AI_API_KEY   — API 密钥
 *   AI_BASE_URL  — API 基础地址（如 https://coding.dashscope.aliyuncs.com/v1）
 *   AI_MODEL     — 模型名称（如 qwen3.5-plus）
 */

export function hasAIKey(): boolean {
  return !!process.env.AI_API_KEY?.trim();
}

export async function getAIModel() {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const provider = createOpenAI({
    apiKey: process.env.AI_API_KEY!,
    baseURL: process.env.AI_BASE_URL || "https://coding.dashscope.aliyuncs.com/v1",
  });
  const modelName = process.env.AI_MODEL || "qwen3.5-plus";
  return provider.chat(modelName);
}

// ─────────────────────────────────────────────
// 提示词模板：知识问答
// ─────────────────────────────────────────────

export function buildChatSystemPrompt(
  _videoContext: string,
  category?: string
): string {
  return `你是「收藏夹知识助手」。${category ? `当前领域：${category}。` : ""}简洁回答，直击要点。`;
}

// ─────────────────────────────────────────────
// 提示词模板：Skill 生成
// ─────────────────────────────────────────────

export function buildSkillGenerationPrompt(
  categoryName: string,
  videoCount: number,
  videoSummaries: string
): string {
  return `# 角色设定
你是一个专业的 Claude Code Skill 生成器。你的任务是将用户收藏的视频内容提炼成一个高质量、可执行的 Skill 定义。

# 输入材料
用户收藏了「${categoryName}」领域的 ${videoCount} 个视频：

${videoSummaries}

# 生成要求

## displayName
- 简洁的中文名称，体现 Skill 的核心能力（如「AI工具实战指南」「美食探店助手」）

## description
- 一句话说清楚这个 Skill 能做什么

## trigger
- 一个自然的中文触发语句，用户说出这句话时激活 Skill

## instructions
- 这是 Skill 的核心。写出详细、具体、可执行的指令
- 必须融合视频中的实际知识点和方法论
- 告诉 AI 在什么场景下应该如何帮助用户
- 不要写空泛的指令（如「提供帮助」），要写具体的行为（如「当用户询问 AI 绘画工具时，推荐 Midjourney、Stable Diffusion 等，并给出参数配置建议」）

## examples（3 个）
- 每个示例必须是真实可用的对话场景
- userInput 是用户可能提的真实问题
- assistantOutput 是基于视频知识的高质量回答，要体现 Skill 的价值

## constraints（2-5 条）
- 明确的限制条件，避免 AI 超出知识范围
- 例如：「不推荐未在视频中出现的付费工具」

## capabilities（3-6 条）
- 列出用户能通过这个 Skill 获得的具体能力
- 每条能力要具体可衡量

## useCases（3-5 条）
- 列出真实的使用场景
- 每个场景要具体到用户行为

# 输出格式
请严格按照 JSON Schema 输出，不要添加额外字段。保持中文输出，语气友好专业。`;
}

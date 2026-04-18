/**
 * lib/skillTemplate.ts
 *
 * Skill 模板生成逻辑
 * 负责将视频内容提炼为符合 Claude Code 规范的 SKILL.md 文件
 */

import { MockVideo, CategoryId, getCategories } from "@/lib/mock/data";
import {
  Skill,
  SkillMetadata,
  SkillContent,
  SkillExample,
} from "@/types/index";
import { hasAIKey, getAIModel, buildSkillGenerationPrompt } from "@/lib/ai-client";

// ─────────────────────────────────────────────
// 辅助：获取分类展示名
// ─────────────────────────────────────────────

function getCategoryDisplayName(catId: CategoryId): string {
  const meta = getCategories().find((c) => c.id === catId);
  return meta?.name ?? catId;
}

// ─────────────────────────────────────────────
// AI Skill 生成（使用 OpenAI）
// ─────────────────────────────────────────────

export async function generateSkillWithAI(
  videos: MockVideo[],
  category: CategoryId,
  customName?: string,
  customDescription?: string
): Promise<Skill> {
  if (!hasAIKey()) {
    return generateSkillFromTemplate(
      videos,
      category,
      customName,
      customDescription
    );
  }

  const { generateObject } = await import("ai");
  const { z } = await import("zod");
  const model = await getAIModel();

  const catDisplayName = getCategoryDisplayName(category);

  const videoSummaries = videos
    .map((v) => {
      const content = v.transcript
        ? v.transcript.slice(0, 500)
        : v.description;
      return `【${v.title}】\n标签：${v.tags.join("、")}\n简介：${v.description}\n内容摘要：${content}`;
    })
    .join("\n\n---\n\n");

  const SkillSchema = z.object({
    displayName: z
      .string()
      .describe("Skill 的展示名称，如「美食写作技巧」"),
    description: z.string().describe("一句话描述 Skill 的功能"),
    trigger: z.string().describe("触发词，如「教你写美食文案」"),
    instructions: z
      .string()
      .describe(
        "Skill 的核心指令，告诉 AI 应该如何表现，要具体可执行"
      ),
    examples: z
      .array(
        z.object({
          userInput: z.string().describe("用户输入示例"),
          assistantOutput: z.string().describe("助手回复示例"),
        })
      )
      .length(3)
      .describe("3 个使用示例"),
    constraints: z
      .array(z.string())
      .min(2)
      .max(5)
      .describe("约束条件，如「不使用过度夸张的形容词」"),
    capabilities: z
      .array(z.string())
      .min(3)
      .max(6)
      .describe("核心能力列表"),
    useCases: z
      .array(z.string())
      .min(3)
      .max(5)
      .describe("使用场景列表"),
  });

  const prompt = buildSkillGenerationPrompt(
    catDisplayName,
    videos.length,
    videoSummaries
  );

  const result = await generateObject({
    model,
    schema: SkillSchema,
    prompt,
  });

  const skillName =
    customName || generateSkillName(category, videos[0]?.tags[0]);
  const metadata: SkillMetadata = {
    name: skillName,
    displayName: result.object.displayName,
    description:
      customDescription || result.object.description,
    category,
    sourceVideoIds: videos.map((v) => v.id),
    createdAt: new Date().toISOString(),
  };

  return {
    ...metadata,
    ...result.object,
  };
}

// ─────────────────────────────────────────────
// 模板生成（无需 API Key）
// ─────────────────────────────────────────────

export function generateSkillFromTemplate(
  videos: MockVideo[],
  category: CategoryId,
  customName?: string,
  customDescription?: string
): Skill {
  const catDisplayName = getCategoryDisplayName(category);
  const allTags = videos.flatMap((v) => v.tags);
  const tagCounts = new Map<string, number>();
  allTags.forEach((tag) => {
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  });
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  const skillName = customName || generateSkillName(category, topTags[0]);

  const displayName = `${catDisplayName}知识助手`;
  const description =
    customDescription ||
    `基于 ${videos.length} 个${catDisplayName}相关视频生成的知识技能包`;

  const examples: SkillExample[] = [
    {
      userInput: `请介绍一下${catDisplayName}领域的核心概念`,
      assistantOutput: `根据你收藏的视频，${catDisplayName}领域主要涵盖：${topTags.slice(0, 3).join("、")}等方面。这些是该领域的核心知识点。`,
    },
    {
      userInput: `给我推荐几个${catDisplayName}相关的学习资源`,
      assistantOutput: `基于你的收藏，我推荐以下内容：${videos.slice(0, 3).map((v) => v.title).join("、")}。这些资源涵盖了${catDisplayName}的重要知识。`,
    },
    {
      userInput: `如何快速入门${catDisplayName}？`,
      assistantOutput: `建议从以下步骤开始：1) 了解基础概念；2) 学习核心技能；3) 实践应用。你收藏的视频中有很多相关内容可以参考。`,
    },
  ];

  const metadata: SkillMetadata = {
    name: skillName,
    displayName,
    description,
    category,
    sourceVideoIds: videos.map((v) => v.id),
    createdAt: new Date().toISOString(),
  };

  const content: SkillContent = {
    trigger: `帮我学习${catDisplayName}知识`,
    instructions: `你是一个${catDisplayName}领域的知识助手，基于用户收藏的 ${videos.length} 个视频内容提供帮助。

核心知识点包括：${topTags.join("、")}。

当用户提问时，你应该：
1. 根据收藏视频的内容提供准确的回答
2. 引用具体的视频标题作为知识来源
3. 用简洁易懂的语言解释概念
4. 提供实用的学习建议和实践方法
5. 保持友好、专业的语气

请帮助用户充分利用这些收藏的知识资源。`,
    examples,
    constraints: [
      "仅基于用户收藏的视频内容回答问题",
      "不编造不存在的视频或内容",
      "保持客观，不过度夸张",
      "承认不确定性，不强行解释",
    ],
    capabilities: [
      `解答${catDisplayName}相关问题`,
      "推荐学习资源和路径",
      "提供实践建议",
      "整理知识脉络",
    ],
    useCases: [
      "快速查询特定知识点",
      "制定学习计划",
      "获取实践指导",
      "复习巩固知识",
    ],
  };

  return {
    ...metadata,
    ...content,
  };
}

// ─────────────────────────────────────────────
// 生成 SKILL.md 文件内容
// ─────────────────────────────────────────────

export function generateSkillMarkdown(
  skill: Skill,
  videos: MockVideo[]
): string {
  const catDisplayName = getCategoryDisplayName(skill.category);

  const examplesSection = skill.examples
    .map(
      (ex, idx) => `### 示例 ${idx + 1}

\`\`\`
用户：${ex.userInput}
助手：${ex.assistantOutput}
\`\`\`
`
    )
    .join("\n");

  const videoList = videos
    .map((v) => `- **${v.title}**`)
    .join("\n");

  return `# ${skill.displayName}

${skill.description}

## 使用场景

${skill.useCases.map((uc) => `- ${uc}`).join("\n")}

## 核心能力

基于用户收藏的「${catDisplayName}」领域视频，本 Skill 能够：

${skill.capabilities.map((cap, idx) => `${idx + 1}. ${cap}`).join("\n")}

## 使用示例

${examplesSection}

## 约束条件

${skill.constraints.map((con) => `- ${con}`).join("\n")}

---

## 核心指令

${skill.instructions}

## 知识来源

本 Skill 基于以下 ${videos.length} 个收藏视频生成：

${videoList}

> **生成时间**：${new Date(skill.createdAt).toLocaleString("zh-CN")}
> **领域**：${catDisplayName}
> **视频数量**：${videos.length}
> **Skill ID**：\`${skill.name}\`

---

<sub>由 FavToSkill 自动生成</sub>
`;
}

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

export function generateSkillName(
  category: CategoryId,
  mainTag?: string
): string {
  const categorySlug = category
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "");

  const tagSlug = mainTag
    ? mainTag
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
    : "";

  const base = tagSlug ? `${categorySlug}-${tagSlug}` : categorySlug;
  return `${base}-skill`;
}

export function validateSkillName(name: string): {
  valid: boolean;
  error?: string;
} {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Skill 名称不能为空" };
  }

  if (!/^[a-z0-9\u4e00-\u9fa5]+(-[a-z0-9\u4e00-\u9fa5]+)*$/.test(name)) {
    return {
      valid: false,
      error: "Skill 名称必须使用 kebab-case 格式（小写字母、数字、中文，用连字符分隔）",
    };
  }

  return { valid: true };
}

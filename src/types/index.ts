import { MockVideo, CategoryId } from "@/lib/mock/data";

// Skill 相关类型定义

export interface SkillMetadata {
  name: string; // kebab-case 格式，如 "cooking-style-writing"
  displayName: string; // 展示名称，如 "美食写作技巧"
  description: string; // 一句话描述
  category: CategoryId; // 所属领域
  sourceVideoIds: string[]; // 来源视频 ID 列表
  createdAt: string; // 生成时间 ISO 8601
}

export interface SkillContent {
  trigger: string; // 触发词，如 "教你写美食文案"
  instructions: string; // 核心指令
  examples: SkillExample[]; // 使用示例
  constraints: string[]; // 约束条件
  capabilities: string[]; // 核心能力
  useCases: string[]; // 使用场景
}

export interface SkillExample {
  userInput: string;
  assistantOutput: string;
}

export interface Skill extends SkillMetadata, SkillContent {}

export interface GenerateSkillRequest {
  category: CategoryId;
  videoIds: string[];
  skillName?: string;
  skillDescription?: string;
  mode?: "default" | "advanced";
}

export interface GenerateSkillResponse {
  success: boolean;
  skillPath?: string;
  skillName?: string;
  skillContent?: string;
  usageExample?: string;
  error?: string;
}

export interface SkillPreviewResponse {
  skillContent: string;
  metadata: SkillMetadata;
}

// Re-export for convenience
export type { MockVideo, CategoryId };
/** @deprecated Use CategoryId instead */
export type VideoCategory = CategoryId;

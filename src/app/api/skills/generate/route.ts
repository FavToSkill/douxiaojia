/**
 * app/api/skills/generate/route.ts
 *
 * Skill 生成 API 端点
 * POST /api/skills/generate
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getFavorites } from "@/lib/mock/data";
import {
  generateSkillWithAI,
  generateSkillMarkdown,
  validateSkillName,
} from "@/lib/skillTemplate";
import {
  GenerateSkillRequest,
  GenerateSkillResponse,
} from "@/types/index";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body: GenerateSkillRequest = await req.json();
    const { category, videoIds, skillName, skillDescription, mode } = body;

    // 验证必填字段
    if (!category || !videoIds || videoIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "category 和 videoIds 是必填字段",
        } as GenerateSkillResponse,
        { status: 400 }
      );
    }

    // 验证 Skill 名称格式（如果提供）
    if (skillName) {
      const validation = validateSkillName(skillName);
      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: validation.error,
          } as GenerateSkillResponse,
          { status: 400 }
        );
      }
    }

    // 获取所有视频
    const allVideos = getFavorites();

    // 筛选出指定的视频
    const selectedVideos = allVideos.filter((v) =>
      videoIds.includes(v.id)
    );

    if (selectedVideos.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "未找到匹配的视频",
        } as GenerateSkillResponse,
        { status: 404 }
      );
    }

    // 验证视频是否属于指定分类
    const categoryMismatch = selectedVideos.some(
      (v) => v.category !== category
    );
    if (categoryMismatch) {
      return NextResponse.json(
        {
          success: false,
          error: "部分视频不属于指定分类",
        } as GenerateSkillResponse,
        { status: 400 }
      );
    }

    // 生成 Skill
    const skill = await generateSkillWithAI(
      selectedVideos,
      category,
      skillName,
      skillDescription
    );

    // 生成 Markdown 内容
    const skillContent = generateSkillMarkdown(skill, selectedVideos);

    // 写入文件系统
    const skillDir = join(process.cwd(), ".claude", "skills", skill.name);
    const skillFilePath = join(skillDir, "SKILL.md");

    // 确保目录存在
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }

    // 写入文件
    writeFileSync(skillFilePath, skillContent, "utf-8");

    // 返回成功响应
    return NextResponse.json({
      success: true,
      skillPath: `.claude/skills/${skill.name}/SKILL.md`,
      skillName: skill.name,
      skillContent,
      usageExample: `/${skill.name}`,
    } as GenerateSkillResponse);
  } catch (error) {
    console.error("[Skill Generate Error]", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "生成 Skill 时发生未知错误",
      } as GenerateSkillResponse,
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { summarizeCategory } from "@/lib/rag/chain";
import {
  CategoryId,
  getFavoritesByCategory,
  getCategories,
  findCategoryId,
} from "@/lib/mock/data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rawCategory: string = body.category;

  // 支持 CategoryId ("tech") 或中文名 ("科技")
  const category: CategoryId | undefined = findCategoryId(rawCategory);
  const validIds = getCategories().map((c) => c.id);

  if (!category || !validIds.includes(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${validIds.join(", ")}` },
      { status: 400 }
    );
  }

  const markdown = await summarizeCategory(category);
  const videoCount = getFavoritesByCategory(category).length;

  return NextResponse.json({ markdown, category, videoCount });
}

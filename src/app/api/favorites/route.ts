import { NextRequest, NextResponse } from "next/server";
import { getFavoritesPage, findCategoryId, CategoryId } from "@/lib/mock/data";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawCategory = searchParams.get("category");
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 10)));

  // 支持 CategoryId ("tech") 或中文名 ("科技") 作为查询参数
  let category: CategoryId | undefined;
  if (rawCategory) {
    category = findCategoryId(rawCategory) ?? (rawCategory as CategoryId);
  }

  const result = getFavoritesPage(category, page, limit);
  return NextResponse.json(result);
}

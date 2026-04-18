import { NextResponse } from "next/server";
import { getCategories } from "@/lib/mock/data";

export const runtime = "nodejs";

export async function GET() {
  const categories = getCategories();
  return NextResponse.json({ data: categories });
}

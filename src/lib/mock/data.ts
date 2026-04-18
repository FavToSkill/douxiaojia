import path from "path";
import { readFileSync, existsSync } from "fs";

// ─────────────────────────────────────────────
// 分类 ID — 与 categories.json 中的 id 对齐
// ─────────────────────────────────────────────

export type CategoryId =
  | "tech"
  | "jieshuo"
  | "food"
  | "trip"
  | "renwen"
  | "game"
  | "knowledge";

// ─────────────────────────────────────────────
// 视频数据类型
// ─────────────────────────────────────────────

export interface MockVideo {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: CategoryId;
  savedAt: string; // ISO 8601
  transcript?: string; // 视频文字稿（用于 RAG）
  // 以下字段在实际抖音数据中存在，mock 数据中可能缺失
  author?: string;
  thumbnail?: string;
  url?: string;
  duration?: number; // seconds
  viewCount?: number;
}

export interface CategoryMeta {
  id: CategoryId;
  name: string; // 展示名称，如"科技"、"美食"
  description: string;
  videoCount: number;
  color: string;
  colorDark?: string;
  emoji?: string;
  icon?: string;
  topTags: string[];
}

// ─────────────────────────────────────────────
// JSON 加载器
// ─────────────────────────────────────────────

function loadJson<T>(filename: string): T {
  const filePath = path.join(process.cwd(), "public", "mock", filename);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

let _favorites: MockVideo[] | null = null;
let _categories: CategoryMeta[] | null = null;

/**
 * 加载所有收藏视频。
 * 优先读取 favorites.json；不存在时自动合并各分类文件。
 */
export function getFavorites(): MockVideo[] {
  if (!_favorites) {
    const favPath = path.join(
      process.cwd(),
      "public",
      "mock",
      "favorites.json"
    );

    if (existsSync(favPath)) {
      _favorites = loadJson<MockVideo[]>("favorites.json");
    } else {
      _favorites = loadFavoritesFromParts();
    }
  }
  return _favorites;
}

export function getCategories(): CategoryMeta[] {
  if (!_categories)
    _categories = loadJson<CategoryMeta[]>("categories.json");
  return _categories;
}

// ─────────────────────────────────────────────
// 自动合并各分类 JSON 文件
// ─────────────────────────────────────────────

interface RawFavorite {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  savedAt: string;
  transcript?: string;
}

// 中文分类名 → CategoryId
const CATEGORY_NAME_MAP: Record<string, CategoryId> = {
  科技: "tech",
  美食: "food",
  解说: "jieshuo",
  旅行: "trip",
  人文: "renwen",
  游戏: "game",
  知识: "knowledge",
  商业财经: "knowledge",
};

/**
 * 读取 public/mock/ 下所有 *_favorites.json 文件并合并为 MockVideo[]。
 * category 字段根据文件名前缀或原始 category 字段映射为 CategoryId。
 */
function loadFavoritesFromParts(): MockVideo[] {
  const mockDir = path.join(process.cwd(), "public", "mock");

  // 文件名前缀 → CategoryId
  const fileMap: Record<string, CategoryId> = {
    tech: "tech",
    food: "food",
    jieshuo: "jieshuo",
    trip: "trip",
    chuanda: "renwen",
    game: "game",
    knowledge: "knowledge",
  };

  const all: MockVideo[] = [];

  for (const [prefix, catId] of Object.entries(fileMap)) {
    const filePath = path.join(mockDir, `${prefix}_favorites.json`);
    if (!existsSync(filePath)) continue;

    const raw = JSON.parse(
      readFileSync(filePath, "utf-8")
    ) as RawFavorite | RawFavorite[];

    const items = Array.isArray(raw) ? raw : [raw];

    for (const item of items) {
      all.push({
        id: item.id,
        title: item.title,
        description: item.description,
        tags: item.tags,
        category: CATEGORY_NAME_MAP[item.category] ?? catId,
        savedAt: item.savedAt,
        transcript: item.transcript,
      });
    }
  }

  return all;
}

// ─────────────────────────────────────────────
// 查询辅助函数
// ─────────────────────────────────────────────

export function getFavoritesByCategory(category: CategoryId): MockVideo[] {
  return getFavorites().filter((v) => v.category === category);
}

export function getFavoritesPage(
  category?: CategoryId,
  page = 1,
  limit = 10
): { data: MockVideo[]; total: number; page: number; limit: number } {
  let list = getFavorites();
  if (category) list = list.filter((v) => v.category === category);
  const total = list.length;
  const data = list.slice((page - 1) * limit, page * limit);
  return { data, total, page, limit };
}

/**
 * 根据分类名称（中文）或 ID 查找 CategoryId。
 * 例如 "科技" → "tech"，"tech" → "tech"
 */
export function findCategoryId(nameOrId: string): CategoryId | undefined {
  if (nameOrId in CATEGORY_NAME_MAP) {
    return CATEGORY_NAME_MAP[nameOrId];
  }
  const categories = getCategories();
  const cat = categories.find((c) => c.id === nameOrId || c.name === nameOrId);
  return cat?.id;
}

/**
 * 构建 RAG 上下文字符串。
 * 如果视频有 transcript 则使用 transcript，否则使用 description。
 */
export function buildRagContext(category?: CategoryId): string {
  let list = getFavorites();
  if (category) list = list.filter((v) => v.category === category);

  return list
    .map((v) => {
      const content = v.transcript
        ? v.transcript.slice(0, 600)
        : v.description;
      return `【${v.title}】\n标签：${v.tags.join("、")}\n内容：${content}`;
    })
    .join("\n\n---\n\n");
}

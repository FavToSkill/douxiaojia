#!/usr/bin/env tsx
/**
 * scripts/ingest.ts
 *
 * Data ingestion pipeline: reads mock favorites → splits text → embeds → stores in Chroma
 *
 * Phase 1 (no OPENAI_API_KEY): dry-run, prints stats only
 * Phase 2 (OPENAI_API_KEY set): runs full embedding + Chroma upsert
 *
 * Usage: npm run ingest
 */

import path from "path";
import { readFileSync } from "fs";

interface MockVideo {
  id: string;
  title: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  duration: number;
  savedAt: string;
}

function loadFavorites(): MockVideo[] {
  const filePath = path.join(process.cwd(), "public", "mock", "favorites.json");
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function buildDocText(video: MockVideo): string {
  return (
    `【${video.category}】${video.title}\n` +
    `作者：${video.author}\n` +
    `标签：${video.tags.join("、")}\n` +
    `摘要：${video.description}`
  );
}

async function ingestWithOpenAI(videos: MockVideo[]) {
  console.log("🚀 Starting real ingestion with OpenAI embeddings + Chroma...\n");

  const { OpenAIEmbeddings } = await import("@langchain/openai");
  const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
  const { Chroma } = await import("@langchain/community/vectorstores/chroma");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs: any[] = [];
  for (const video of videos) {
    const text = buildDocText(video);
    const chunks = await splitter.createDocuments(
      [text],
      [{ videoId: video.id, category: video.category, title: video.title, savedAt: video.savedAt }]
    );
    docs.push(...chunks);
  }

  console.log(`📄 Created ${docs.length} chunks from ${videos.length} videos`);

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "text-embedding-3-small",
  });

  await Chroma.fromDocuments(docs, embeddings, {
    collectionName: "favtoskill",
    url: "http://localhost:8000",
  });

  console.log(`\n✅ Ingestion complete! ${docs.length} chunks stored in Chroma.`);
  console.log(`   Collection: favtoskill`);
}

function dryRun(videos: MockVideo[]) {
  console.log("ℹ️  OPENAI_API_KEY not set — running in dry-run mode.\n");

  const categoryCounts: Record<string, number> = {};
  for (const v of videos) {
    categoryCounts[v.category] = (categoryCounts[v.category] ?? 0) + 1;
  }

  console.log(`📊 Mock data summary (${videos.length} videos total):\n`);
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`   ${cat.padEnd(10)} ${count} 条`);
  }

  console.log("\n📝 Sample document (what would be embedded):\n");
  console.log(buildDocText(videos[0]));
  console.log("\n💡 To run real ingestion:");
  console.log("   1. Set OPENAI_API_KEY in .env.local");
  console.log("   2. Start Chroma: docker run -p 8000:8000 chromadb/chroma");
  console.log("   3. Run: npm run ingest");
}

async function main() {
  const videos = loadFavorites();

  if (process.env.OPENAI_API_KEY?.trim()) {
    await ingestWithOpenAI(videos);
  } else {
    dryRun(videos);
  }
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});

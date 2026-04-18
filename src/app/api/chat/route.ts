import { NextRequest, NextResponse } from "next/server";
import {
  retrieveContext,
  mockStreamReply,
  buildOpenaiStream,
  hasOpenaiKey,
  ChatMessage,
} from "@/lib/rag/chain";
import { CategoryId } from "@/lib/mock/data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = body.messages ?? [];
    const category: CategoryId | undefined = body.category;

    if (!messages.length) {
      return NextResponse.json(
        { error: "messages is required" },
        { status: 400 }
      );
    }

    const lastUserMsg =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

    // Retrieve relevant context via keyword search
    const ragResult = retrieveContext(lastUserMsg, category);

    // ── Real AI path ──────────────────────────────────────────
    if (hasOpenaiKey()) {
      try {
        const stream = await buildOpenaiStream(messages, ragResult, category);
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "x-vercel-ai-data-stream": "v1",
          },
        });
      } catch (aiErr) {
        console.error("[chat] AI stream error, falling back to mock:", aiErr);
        // 降级到 mock 路径
      }
    }

    // ── Mock streaming path (no API key or AI error fallback) ──
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of mockStreamReply(messages, ragResult)) {
          // Vercel AI SDK Data Stream Protocol: `0:<json-encoded-text>\n`
          controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
        }
        // Finish signal
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

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-vercel-ai-data-stream": "v1",
      },
    });
  } catch (err) {
    console.error("[chat] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

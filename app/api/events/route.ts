import { NextRequest } from "next/server";
import emitter from "@/lib/events";
import store from "@/lib/store";
import { v4 as uuidv4 } from "uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const clientId = uuidv4();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      emitter.addClient({ id: clientId, controller, encoder });
      console.log(`[SSE] emitter client count at emit time: ${emitter.clientCount()}`);

      // Send initial ping
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`));

      // Send current persisted state to newly connected client
      try {
        const currentState = store.getState();
        console.log(`[SSE] Client ${clientId} connected. Sending initial state: ${currentState.documents.length} docs, ${currentState.borrowers.length} borrowers`);
        const initEvent = { type: "state:updated", data: currentState };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initEvent)}\n\n`));
      } catch (e) {
        console.error("[SSE] Failed to send initial state:", e);
      }

      // Keep-alive ping every 25s
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`));
        } catch {
          clearInterval(interval);
        }
      }, 25000);
    },
    cancel() {
      emitter.removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

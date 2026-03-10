"use client";

import { useEffect, useRef, useCallback } from "react";
import type { SSEEvent } from "@/lib/types";

export function useSSE(onEvent: (event: SSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onopen = () => {
      console.log("[SSE] Connection opened");
    };

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        if (event.type === "ping") return;
        console.log(`[SSE] Event: ${event.type}`, "documentId" in event ? event.documentId : "");
        onEventRef.current(event);
      } catch (err) {
        console.warn("[SSE] Failed to parse event data:", e.data, err);
      }
    };

    es.onerror = () => {
      console.warn(`[SSE] Error/disconnect (readyState=${es.readyState}) — will auto-reconnect`);
    };

    return () => {
      es.close();
    };
  }, []);
}

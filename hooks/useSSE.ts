"use client";

import { useEffect, useRef, useCallback } from "react";
import type { SSEEvent } from "@/lib/types";

export function useSSE(onEvent: (event: SSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        if (event.type !== "ping") {
          onEventRef.current(event);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
    };
  }, []);
}

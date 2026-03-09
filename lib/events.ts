import type { SSEEvent, SystemState } from "./types";

type Client = {
  id: string;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

class EventEmitter {
  private clients: Client[] = [];

  addClient(client: Client) {
    this.clients.push(client);
    console.log(`[emitter] Client added. Total: ${this.clients.length}`);
  }

  removeClient(id: string) {
    this.clients = this.clients.filter((c) => c.id !== id);
    console.log(`[emitter] Client removed. Total: ${this.clients.length}`);
  }

  emit(event: SSEEvent) {
    console.log(`[emitter] Emitting ${event.type} to ${this.clients.length} clients`);
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.controller.enqueue(client.encoder.encode(data));
      } catch {
        // client disconnected
        this.removeClient(client.id);
      }
    }
  }

  emitStateUpdate(state: Partial<SystemState>, documentId?: string) {
    this.emit({ type: "state:updated", documentId, data: state });
  }

  clientCount() {
    return this.clients.length;
  }
}

declare global {
  var _sseEmitter: EventEmitter | undefined;
}

if (!globalThis._sseEmitter) {
  console.log("[events] Creating new EventEmitter singleton");
  globalThis._sseEmitter = new EventEmitter();
}

const emitter = globalThis._sseEmitter;
export default emitter;

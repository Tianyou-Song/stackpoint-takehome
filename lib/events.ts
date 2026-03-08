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
  }

  removeClient(id: string) {
    this.clients = this.clients.filter((c) => c.id !== id);
  }

  emit(event: SSEEvent) {
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

const emitter = new EventEmitter();
export default emitter;

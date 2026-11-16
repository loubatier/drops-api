import { EventEmitter } from 'node:events';

export interface DomainEvents {
  'drop:created': unknown;
  'drop:updated': unknown;
  'drop:deleted': unknown;
  'like:updated': unknown;
  'comment:created': unknown;
  'comment:deleted': unknown;
  'drop:opened': unknown;
}

type Listener<K extends keyof DomainEvents> = (payload: DomainEvents[K], source?: unknown) => void;

class TypedBus {
  private emitter = new EventEmitter();

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K], source?: unknown): void {
    this.emitter.emit(event, payload, source);
  }

  on<K extends keyof DomainEvents>(event: K, listener: Listener<K>): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}

export const events = new TypedBus();

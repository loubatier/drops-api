import { EventEmitter } from 'node:events';

export interface DomainEvents {
  'drop:created': unknown;
  'drop:updated': unknown;
  'drop:deleted': unknown;
  'like:updated': unknown;
  'comment:created': unknown;
}

class TypedBus {
  private emitter = new EventEmitter();

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}

export const events = new TypedBus();

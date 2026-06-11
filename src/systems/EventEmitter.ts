import { RPGEvent, RPGEventType, EventCallback } from '../types';

export class EventEmitter {
  private listeners: Map<RPGEventType, Set<EventCallback>> = new Map();

  on(eventType: RPGEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType: RPGEventType, callback: EventCallback): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  emit(eventType: RPGEventType, payload: Record<string, any> = {}): void {
    const event: RPGEvent = {
      type: eventType,
      payload,
      timestamp: Date.now(),
    };

    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(event);
        } catch (e) {
          console.error(`Error in event listener for ${eventType}:`, e);
        }
      });
    }

    const allCallbacks = this.listeners.get('*' as RPGEventType);
    if (allCallbacks) {
      allCallbacks.forEach((cb) => {
        try {
          cb(event);
        } catch (e) {
          console.error(`Error in wildcard event listener:`, e);
        }
      });
    }
  }

  once(eventType: RPGEventType, callback: EventCallback): () => void {
    const wrapper = (event: RPGEvent) => {
      callback(event);
      this.off(eventType, wrapper);
    };
    return this.on(eventType, wrapper);
  }

  removeAllListeners(eventType?: RPGEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(eventType: RPGEventType): number {
    return this.listeners.get(eventType)?.size || 0;
  }
}

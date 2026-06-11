import { AttributeConfig } from '../types';
import { EventEmitter } from './EventEmitter';

export class AttributeSystem extends EventEmitter {
  private configs: Map<string, AttributeConfig> = new Map();
  private values: Map<string, number> = new Map();

  constructor(configs: AttributeConfig[] = []) {
    super();
    configs.forEach((config) => this.addAttributeConfig(config));
  }

  addAttributeConfig(config: AttributeConfig): void {
    this.configs.set(config.id, config);
    if (!this.values.has(config.id)) {
      this.values.set(config.id, config.minValue ?? 0);
    }
  }

  getAttributeConfig(id: string): AttributeConfig | undefined {
    return this.configs.get(id);
  }

  getAllAttributeConfigs(): AttributeConfig[] {
    return Array.from(this.configs.values());
  }

  getValue(attributeId: string): number {
    return this.values.get(attributeId) ?? 0;
  }

  setValue(attributeId: string, value: number, source?: string): number {
    const config = this.configs.get(attributeId);
    let finalValue = value;

    if (config) {
      if (config.minValue !== undefined) {
        finalValue = Math.max(config.minValue, finalValue);
      }
      if (config.maxValue !== undefined) {
        finalValue = Math.min(config.maxValue, finalValue);
      }
    }

    const oldValue = this.values.get(attributeId) ?? 0;
    this.values.set(attributeId, finalValue);

    if (oldValue !== finalValue) {
      this.emit('attributeChange', {
        attributeId,
        oldValue,
        newValue: finalValue,
        source,
      });
    }

    return finalValue;
  }

  addValue(attributeId: string, amount: number, source?: string): number {
    const current = this.getValue(attributeId);
    return this.setValue(attributeId, current + amount, source);
  }

  subtractValue(attributeId: string, amount: number, source?: string): number {
    return this.addValue(attributeId, -amount, source);
  }

  getAllValues(): Record<string, number> {
    const result: Record<string, number> = {};
    this.values.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  setValues(values: Record<string, number>, source?: string): void {
    Object.entries(values).forEach(([id, value]) => {
      this.setValue(id, value, source);
    });
  }

  reset(): void {
    this.values.clear();
    this.configs.forEach((config) => {
      this.values.set(config.id, config.minValue ?? 0);
    });
  }

  toJSON(): Record<string, number> {
    return this.getAllValues();
  }

  fromJSON(data: Record<string, number>): void {
    Object.entries(data).forEach(([id, value]) => {
      this.values.set(id, value);
    });
  }
}

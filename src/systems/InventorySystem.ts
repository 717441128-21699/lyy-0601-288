import { ItemConfig, InventoryItem, ItemEffect } from '../types';
import { EventEmitter } from './EventEmitter';

export class InventorySystem extends EventEmitter {
  private itemConfigs: Map<string, ItemConfig> = new Map();
  private items: Map<string, number> = new Map();
  private gold: number = 0;
  private validateValues: boolean;
  private clampNegativeValues: boolean;

  constructor(
    configs: ItemConfig[] = [],
    initialGold: number = 0,
    options: { validateValues?: boolean; clampNegativeValues?: boolean } = {}
  ) {
    super();
    this.validateValues = options.validateValues ?? true;
    this.clampNegativeValues = options.clampNegativeValues ?? true;
    configs.forEach((config) => this.addItemConfig(config));
    this.gold = this.sanitizeAmount(initialGold, 0);
  }

  private isValidNumber(value: any): value is number {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
  }

  private sanitizeAmount(value: number, min: number = 0, max?: number): number {
    if (!this.isValidNumber(value)) {
      return 0;
    }
    let result = value;
    if (this.clampNegativeValues) {
      result = Math.max(min, result);
    }
    if (max !== undefined) {
      result = Math.min(max, result);
    }
    return Math.floor(result);
  }

  addItemConfig(config: ItemConfig): void {
    this.itemConfigs.set(config.id, config);
  }

  getItemConfig(id: string): ItemConfig | undefined {
    return this.itemConfigs.get(id);
  }

  getAllItemConfigs(): ItemConfig[] {
    return Array.from(this.itemConfigs.values());
  }

  getItemCount(itemId: string): number {
    return this.items.get(itemId) ?? 0;
  }

  hasItem(itemId: string, quantity: number = 1): boolean {
    if (!this.isValidNumber(quantity)) return false;
    return this.getItemCount(itemId) >= Math.max(0, quantity);
  }

  addItem(itemId: string, quantity: number = 1): boolean {
    if (!this.isValidNumber(quantity)) return false;

    const safeQuantity = this.sanitizeAmount(quantity, 0, 99999);
    if (safeQuantity <= 0) return false;

    const config = this.getItemConfig(itemId);
    if (!config) return false;

    const current = this.getItemCount(itemId);
    const maxStack = config.maxStack ?? 99;

    if (!config.stackable && current >= 1) {
      return false;
    }

    const newQuantity = Math.min(maxStack, current + safeQuantity);
    const added = newQuantity - current;

    if (added <= 0) return false;

    this.items.set(itemId, newQuantity);

    this.emit('itemAdded', {
      itemId,
      quantity: added,
      total: newQuantity,
      config,
    });

    return true;
  }

  addItems(items: { itemId: string; quantity: number }[]): {
    success: { itemId: string; quantity: number }[];
    failed: { itemId: string; quantity: number; reason: string }[];
  } {
    const success: { itemId: string; quantity: number }[] = [];
    const failed: { itemId: string; quantity: number; reason: string }[] = [];

    items.forEach(({ itemId, quantity }) => {
      if (this.addItem(itemId, quantity)) {
        success.push({ itemId, quantity });
      } else {
        failed.push({ itemId, quantity, reason: 'add_failed' });
      }
    });

    return { success, failed };
  }

  removeItem(itemId: string, quantity: number = 1): boolean {
    if (!this.isValidNumber(quantity)) return false;

    const safeQuantity = this.sanitizeAmount(quantity, 0, 99999);
    if (safeQuantity <= 0) return false;

    const current = this.getItemCount(itemId);

    if (current < safeQuantity) return false;

    const newQuantity = current - safeQuantity;

    if (newQuantity <= 0) {
      this.items.delete(itemId);
    } else {
      this.items.set(itemId, newQuantity);
    }

    this.emit('itemRemoved', {
      itemId,
      quantity: safeQuantity,
      total: newQuantity,
    });

    return true;
  }

  removeItems(items: { itemId: string; quantity: number }[]): {
    success: { itemId: string; quantity: number }[];
    failed: { itemId: string; quantity: number; reason: string }[];
  } {
    const success: { itemId: string; quantity: number }[] = [];
    const failed: { itemId: string; quantity: number; reason: string }[] = [];

    for (const { itemId, quantity } of items) {
      if (this.removeItem(itemId, quantity)) {
        success.push({ itemId, quantity });
      } else {
        failed.push({
          itemId,
          quantity,
          reason: this.getItemCount(itemId) < Math.max(0, quantity) ? 'not_enough' : 'remove_failed',
        });
      }
    }

    return { success, failed };
  }

  useItem(itemId: string, targetCharacterId?: string): ItemEffect[] | null {
    const config = this.getItemConfig(itemId);
    if (!config || !config.usable) return null;
    if (!this.hasItem(itemId, 1)) return null;

    this.removeItem(itemId, 1);

    const effects = config.effects || [];

    this.emit('itemUsed', {
      itemId,
      targetCharacterId,
      effects,
      config,
    });

    return effects;
  }

  getGold(): number {
    return this.gold;
  }

  addGold(amount: number): number {
    if (!this.isValidNumber(amount)) return this.gold;

    const safeAmount = this.sanitizeAmount(amount, 0);
    const oldGold = this.gold;
    this.gold += safeAmount;

    if (safeAmount !== 0) {
      this.emit('goldChange', {
        oldValue: oldGold,
        newValue: this.gold,
        change: safeAmount,
        type: 'add',
      });
    }

    return this.gold;
  }

  spendGold(amount: number): boolean {
    if (!this.isValidNumber(amount)) return false;

    const safeAmount = this.sanitizeAmount(amount, 0);
    if (safeAmount <= 0) return false;

    if (this.gold < safeAmount) return false;

    const oldGold = this.gold;
    this.gold -= safeAmount;

    this.emit('goldChange', {
      oldValue: oldGold,
      newValue: this.gold,
      change: -safeAmount,
      type: 'spend',
    });

    return true;
  }

  setGold(amount: number): number {
    if (!this.isValidNumber(amount)) return this.gold;

    const oldGold = this.gold;
    this.gold = this.sanitizeAmount(amount, 0);

    if (oldGold !== this.gold) {
      this.emit('goldChange', {
        oldValue: oldGold,
        newValue: this.gold,
        change: this.gold - oldGold,
        type: 'set',
      });
    }

    return this.gold;
  }

  canAfford(amount: number): boolean {
    if (!this.isValidNumber(amount)) return false;
    return this.gold >= this.sanitizeAmount(amount, 0);
  }

  setItemCount(itemId: string, quantity: number): boolean {
    const config = this.itemConfigs.get(itemId);
    if (!config) return false;
    if (!this.isValidNumber(quantity)) return false;

    const maxStack = config.maxStack ?? 999;
    const safeQty = this.sanitizeAmount(quantity, 0, maxStack);

    if (safeQty <= 0) {
      this.items.delete(itemId);
    } else {
      this.items.set(itemId, safeQty);
    }
    return true;
  }

  getAllItems(): InventoryItem[] {
    const result: InventoryItem[] = [];
    this.items.forEach((quantity, itemId) => {
      result.push({ itemId, quantity });
    });
    return result;
  }

  getItemsByType(type: ItemConfig['type']): InventoryItem[] {
    return this.getAllItems().filter((item) => {
      const config = this.getItemConfig(item.itemId);
      return config?.type === type;
    });
  }

  getTotalItemCount(): number {
    let total = 0;
    this.items.forEach((qty) => {
      total += qty;
    });
    return total;
  }

  clear(): void {
    const removedItems = this.getAllItems();
    this.items.clear();
    const oldGold = this.gold;
    this.gold = 0;

    removedItems.forEach((item) => {
      this.emit('itemRemoved', {
        itemId: item.itemId,
        quantity: item.quantity,
        total: 0,
      });
    });

    if (oldGold !== 0) {
      this.emit('goldChange', {
        oldValue: oldGold,
        newValue: 0,
        change: -oldGold,
        type: 'clear',
      });
    }
  }

  toJSON(): { items: InventoryItem[]; gold: number } {
    return {
      items: this.getAllItems(),
      gold: this.gold,
    };
  }

  fromJSON(data: { items: InventoryItem[]; gold: number }): void {
    this.items.clear();
    if (Array.isArray(data.items)) {
      data.items.forEach((item) => {
        const qty = this.sanitizeAmount(item.quantity, 0);
        if (qty > 0) {
          this.items.set(item.itemId, qty);
        }
      });
    }
    this.gold = this.sanitizeAmount(data.gold, 0);
  }
}

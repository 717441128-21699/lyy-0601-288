import { ItemConfig, InventoryItem, ItemEffect } from '../types';
import { EventEmitter } from './EventEmitter';

export class InventorySystem extends EventEmitter {
  private itemConfigs: Map<string, ItemConfig> = new Map();
  private items: Map<string, number> = new Map();
  private gold: number = 0;

  constructor(configs: ItemConfig[] = [], initialGold: number = 0) {
    super();
    configs.forEach((config) => this.addItemConfig(config));
    this.gold = initialGold;
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
    return this.getItemCount(itemId) >= quantity;
  }

  addItem(itemId: string, quantity: number = 1): boolean {
    const config = this.getItemConfig(itemId);
    if (!config) return false;

    const current = this.getItemCount(itemId);
    const maxStack = config.maxStack ?? 99;

    if (!config.stackable && current >= 1 && quantity > 0) {
      return false;
    }

    const newQuantity = Math.min(maxStack, current + quantity);
    const added = newQuantity - current;

    if (added <= 0) return false;

    this.items.set(itemId, newQuantity);

    this.emit('itemAdded', {
      itemId,
      quantity: added,
      total: newQuantity,
    });

    return true;
  }

  removeItem(itemId: string, quantity: number = 1): boolean {
    const current = this.getItemCount(itemId);

    if (current < quantity) return false;

    const newQuantity = current - quantity;

    if (newQuantity <= 0) {
      this.items.delete(itemId);
    } else {
      this.items.set(itemId, newQuantity);
    }

    this.emit('itemRemoved', {
      itemId,
      quantity,
      total: newQuantity,
    });

    return true;
  }

  useItem(itemId: string, targetCharacterId?: string): ItemEffect[] | null {
    const config = this.getItemConfig(itemId);
    if (!config || !config.usable) return null;
    if (!this.hasItem(itemId, 1)) return null;

    this.removeItem(itemId, 1);

    this.emit('itemUsed', {
      itemId,
      targetCharacterId,
      effects: config.effects || [],
    });

    return config.effects || [];
  }

  getGold(): number {
    return this.gold;
  }

  addGold(amount: number): number {
    this.gold += amount;
    return this.gold;
  }

  spendGold(amount: number): boolean {
    if (this.gold < amount) return false;
    this.gold -= amount;
    return true;
  }

  setGold(amount: number): void {
    this.gold = Math.max(0, amount);
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

  clear(): void {
    this.items.clear();
    this.gold = 0;
  }

  toJSON(): { items: InventoryItem[]; gold: number } {
    return {
      items: this.getAllItems(),
      gold: this.gold,
    };
  }

  fromJSON(data: { items: InventoryItem[]; gold: number }): void {
    this.items.clear();
    data.items.forEach((item) => {
      this.items.set(item.itemId, item.quantity);
    });
    this.gold = data.gold;
  }
}

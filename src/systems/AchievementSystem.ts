import {
  AchievementConfig,
  AchievementCondition,
  QuestReward,
} from '../types';
import { EventEmitter } from './EventEmitter';

export interface AchievementContext {
  getQuestStatus: (questId: string) => string | undefined;
  getAttribute: (characterId: string, attributeId: string) => number;
  hasItem: (itemId: string, quantity?: number) => boolean;
  getItemCount: (itemId: string) => number;
  getLevel: (characterId: string) => number;
  isChapterUnlocked: (chapterId: string) => boolean;
  getBattleResult: (battleId: string) => string | undefined;
  getVariable: (key: string) => any;
  applyRewards: (rewards: QuestReward[]) => void;
  getPlayerCharacterId: () => string | undefined;
}

export class AchievementSystem extends EventEmitter {
  private achievementConfigs: Map<string, AchievementConfig> = new Map();
  private unlockedAchievements: Set<string> = new Set();
  private context?: AchievementContext;
  private checkOnUpdate: boolean = true;

  constructor(configs: AchievementConfig[] = []) {
    super();
    configs.forEach((config) => this.addAchievement(config));
  }

  setContext(context: AchievementContext): void {
    this.context = context;
  }

  addAchievement(config: AchievementConfig): void {
    this.achievementConfigs.set(config.id, config);
  }

  getAchievementConfig(id: string): AchievementConfig | undefined {
    return this.achievementConfigs.get(id);
  }

  getAllAchievementConfigs(): AchievementConfig[] {
    return Array.from(this.achievementConfigs.values());
  }

  isUnlocked(achievementId: string): boolean {
    return this.unlockedAchievements.has(achievementId);
  }

  unlockAchievement(achievementId: string): boolean {
    if (this.isUnlocked(achievementId)) return false;

    const config = this.achievementConfigs.get(achievementId);
    if (!config) return false;

    this.unlockedAchievements.add(achievementId);

    if (config.rewards?.length && this.context) {
      this.context.applyRewards(config.rewards);
    }

    this.emit('achievementUnlocked', {
      achievementId,
      achievement: config,
      rewards: config.rewards || [],
    });

    return true;
  }

  checkAchievement(achievementId: string): boolean {
    const config = this.achievementConfigs.get(achievementId);
    if (!config || !this.context) return false;

    if (this.isUnlocked(achievementId)) return true;

    const isMet = this.checkCondition(config.condition);

    if (isMet) {
      this.unlockAchievement(achievementId);
    }

    return isMet;
  }

  checkAllAchievements(): string[] {
    const newlyUnlocked: string[] = [];

    this.achievementConfigs.forEach((config) => {
      if (!this.isUnlocked(config.id)) {
        if (this.checkAchievement(config.id)) {
          newlyUnlocked.push(config.id);
        }
      }
    });

    return newlyUnlocked;
  }

  private checkCondition(condition: AchievementCondition): boolean {
    if (!this.context) return false;

    const {
      type,
      questId,
      attributeId,
      itemId,
      chapterId,
      battleId,
      operator = 'gte',
      value,
      count = 1,
      customCheck,
    } = condition;

    let actualValue: any;
    const playerId = this.context.getPlayerCharacterId();

    switch (type) {
      case 'quest':
        if (!questId) return false;
        actualValue = this.context.getQuestStatus(questId);
        return actualValue === 'completed';
      case 'attribute':
        if (!attributeId || !playerId) return false;
        actualValue = this.context.getAttribute(playerId, attributeId);
        return this.compareValues(actualValue, value, operator);
      case 'item':
        if (!itemId) return false;
        actualValue = this.context.getItemCount(itemId);
        return this.compareValues(actualValue, count, operator);
      case 'level':
        if (!playerId) return false;
        actualValue = this.context.getLevel(playerId);
        return this.compareValues(actualValue, value, operator);
      case 'chapter':
        if (!chapterId) return false;
        return this.context.isChapterUnlocked(chapterId);
      case 'battle':
        if (!battleId) return false;
        actualValue = this.context.getBattleResult(battleId);
        return actualValue === 'victory';
      case 'custom':
        if (customCheck) {
          const variableValue = this.context.getVariable(customCheck);
          return !!variableValue;
        }
        return false;
      default:
        return false;
    }
  }

  private compareValues(
    actual: number,
    expected: number | undefined,
    operator: string
  ): boolean {
    if (expected === undefined) return false;

    switch (operator) {
      case 'gt':
        return actual > expected;
      case 'gte':
        return actual >= expected;
      case 'lt':
        return actual < expected;
      case 'lte':
        return actual <= expected;
      case 'eq':
        return actual === expected;
      case 'neq':
        return actual !== expected;
      default:
        return false;
    }
  }

  getUnlockedAchievements(): AchievementConfig[] {
    const result: AchievementConfig[] = [];
    this.unlockedAchievements.forEach((id) => {
      const config = this.achievementConfigs.get(id);
      if (config) {
        result.push(config);
      }
    });
    return result;
  }

  getLockedAchievements(): AchievementConfig[] {
    return this.getAllAchievementConfigs().filter(
      (a) => !this.unlockedAchievements.has(a.id) && !a.isHidden
    );
  }

  getUnlockedCount(): number {
    return this.unlockedAchievements.size;
  }

  getTotalCount(): number {
    return this.achievementConfigs.size;
  }

  getProgress(): { unlocked: number; total: number; percentage: number } {
    const unlocked = this.getUnlockedCount();
    const total = this.getTotalCount();
    return {
      unlocked,
      total,
      percentage: total > 0 ? Math.round((unlocked / total) * 100) : 0,
    };
  }

  triggerCheck(): void {
    if (this.checkOnUpdate) {
      this.checkAllAchievements();
    }
  }

  setAutoCheck(enable: boolean): void {
    this.checkOnUpdate = enable;
  }

  reset(): void {
    this.unlockedAchievements.clear();
  }

  toJSON(): string[] {
    return Array.from(this.unlockedAchievements);
  }

  fromJSON(data: string[]): void {
    this.unlockedAchievements = new Set(data);
  }
}

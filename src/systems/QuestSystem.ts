import {
  QuestConfig,
  QuestData,
  QuestObjective,
  QuestReward,
} from '../types';
import { EventEmitter } from './EventEmitter';

export class QuestSystem extends EventEmitter {
  private questConfigs: Map<string, QuestConfig> = new Map();
  private quests: Map<string, QuestData> = new Map();

  constructor(configs: QuestConfig[] = []) {
    super();
    configs.forEach((config) => this.addQuestConfig(config));
  }

  addQuestConfig(config: QuestConfig): void {
    this.questConfigs.set(config.id, config);
    if (!this.quests.has(config.id)) {
      this.quests.set(config.id, {
        id: config.id,
        status: 'available',
        objectives: config.objectives.map((obj) => ({
          ...obj,
          currentCount: 0,
        })),
      });
    }
  }

  getQuestConfig(id: string): QuestConfig | undefined {
    return this.questConfigs.get(id);
  }

  getAllQuestConfigs(): QuestConfig[] {
    return Array.from(this.questConfigs.values());
  }

  getQuest(id: string): QuestData | undefined {
    return this.quests.get(id);
  }

  getAllQuests(): QuestData[] {
    return Array.from(this.quests.values());
  }

  getQuestsByStatus(
    status: QuestData['status']
  ): QuestData[] {
    return this.getAllQuests().filter((q) => q.status === status);
  }

  getActiveQuests(): QuestData[] {
    return this.getQuestsByStatus('active');
  }

  getCompletedQuests(): QuestData[] {
    return this.getQuestsByStatus('completed');
  }

  getAvailableQuests(): QuestData[] {
    return this.getQuestsByStatus('available');
  }

  isQuestAvailable(questId: string): boolean {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config) return false;

    if (quest.status !== 'available') return false;

    if (config.prerequisites?.length) {
      for (const prereqId of config.prerequisites) {
        const prereq = this.getQuest(prereqId);
        if (!prereq || prereq.status !== 'completed') {
          return false;
        }
      }
    }

    return true;
  }

  startQuest(questId: string): boolean {
    const quest = this.getQuest(questId);
    if (!quest || quest.status !== 'available') return false;
    if (!this.isQuestAvailable(questId)) return false;

    quest.status = 'active';
    quest.objectives.forEach((obj) => {
      obj.currentCount = 0;
    });

    this.emit('questStarted', {
      questId,
      quest: quest,
    });

    return true;
  }

  updateObjective(
    questId: string,
    objectiveId: string,
    count: number = 1
  ): boolean {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config || quest.status !== 'active') return false;

    const objective = quest.objectives.find((o) => o.id === objectiveId);
    if (!objective) return false;

    const oldCount = objective.currentCount;
    objective.currentCount = Math.min(objective.targetCount, objective.currentCount + count);

    if (oldCount !== objective.currentCount) {
      this.emit('questUpdated', {
        questId,
        objectiveId,
        oldCount,
        newCount: objective.currentCount,
        targetCount: objective.targetCount,
      });

      if (this.isQuestComplete(questId)) {
        this.completeQuest(questId);
      }
    }

    return true;
  }

  updateObjectiveByType(
    type: QuestObjective['type'],
    targetId?: string,
    count: number = 1
  ): void {
    this.getActiveQuests().forEach((quest) => {
      quest.objectives.forEach((objective) => {
        if (objective.type === type) {
          if (!targetId || objective.targetId === targetId) {
            if (objective.currentCount < objective.targetCount) {
              this.updateObjective(quest.id, objective.id, count);
            }
          }
        }
      });
    });
  }

  isQuestComplete(questId: string): boolean {
    const quest = this.getQuest(questId);
    if (!quest) return false;

    return quest.objectives.every((obj) => obj.currentCount >= obj.targetCount);
  }

  completeQuest(questId: string): QuestReward[] | null {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config || quest.status === 'completed') return null;

    quest.status = 'completed';
    quest.completedAt = Date.now();

    this.emit('questCompleted', {
      questId,
      quest,
      rewards: config.rewards || [],
    });

    this.checkAvailableQuests();

    return config.rewards || [];
  }

  failQuest(questId: string): boolean {
    const quest = this.getQuest(questId);
    if (!quest || quest.status === 'completed' || quest.status === 'failed') {
      return false;
    }

    quest.status = 'failed';

    this.emit('questFailed', {
      questId,
      quest,
    });

    return true;
  }

  private checkAvailableQuests(): void {
    this.getAllQuests().forEach((quest) => {
      if (quest.status === 'available') {
        const config = this.getQuestConfig(quest.id);
        if (config?.prerequisites?.length) {
          const allMet = config.prerequisites.every((prereqId) => {
            const prereq = this.getQuest(prereqId);
            return prereq?.status === 'completed';
          });
          if (allMet) {
            this.emit('questAvailable', {
              questId: quest.id,
              quest,
            });
          }
        }
      }
    });
  }

  getQuestRewards(questId: string): QuestReward[] {
    const config = this.getQuestConfig(questId);
    return config?.rewards || [];
  }

  getMainQuests(): QuestData[] {
    return this.getAllQuests().filter((q) => {
      const config = this.getQuestConfig(q.id);
      return config?.isMain;
    });
  }

  getQuestsByChapter(chapterId: string): QuestData[] {
    return this.getAllQuests().filter((q) => {
      const config = this.getQuestConfig(q.id);
      return config?.chapterId === chapterId;
    });
  }

  resetQuest(questId: string): boolean {
    const config = this.getQuestConfig(questId);
    if (!config) return false;

    this.quests.set(questId, {
      id: questId,
      status: 'available',
      objectives: config.objectives.map((obj) => ({
        ...obj,
        currentCount: 0,
      })),
    });

    return true;
  }

  resetAllQuests(): void {
    this.questConfigs.forEach((config) => {
      this.quests.set(config.id, {
        id: config.id,
        status: 'available',
        objectives: config.objectives.map((obj) => ({
          ...obj,
          currentCount: 0,
        })),
      });
    });
  }

  toJSON(): QuestData[] {
    return Array.from(this.quests.values());
  }

  fromJSON(data: QuestData[]): void {
    this.quests.clear();
    data.forEach((quest) => {
      this.quests.set(quest.id, quest);
    });
  }
}

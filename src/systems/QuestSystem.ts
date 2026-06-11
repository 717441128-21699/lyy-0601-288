import {
  QuestConfig,
  QuestData,
  QuestObjective,
  QuestReward,
  QuestRepeatType,
  QuestPhase,
  DialogueEffect,
  QuestRewardsExecutionResult,
} from '../types';
import { EventEmitter } from './EventEmitter';

export interface QuestRewardHandler {
  claimRewards: (
    characterId: string,
    rewards: (QuestReward | DialogueEffect)[]
  ) => QuestRewardsExecutionResult;
  getPlayerCharacterId: () => string | undefined;
}

export class QuestSystem extends EventEmitter {
  private questConfigs: Map<string, QuestConfig> = new Map();
  private _quests: Map<string, QuestData> = new Map();
  private rewardHandler?: QuestRewardHandler;
  private killCounters: Map<string, number> = new Map();
  private collectCounters: Map<string, number> = new Map();

  get quests(): Record<string, QuestData> {
    const obj: Record<string, QuestData> = {};
    this._quests.forEach((v, k) => { obj[k] = v; });
    return obj;
  }

  constructor(configs: QuestConfig[] = []) {
    super();
    configs.forEach((config) => this.addQuestConfig(config));
  }

  setRewardHandler(handler: QuestRewardHandler): void {
    this.rewardHandler = handler;
  }

  private isValidNumber(value: any): value is number {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
  }

  private sanitizeCount(value: number, min: number = 0, max: number = 999999): number {
    if (!this.isValidNumber(value)) return 0;
    return Math.floor(Math.max(min, Math.min(max, value)));
  }

  addQuestConfig(config: QuestConfig): void {
    this.questConfigs.set(config.id, config);
    if (!this._quests.has(config.id)) {
      const questData: QuestData = {
        id: config.id,
        status: 'available',
        objectives: config.objectives.map((obj) => ({
          ...obj,
          currentCount: 0,
        })),
        currentPhaseIndex: config.phases?.length ? 0 : undefined,
        phaseObjectives: config.phases?.[0]
          ? config.phases[0].objectives.map((obj) => ({
              ...obj,
              currentCount: 0,
            }))
          : undefined,
        repeatCount: 0,
        lastResetAt: undefined,
        claimedRewards: false,
      };
      this._quests.set(config.id, questData);
    }
  }

  getQuestConfig(id: string): QuestConfig | undefined {
    return this.questConfigs.get(id);
  }

  getAllQuestConfigs(): QuestConfig[] {
    return Array.from(this.questConfigs.values());
  }

  getQuest(id: string): QuestData | undefined {
    return this._quests.get(id);
  }

  getAllQuests(): QuestData[] {
    return Array.from(this._quests.values());
  }

  getQuestsByStatus(status: QuestData['status']): QuestData[] {
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

    if (config.repeatType && config.repeatType !== 'none' && quest.lastResetAt) {
      if (!this.isRepeatCooldownOver(config, quest)) {
        return false;
      }
    }

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

  private isRepeatCooldownOver(config: QuestConfig, quest: QuestData): boolean {
    if (!quest.lastResetAt) return true;

    const now = Date.now();
    const elapsed = now - quest.lastResetAt;

    switch (config.repeatType) {
      case 'daily':
        return elapsed >= 24 * 60 * 60 * 1000;
      case 'weekly':
        return elapsed >= 7 * 24 * 60 * 60 * 1000;
      case 'custom':
        return config.repeatInterval ? elapsed >= config.repeatInterval : true;
      default:
        return true;
    }
  }

  startQuest(questId: string): boolean {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config) return false;

    if (config.repeatType && config.repeatType !== 'none' && quest.status === 'completed') {
      if (!this.resetQuestForRepeat(questId)) {
        return false;
      }
    }

    if (!this.isQuestAvailable(questId)) return false;

    quest.status = 'active';
    this.resetQuestObjectives(questId);

    if (config.repeatType && config.repeatType !== 'none') {
      quest.lastResetAt = Date.now();
    }

    this.emit('questStarted', {
      questId,
      quest,
      config,
    });

    return true;
  }

  private resetQuestObjectives(questId: string): void {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config) return;

    quest.objectives = config.objectives.map((obj) => ({
      ...obj,
      currentCount: 0,
    }));

    if (config.phases?.length) {
      quest.currentPhaseIndex = 0;
      quest.phaseObjectives = config.phases[0].objectives.map((obj) => ({
        ...obj,
        currentCount: 0,
      }));
    }
  }

  private resetQuestForRepeat(questId: string): boolean {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config) return false;

    const maxRepeat = config.repeatCount ?? -1;
    if (maxRepeat > 0 && (quest.repeatCount ?? 0) >= maxRepeat) {
      return false;
    }

    if (!this.isRepeatCooldownOver(config, quest)) {
      return false;
    }

    quest.status = 'available';
    quest.claimedRewards = false;
    quest.completedAt = undefined;
    quest.repeatCount = (quest.repeatCount ?? 0) + 1;
    this.resetQuestObjectives(questId);

    this.emit('questReset', {
      questId,
      quest,
      reason: 'repeat',
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

    const safeCount = this.sanitizeCount(count, 1);

    const objective = quest.objectives.find((o) => o.id === objectiveId);
    let isPhaseObjective = false;
    let phaseObjective: QuestObjective | undefined;

    if (!objective && quest.phaseObjectives) {
      phaseObjective = quest.phaseObjectives.find((o) => o.id === objectiveId);
      if (phaseObjective) isPhaseObjective = true;
    }

    const target = objective || phaseObjective;
    if (!target) return false;

    const oldCount = target.currentCount;
    target.currentCount = Math.min(target.targetCount, target.currentCount + safeCount);

    const objectiveJustCompleted =
      oldCount < target.targetCount && target.currentCount >= target.targetCount;

    if (objectiveJustCompleted) {
      this.emit('questObjectiveComplete', {
        questId,
        objectiveId,
        objective: target,
        isPhaseObjective,
      });
    }

    if (oldCount !== target.currentCount) {
      this.emit('questUpdated', {
        questId,
        objectiveId,
        oldCount,
        newCount: target.currentCount,
        targetCount: target.targetCount,
        completed: target.currentCount >= target.targetCount,
        isPhaseObjective,
      });
    }

    if (isPhaseObjective && phaseObjective && objectiveJustCompleted) {
      if (this.isCurrentPhaseComplete(questId)) {
        this.advancePhase(questId);
      }
    }

    if (this.isQuestComplete(questId)) {
      if (config.autoComplete) {
        this.completeQuest(questId);
      }
    }

    return true;
  }

  updateObjectiveByType(
    type: QuestObjective['type'],
    targetId?: string,
    count: number = 1
  ): { questId: string; objectiveId: string }[] {
    const updated: { questId: string; objectiveId: string }[] = [];
    const safeCount = this.sanitizeCount(count, 1);

    if (type === 'kill' && targetId) {
      this.killCounters.set(
        targetId,
        (this.killCounters.get(targetId) ?? 0) + safeCount
      );
    }
    if (type === 'collect' && targetId) {
      this.collectCounters.set(
        targetId,
        (this.collectCounters.get(targetId) ?? 0) + safeCount
      );
    }

    this.getActiveQuests().forEach((quest) => {
      const checkObjectives = (objs: QuestObjective[]) => {
        objs.forEach((objective) => {
          if (objective.type === type) {
            if (!targetId || objective.targetId === targetId) {
              if (objective.currentCount < objective.targetCount) {
                if (this.updateObjective(quest.id, objective.id, safeCount)) {
                  updated.push({ questId: quest.id, objectiveId: objective.id });
                }
              }
            }
          }
        });
      };

      checkObjectives(quest.objectives);
      if (quest.phaseObjectives) {
        checkObjectives(quest.phaseObjectives);
      }
    });

    return updated;
  }

  reportKill(enemyId: string, count: number = 1): void {
    this.updateObjectiveByType('kill', enemyId, count);
  }

  reportCollect(itemId: string, count: number = 1): void {
    this.updateObjectiveByType('collect', itemId, count);
  }

  reportTalk(npcId: string): void {
    this.updateObjectiveByType('talk', npcId, 1);
  }

  reportReach(locationId: string): void {
    this.updateObjectiveByType('reach', locationId, 1);
  }

  reportCustom(customId: string, count: number = 1): void {
    this.updateObjectiveByType('custom', customId, count);
  }

  reportProgress(
    questId: string,
    objectiveId: string,
    amount: number
  ): { success: boolean; newCount: number; completed: boolean } {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config || quest.status !== 'active') {
      return { success: false, newCount: 0, completed: false };
    }

    const objectives = quest.phaseObjectives ?? quest.objectives;
    const obj = objectives.find((o) => o.id === objectiveId);
    if (!obj) return { success: false, newCount: 0, completed: false };

    const safeAmount = this.sanitizeCount(amount, 1);
    const oldCount = obj.currentCount;
    obj.currentCount = Math.min(obj.targetCount, oldCount + safeAmount);
    const justCompleted = oldCount < obj.targetCount && obj.currentCount >= obj.targetCount;

    if (justCompleted) {
      this.emit('questObjectiveComplete', {
        questId,
        objectiveId,
        objective: obj,
        isPhaseObjective: !!quest.phaseObjectives,
      });
    }

    if (oldCount !== obj.currentCount) {
      this.emit('questUpdated', {
        questId,
        quest,
        objectiveId,
        change: obj.currentCount - oldCount,
      });
    }

    return {
      success: true,
      newCount: obj.currentCount,
      completed: obj.currentCount >= obj.targetCount,
    };
  }

  private isCurrentPhaseComplete(questId: string): boolean {
    const quest = this.getQuest(questId);
    if (!quest?.phaseObjectives) return false;
    return quest.phaseObjectives.every((obj) => obj.currentCount >= obj.targetCount);
  }

  private advancePhase(questId: string): boolean {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config?.phases) return false;

    const currentPhaseIdx = quest.currentPhaseIndex ?? 0;
    const currentPhase = config.phases[currentPhaseIdx];

    if (currentPhase?.rewards && this.rewardHandler) {
      const playerId = this.rewardHandler.getPlayerCharacterId();
      if (playerId) {
        const result = this.rewardHandler.claimRewards(playerId, currentPhase.rewards);
        this.emit('questPhaseComplete', {
          questId,
          phaseIndex: currentPhaseIdx,
          phase: currentPhase,
          rewards: result,
        });
      }
    } else {
      this.emit('questPhaseComplete', {
        questId,
        phaseIndex: currentPhaseIdx,
        phase: currentPhase,
      });
    }

    if (currentPhaseIdx + 1 < config.phases.length) {
      quest.currentPhaseIndex = currentPhaseIdx + 1;
      quest.phaseObjectives = config.phases[currentPhaseIdx + 1].objectives.map((obj) => ({
        ...obj,
        currentCount: 0,
      }));
      return true;
    }

    return false;
  }

  isQuestComplete(questId: string): boolean {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config) return false;

    const mainObjectivesComplete = quest.objectives.every(
      (obj) => obj.currentCount >= obj.targetCount
    );

    let phasesComplete = true;
    if (config.phases?.length && quest.phaseObjectives) {
      const isLastPhase = (quest.currentPhaseIndex ?? 0) >= config.phases.length - 1;
      const lastPhaseComplete = quest.phaseObjectives.every(
        (obj) => obj.currentCount >= obj.targetCount
      );
      phasesComplete = isLastPhase && lastPhaseComplete;
    }

    return mainObjectivesComplete && phasesComplete;
  }

  completeQuest(questId: string): QuestRewardsExecutionResult | null {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config || quest.status === 'completed') return null;

    quest.status = 'completed';
    quest.completedAt = Date.now();

    const rewards = config.rewards || [];
    let result: QuestRewardsExecutionResult | null = null;

    if (rewards.length && this.rewardHandler && !quest.claimedRewards) {
      const playerId = this.rewardHandler.getPlayerCharacterId();
      if (playerId) {
        result = this.rewardHandler.claimRewards(playerId, rewards);
        quest.claimedRewards = true;
        this.emit('questRewardsClaimed', {
          questId,
          quest,
          rewards: result,
          rawRewards: rewards,
        });
      }
    }

    this.emit('questCompleted', {
      questId,
      quest,
      rewards,
    });

    this.checkAvailableQuests();

    return result;
  }

  claimQuestRewards(questId: string): QuestRewardsExecutionResult | null {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config || quest.status !== 'completed' || quest.claimedRewards) {
      return null;
    }

    const rewards = config.rewards || [];
    let result: QuestRewardsExecutionResult | null = null;

    if (this.rewardHandler) {
      const playerId = this.rewardHandler.getPlayerCharacterId();
      if (playerId) {
        result = this.rewardHandler.claimRewards(playerId, rewards);
        quest.claimedRewards = true;
        this.emit('questRewardsClaimed', {
          questId,
          quest,
          rewards,
          result,
        });
      }
    }

    return result;
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

  resetQuest(questId: string): boolean {
    const config = this.getQuestConfig(questId);
    if (!config) return false;

    const quest = this._quests.get(questId);
    const previousStatus = quest?.status;

    this._quests.set(questId, {
      id: questId,
      status: 'available',
      objectives: config.objectives.map((obj) => ({
        ...obj,
        currentCount: 0,
      })),
      currentPhaseIndex: config.phases?.length ? 0 : undefined,
      phaseObjectives: config.phases?.[0]
        ? config.phases[0].objectives.map((obj) => ({
            ...obj,
            currentCount: 0,
          }))
        : undefined,
      repeatCount: 0,
      lastResetAt: undefined,
      claimedRewards: false,
    });

    this.emit('questReset', {
      questId,
      previousStatus,
      reason: 'manual',
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
            if (config.autoStart) {
              this.startQuest(quest.id);
            }
          }
        }
      }
    });
  }

  getQuestRewards(questId: string): (QuestReward | DialogueEffect)[] {
    const config = this.getQuestConfig(questId);
    return config?.rewards || [];
  }

  getCurrentPhase(questId: string): QuestPhase | undefined {
    const quest = this.getQuest(questId);
    const config = this.getQuestConfig(questId);
    if (!quest || !config?.phases) return undefined;
    return config.phases[quest.currentPhaseIndex ?? 0];
  }

  getPhases(questId: string): QuestPhase[] {
    return this.getQuestConfig(questId)?.phases || [];
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

  getRepeatableQuests(): QuestData[] {
    return this.getAllQuests().filter((q) => {
      const config = this.getQuestConfig(q.id);
      return config?.repeatType && config.repeatType !== 'none';
    });
  }

  getKillCount(enemyId: string): number {
    return this.killCounters.get(enemyId) ?? 0;
  }

  getCollectCount(itemId: string): number {
    return this.collectCounters.get(itemId) ?? 0;
  }

  getKillStats(): Record<string, number> {
    const obj: Record<string, number> = {};
    this.killCounters.forEach((v, k) => { obj[k] = v; });
    return obj;
  }

  getCollectStats(): Record<string, number> {
    const obj: Record<string, number> = {};
    this.collectCounters.forEach((v, k) => { obj[k] = v; });
    return obj;
  }

  resetAllQuests(): void {
    this.questConfigs.forEach((config) => {
      this.resetQuest(config.id);
    });
    this.killCounters.clear();
    this.collectCounters.clear();
  }

  toJSON(): QuestData[] {
    return Array.from(this._quests.values());
  }

  fromJSON(data: QuestData[]): void {
    this._quests.clear();
    data.forEach((quest) => {
      this._quests.set(quest.id, quest);
    });
  }
}

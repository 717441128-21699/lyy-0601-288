import {
  RPGCoreConfig,
  RPGEventType,
  EventCallback,
  DialogueEffect,
  DialogueCondition,
  DialogueConfig,
  DialogueChoice,
  BattleAction,
  BattleState,
  CharacterConfig,
  CharacterData,
  ItemConfig,
  QuestConfig,
  QuestData,
  AchievementConfig,
  ChapterConfig,
  EndingConfig,
  BattleConfig,
  SaveData,
  SaveSlotInfo,
  QuestReward,
  InventoryItem,
  AttributeConfig,
  LevelConfig,
  SkillConfig,
  EffectsExecutionResult,
  SaveStorageAdapter,
  SaveMigration,
} from './types';

import { EventEmitter } from './systems/EventEmitter';
import { AttributeSystem } from './systems/AttributeSystem';
import { CharacterSystem } from './systems/CharacterSystem';
import { InventorySystem } from './systems/InventorySystem';
import { QuestSystem, QuestRewardHandler } from './systems/QuestSystem';
import { DialogueSystem } from './systems/DialogueSystem';
import { BattleSystem } from './systems/BattleSystem';
import { SaveSystem } from './systems/SaveSystem';
import { AchievementSystem } from './systems/AchievementSystem';
import { EffectExecutor, EffectContext } from './systems/EffectExecutor';

export {
  AttributeSystem,
  CharacterSystem,
  InventorySystem,
  QuestSystem,
  DialogueSystem,
  BattleSystem,
  SaveSystem,
  AchievementSystem,
  EffectExecutor,
  EventEmitter,
};

export class RPGCore extends EventEmitter {
  public attribute: AttributeSystem;
  public character: CharacterSystem;
  public inventory: InventorySystem;
  public quest: QuestSystem;
  public dialogue: DialogueSystem;
  public battle: BattleSystem;
  public save: SaveSystem;
  public achievement: AchievementSystem;
  public effect: EffectExecutor;

  private config: RPGCoreConfig;
  private battleResults: Map<string, string> = new Map();
  private autoSaveTimer: any;
  private _isReady: boolean = false;
  private version: number;

  constructor(config: RPGCoreConfig = {}) {
    super();
    this.config = config;
    this.version = config.version ?? 1;

    const validateValues = config.validateValues ?? true;
    const clampNegativeValues = config.clampNegativeValues ?? true;

    this.attribute = new AttributeSystem(config.defaultAttributes || []);

    this.character = new CharacterSystem(
      config.characters || [],
      config.levelTable || [],
      config.maxLevel,
      config.defaultAttributes || []
    );

    this.inventory = new InventorySystem(
      config.items || [],
      config.initialGold || 0,
      { validateValues, clampNegativeValues }
    );

    this.quest = new QuestSystem(config.quests || []);

    this.dialogue = new DialogueSystem(config.dialogues || []);

    this.battle = new BattleSystem(
      config.battles || [],
      config.skills || []
    );

    this.save = new SaveSystem({
      chapters: config.chapters || [],
      endings: config.endings || [],
      storageKey: config.saveStorageKey,
      autoSave: config.autoSave,
      autoSaveInterval: config.autoSaveInterval,
      adapter: config.saveAdapter,
      migrations: config.saveMigrations,
      currentVersion: this.version,
      validateValues,
      clampNegativeValues,
      autoRestore: true,
    });

    this.achievement = new AchievementSystem(config.achievements || []);

    this.effect = new EffectExecutor(this.buildEffectContext());

    this.setupContexts();
    this.setupRewardHandler();
    this.setupEventBridging();

    Promise.resolve().then(async () => {
      try {
        await (this.save as any).tryRestoreLastSave?.();
      } catch (e) {}
      await this.checkAutoStartQuests();
      this._isReady = true;
    });

    if (config.autoSave && config.autoSaveInterval) {
      this.autoSaveTimer = setInterval(() => {
        this.quickSave();
      }, config.autoSaveInterval);
    }
  }

  get isReady(): boolean {
    return this._isReady;
  }

  get currentVersion(): number {
    return this.version;
  }

  private buildEffectContext(): EffectContext {
    const self = this;
    return {
      getAttribute: (cid, aid) => self.character.getAttribute(cid, aid),
      setAttribute: (cid, aid, v) => self.character.setAttribute(cid, aid, v),
      addAttribute: (cid, aid, n) => self.character.addAttribute(cid, aid, n),
      getAffinity: (cid) => self.character.getAffinity(cid),
      addAffinity: (cid, n) => self.character.addAffinity(cid, n),
      setAffinity: (cid, v) => self.character.setAffinity(cid, v),
      hasItem: (iid, q) => self.inventory.hasItem(iid, q),
      addItem: (iid, q) => self.inventory.addItem(iid, q),
      removeItem: (iid, q) => self.inventory.removeItem(iid, q),
      startQuest: (qid) => self.quest.startQuest(qid),
      completeQuest: (qid) => self.quest.completeQuest(qid),
      updateQuestObjective: (qid, oid, n) => self.quest.updateObjective(qid, oid, n),
      resetQuest: (qid) => self.quest.resetQuest(qid),
      getVariable: (k) => self.dialogue.getVariable(k),
      setVariable: (k, v) => self.dialogue.setVariable(k, v),
      unlockChapter: (cid) => self.save.unlockChapter(cid),
      setCurrentChapter: (cid) => self.save.setCurrentChapter(cid),
      addGold: (n) => self.inventory.addGold(n),
      spendGold: (n) => self.inventory.spendGold(n),
      addExp: (cid, n) => self.character.addExp(cid, n),
      addSkill: (cid, sid) => self.character.addSkill(cid, sid),
      getPlayerCharacterId: () => self.character.getPlayerCharacter()?.id,
      clampValue: (v, min?, max?) => {
        if (typeof v !== 'number' || isNaN(v) || !isFinite(v)) return min ?? 0;
        let r = v;
        if (min !== undefined) r = Math.max(min, r);
        if (max !== undefined) r = Math.min(max, r);
        return r;
      },
      isValidNumber: (v) => typeof v === 'number' && !isNaN(v) && isFinite(v),
    };
  }

  private setupContexts(): void {
    this.dialogue.setContext({
      getAttribute: (charId, attrId) => this.character.getAttribute(charId, attrId),
      getAffinity: (charId) => this.character.getAffinity(charId),
      hasItem: (itemId, quantity) => this.inventory.hasItem(itemId, quantity),
      getQuestStatus: (questId) => this.quest.getQuest(questId)?.status,
      getVariable: (key) => this.dialogue.getVariable(key),
      getLevel: (charId) => this.character.getLevel(charId),
      getChapterId: () => this.save.getCurrentChapterId(),
    });
    this.dialogue.setEffectExecutor(this.effect);

    this.battle.setContext({
      getCharacterAttribute: (charId, attrId) => this.character.getAttribute(charId, attrId),
      getCharacterMaxHp: (charId) =>
        this.character.getAttribute(charId, 'maxHp') || this.character.getAttribute(charId, 'hp') || 100,
      getCharacterMaxMp: (charId) =>
        this.character.getAttribute(charId, 'maxMp') || this.character.getAttribute(charId, 'mp') || 50,
      getCharacterSpeed: (charId) => this.character.getAttribute(charId, 'speed') || 10,
      getCharacterSkills: (charId) => this.character.getCharacter(charId)?.skills || [],
      getCharacterLevel: (charId) => this.character.getLevel(charId),
      getSkillConfig: (skillId) => this.battle.getSkillConfig(skillId),
      addExp: (charId, exp) => this.character.addExp(charId, exp),
      addGold: (amount) => this.inventory.addGold(amount),
      addItem: (itemId, quantity) => this.inventory.addItem(itemId, quantity),
      hasItem: (itemId, quantity) => this.inventory.hasItem(itemId, quantity),
      useItem: (itemId, targetId) => this.inventory.useItem(itemId, targetId),
      getInventorySnapshot: () => this.inventory.getAllItems(),
      restoreInventory: (snapshot) => {
        const items = this.inventory.getAllItems();
        items.forEach((i) => this.inventory.removeItem(i.itemId, i.quantity));
        snapshot.forEach((i) => this.inventory.addItem(i.itemId, i.quantity));
      },
      executeDialogueEffects: (effects) => this.executeEffects(effects, 'battle'),
    });

    this.achievement.setContext({
      getQuestStatus: (questId) => this.quest.getQuest(questId)?.status,
      getAttribute: (charId, attrId) => this.character.getAttribute(charId, attrId),
      hasItem: (itemId, quantity) => this.inventory.hasItem(itemId, quantity),
      getItemCount: (itemId) => this.inventory.getItemCount(itemId),
      getLevel: (charId) => this.character.getLevel(charId),
      isChapterUnlocked: (chapterId) => this.save.isChapterUnlocked(chapterId),
      getBattleResult: (battleId) => this.battleResults.get(battleId),
      getVariable: (key) => this.dialogue.getVariable(key),
      applyRewards: (rewards) => {
        const player = this.character.getPlayerCharacter();
        if (player) this.applyQuestRewards(player.id, rewards);
      },
      getPlayerCharacterId: () => this.character.getPlayerCharacter()?.id,
    });

    this.save.setContext({
      getCharacters: () => this.character.toJSON(),
      getInventory: () => ({
        items: this.inventory.getAllItems(),
        gold: this.inventory.getGold(),
      }),
      getQuests: () => this.quest.toJSON(),
      getDialogueState: () => this.dialogue.getDialogueState(),
      getVariables: () => this.dialogue.getAllVariables(),
      getAchievements: () => this.achievement.toJSON(),
      getChapterId: () => this.save.getCurrentChapterId(),
      getPlayTime: () => (this.save as any).playTime ?? 0,
      loadCharacters: (data) => this.character.fromJSON(data),
      loadInventory: (data) => this.inventory.fromJSON(data),
      loadQuests: (data) => this.quest.fromJSON(data),
      loadDialogueState: (data) => this.dialogue.setDialogueState(data),
      loadVariables: (data) => this.dialogue.setAllVariables(data),
      loadAchievements: (data) => this.achievement.fromJSON(data),
      loadChapterId: (chapterId) => {
        if (chapterId) this.save.setCurrentChapter(chapterId);
      },
      loadPlayTime: (playTime) => {
        if ((this.save as any).playTime !== undefined) {
          (this.save as any).playTime = playTime;
        }
      },
    });
  }

  private setupRewardHandler(): void {
    const handler: QuestRewardHandler = {
      claimRewards: (characterId, rewards) => {
        const summary = this.applyQuestRewards(characterId, rewards);
        return summary;
      },
      getPlayerCharacterId: () => this.character.getPlayerCharacter()?.id,
    };
    this.quest.setRewardHandler(handler);
  }

  private async checkAutoStartQuests(): Promise<void> {
    const configs = this.quest.getAllQuestConfigs();
    for (const cfg of configs) {
      if (cfg.autoStart && this.quest.isQuestAvailable(cfg.id)) {
        this.quest.startQuest(cfg.id);
      }
    }
  }

  private setupEventBridging(): void {
    const systems: EventEmitter[] = [
      this.attribute, this.character, this.inventory,
      this.quest, this.dialogue, this.battle,
      this.save, this.achievement, this.effect,
    ];

    const bridgeEvent = (event: any) => {
      this.emit(event.type, event.payload);
    };

    systems.forEach((sys) => {
      const originalOn = (sys as any).on?.bind?.(sys);
      if (originalOn) {
        (sys as any).on('*' as any, bridgeEvent);
      }
    });

    const bridgeEvents: RPGEventType[] = [
      'levelUp', 'attributeChange', 'itemAdded', 'itemRemoved', 'itemUsed',
      'questStarted', 'questUpdated', 'questObjectiveComplete', 'questPhaseComplete',
      'questCompleted', 'questRewardsClaimed', 'questFailed', 'questReset', 'questAvailable',
      'dialogueStart', 'dialogueEnd', 'choiceSelected', 'effectsExecuted', 'effectTriggered',
      'battleStart', 'battleEnd', 'battleTurn', 'battleEnemyAction', 'battleSkillUsed',
      'battleVictory', 'battleDefeat', 'battleFled', 'battleRetry',
      'achievementUnlocked', 'chapterUnlocked', 'chapterEntered', 'endingTriggered',
      'saveCreated', 'saveLoaded', 'saveDeleted', 'saveImported', 'saveExported', 'saveMigrated',
      'affinityChange', 'variableChange', 'skillLearned', 'skillUsed', 'goldChange',
    ];

    bridgeEvents.forEach((type) => {
      systems.forEach((sys) => {
        sys.on(type, (event) => {
          this.emit(event.type, event.payload);
        });
      });
    });

    this.on('questCompleted', () => {
      this.achievement.triggerCheck();
      this.save.autoSaveIfEnabled();
    });

    this.on('questRewardsClaimed', () => {
      this.achievement.triggerCheck();
    });

    this.on('levelUp', () => {
      this.achievement.triggerCheck();
    });

    this.on('chapterUnlocked', (ev: any) => {
      const chapter = this.save.getCurrentChapter();
      if (chapter?.onEnterEffects?.length) {
        this.executeEffects(chapter.onEnterEffects, 'chapter_enter');
      }
      this.emit('chapterEntered', ev.payload);
      this.achievement.triggerCheck();
      this.save.autoSaveIfEnabled();
    });

    this.on('itemAdded', () => {
      this.achievement.triggerCheck();
    });

    this.on('battleEnd', (event: any) => {
      if (event.payload?.battleId) {
        this.battleResults.set(event.payload.battleId, event.payload.result);
      }
      this.achievement.triggerCheck();
      this.save.autoSaveIfEnabled();
    });

    this.on('effectTriggered', () => {
      this.achievement.triggerCheck();
    });
  }

  public executeEffects(effects: DialogueEffect[], source?: string): EffectsExecutionResult {
    const result = this.effect.execute(effects, source);
    return result;
  }

  public applyQuestRewards(
    characterId: string,
    rewards: (QuestReward | DialogueEffect)[]
  ): {
    exp: number;
    gold: number;
    items: { itemId: string; quantity: number }[];
    attributes: { id: string; value: number }[];
    affinity: { characterId: string; value: number }[];
    effects?: any;
  } {
    const summary: {
      exp: number;
      gold: number;
      items: { itemId: string; quantity: number }[];
      attributes: { id: string; value: number }[];
      affinity: { characterId: string; value: number }[];
      effects?: any;
    } = {
      exp: 0,
      gold: 0,
      items: [] as { itemId: string; quantity: number }[],
      attributes: [] as { id: string; value: number }[],
      affinity: [] as { characterId: string; value: number }[],
    };

    const questRewardTypes = new Set(['exp', 'item', 'gold', 'attribute', 'affinity']);
    const pureRewards: QuestReward[] = [];
    const pureEffects: DialogueEffect[] = [];

    (rewards as any[]).forEach((r) => {
      if (questRewardTypes.has(r.type)) {
        pureRewards.push(r);
      } else {
        pureEffects.push(r);
      }
    });

    pureRewards.forEach((reward) => {
      if (
        typeof reward.value !== 'number' ||
        isNaN(reward.value) ||
        !isFinite(reward.value)
      )
        return;

      const safeValue = Math.max(0, reward.value);

      switch (reward.type) {
        case 'exp': {
          this.character.addExp(characterId, safeValue);
          summary.exp += safeValue;
          break;
        }
        case 'item': {
          if (reward.itemId) {
            const qtyFromQuantity = typeof reward.quantity === 'number' ? reward.quantity : null;
            const qtyFromValue = safeValue > 0 ? safeValue : null;
            const qty = Math.max(1, qtyFromQuantity ?? qtyFromValue ?? 1);
            const ok = this.inventory.addItem(reward.itemId, qty);
            if (ok) summary.items.push({ itemId: reward.itemId, quantity: qty });
          }
          break;
        }
        case 'gold': {
          this.inventory.addGold(safeValue);
          summary.gold += safeValue;
          break;
        }
        case 'attribute': {
          if (reward.attributeId) {
            this.character.addAttribute(characterId, reward.attributeId, safeValue);
            summary.attributes.push({ id: reward.attributeId, value: safeValue });
          }
          break;
        }
        case 'affinity': {
          const cid = reward.characterId ?? characterId;
          this.character.addAffinity(cid, safeValue);
          summary.affinity.push({ characterId: cid, value: safeValue });
          break;
        }
      }
    });

    if (pureEffects.length) {
      summary.effects = this.effect.execute(pureEffects, 'quest_reward');
    }

    return summary;
  }

  public createPlayer(config: Omit<CharacterConfig, 'isPlayer'>): CharacterData {
    return this.character.createCharacter({ ...config, isPlayer: true });
  }

  public addCompanion(config: CharacterConfig): CharacterData {
    return this.character.createCharacter({ ...config, isPlayer: false });
  }

  public startQuest(questId: string): boolean {
    const ok = this.quest.startQuest(questId);
    if (ok) this.save.autoSaveIfEnabled();
    return ok;
  }

  public completeQuest(questId: string): boolean {
    const rewards = this.quest.completeQuest(questId);
    return rewards !== null;
  }

  public claimQuestRewards(questId: string): QuestReward[] | null {
    return this.quest.claimQuestRewards(questId);
  }

  public updateQuestObjective(questId: string, objectiveId: string, count: number = 1): boolean {
    return this.quest.updateObjective(questId, objectiveId, count);
  }

  public reportKill(enemyId: string, count: number = 1): void {
    this.quest.reportKill(enemyId, count);
  }

  public reportCollect(itemId: string, count: number = 1): void {
    this.quest.reportCollect(itemId, count);
  }

  public reportTalk(npcId: string): void {
    this.quest.reportTalk(npcId);
  }

  public reportReach(locationId: string): void {
    this.quest.reportReach(locationId);
  }

  public reportCustom(customId: string, count: number = 1): void {
    this.quest.reportCustom(customId, count);
  }

  public startDialogue(dialogueId: string): DialogueConfig | null {
    return this.dialogue.startDialogue(dialogueId);
  }

  public selectDialogueChoice(choiceId: string): DialogueConfig | null {
    return this.dialogue.selectChoice(choiceId);
  }

  public nextDialogue(): DialogueConfig | null {
    const result = this.dialogue.next() as any;
    return result?.dialogue ?? null;
  }

  public getAvailableChoices(): DialogueChoice[] {
    return this.dialogue.getAvailableChoices();
  }

  public startBattle(battleId: string): BattleState | null {
    return this.battle.startBattle(battleId);
  }

  public executeBattleAction(action: BattleAction): any {
    return this.battle.executeAction(action);
  }

  public retryBattle(): BattleState | null {
    return this.battle.retryBattle();
  }

  public async createSave(slotId: string): Promise<SaveData | null> {
    const result = await this.save.createSave(slotId);
    this.emit('saveCreated', { saveId: slotId, save: result });
    return result;
  }

  public async loadSave(slotId: string): Promise<boolean> {
    const ok = await this.save.loadSave(slotId);
    if (ok) {
      this.achievement.triggerCheck();
    }
    return ok;
  }

  public async deleteSave(slotId: string): Promise<boolean> {
    return this.save.deleteSave(slotId);
  }

  public async quickSave(): Promise<SaveData | null> {
    return this.createSave('quicksave');
  }

  public async quickLoad(): Promise<boolean> {
    return this.loadSave('quicksave');
  }

  public async getSaveSlots(): Promise<SaveSlotInfo[]> {
    return this.save.getSaveSlotInfos();
  }

  public exportSave(slotId: string, includeChecksum: boolean = true): string | null {
    return (this.save as any).exportSave?.(slotId, includeChecksum) ?? null;
  }

  public exportAllSaves(): string | null {
    return (this.save as any).exportAllSaves?.() ?? null;
  }

  public importSave(
    jsonString: string,
    options?: { overwrite?: boolean; slotId?: string }
  ): Promise<SaveData | null> {
    return (this.save as any).importSave?.(jsonString, options) ?? Promise.resolve(null);
  }

  public importAllSaves(jsonString: string): Promise<number> {
    return (this.save as any).importAllSaves?.(jsonString).then((arr: any[]) => arr.length) ?? Promise.resolve(0);
  }

  public setSaveAdapter(adapter: SaveStorageAdapter): void {
    (this.save as any).setAdapter?.(adapter);
  }

  public addSaveMigration(migration: SaveMigration): void {
    (this.save as any).addMigration?.(migration);
  }

  public unlockAchievement(achievementId: string): boolean {
    return this.achievement.unlockAchievement(achievementId);
  }

  public checkAchievements(): string[] {
    return this.achievement.checkAllAchievements();
  }

  public setVariable(key: string, value: any): void {
    this.dialogue.setVariable(key, value);
  }

  public getVariable(key: string): any {
    return this.dialogue.getVariable(key);
  }

  public unlockChapter(chapterId: string): boolean {
    const ok = this.save.unlockChapter(chapterId);
    if (ok) {
      const chapter = this.save.getChapter(chapterId);
      if (chapter?.onEnterEffects?.length) {
        this.executeEffects(chapter.onEnterEffects, 'chapter_unlock');
      }
    }
    return ok;
  }

  public setCurrentChapter(chapterId: string): boolean {
    const current = this.save.getCurrentChapterId();
    const ok = this.save.setCurrentChapter(chapterId);
    if (ok && current !== chapterId) {
      const chapter = this.save.getChapter(chapterId);
      if (chapter?.onEnterEffects?.length) {
        this.executeEffects(chapter.onEnterEffects, 'chapter_set');
      }
      this.emit('chapterEntered', { chapterId, chapter });
    }
    return ok;
  }

  public getCurrentChapter(): ChapterConfig | undefined {
    return this.save.getCurrentChapter();
  }

  public completeChapter(chapterId: string): boolean {
    const chapter = this.save.getChapter(chapterId);
    if (!chapter) return false;
    if (chapter.onCompleteEffects?.length) {
      this.executeEffects(chapter.onCompleteEffects, 'chapter_complete');
    }
    if (chapter.endingId) {
      this.save.triggerEnding(chapter.endingId);
    }
    return true;
  }

  public checkEnding(): EndingConfig | null {
    return this.save.checkEndingConditions((condition) =>
      this.checkDialogueCondition(condition)
    );
  }

  public triggerEnding(endingId: string): boolean {
    const ending = this.save.getEnding(endingId);
    if (ending?.effects?.length) {
      this.executeEffects(ending.effects, 'ending');
    }
    const ok = this.save.triggerEnding(endingId);
    this.save.autoSaveIfEnabled();
    return ok;
  }

  private checkDialogueCondition(condition: DialogueCondition): boolean {
    const {
      type,
      operator = 'gte',
      value,
      attributeId,
      characterId,
      itemId,
      questId,
      questStatus,
      variableKey,
      chapterId,
    } = condition;

    const playerId = this.character.getPlayerCharacter()?.id;
    const targetCharId = characterId || playerId;
    if (!targetCharId) return false;

    let actualValue: any;

    switch (type) {
      case 'attribute':
        if (!attributeId) return true;
        actualValue = this.character.getAttribute(targetCharId, attributeId);
        break;
      case 'affinity':
        actualValue = this.character.getAffinity(targetCharId);
        break;
      case 'item':
        if (!itemId) return true;
        actualValue = this.inventory.hasItem(itemId, value as number);
        return operator === 'has' ? actualValue : !actualValue;
      case 'quest':
        if (!questId) return true;
        actualValue = this.quest.getQuest(questId)?.status;
        return actualValue === questStatus;
      case 'variable':
        if (!variableKey) return true;
        actualValue = this.dialogue.getVariable(variableKey);
        break;
      case 'level':
        actualValue = this.character.getLevel(targetCharId);
        break;
      case 'chapter':
        if (!chapterId) return true;
        return this.save.isChapterUnlocked(chapterId);
      default:
        return true;
    }

    return this.compareValues(actualValue, value, operator);
  }

  private compareValues(actual: any, expected: any, operator: string): boolean {
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

  public addItemConfig(config: ItemConfig): void {
    this.inventory.addItemConfig(config);
  }

  public addSkillConfig(config: SkillConfig): void {
    this.battle.addSkillConfig(config);
  }

  public addQuestConfig(config: QuestConfig): void {
    this.quest.addQuestConfig(config);
  }

  public addDialogueConfig(config: DialogueConfig): void {
    this.dialogue.addDialogueConfig(config);
  }

  public addCharacterConfig(config: CharacterConfig): void {
    this.character.createCharacter(config);
  }

  public addAchievementConfig(config: AchievementConfig): void {
    this.achievement.addAchievement(config);
  }

  public addChapterConfig(config: ChapterConfig): void {
    this.save.addChapter(config);
  }

  public addEndingConfig(config: EndingConfig): void {
    this.save.addEnding(config);
  }

  public addBattleConfig(config: BattleConfig): void {
    this.battle.addBattleConfig(config);
  }

  public addAttributeConfig(config: AttributeConfig): void {
    this.attribute.addAttributeConfig(config);
  }

  public addGold(amount: number): number {
    return this.inventory.addGold(amount);
  }

  public spendGold(amount: number): boolean {
    return this.inventory.spendGold(amount);
  }

  public getGold(): number {
    return this.inventory.getGold();
  }

  public setGold(amount: number): number {
    return this.inventory.setGold(amount);
  }

  public addExp(characterId: string, exp: number): { leveledUp: boolean; levelsGained: number } {
    return this.character.addExp(characterId, exp);
  }

  public reset(): void {
    this.attribute.reset();
    this.inventory.clear();
    this.quest.resetAllQuests();
    this.dialogue.reset();
    this.achievement.reset();
    this.battleResults.clear();
  }

  public getPlayer(): CharacterData | undefined {
    return this.character.getPlayerCharacter();
  }

  public getCompanions(): CharacterData[] {
    return this.character.getAllCharacters().filter((c) => !c.isPlayer);
  }

  public getQuests(): QuestData[] {
    return this.quest.getAllQuests();
  }

  public getActiveQuests(): QuestData[] {
    return this.quest.getActiveQuests();
  }

  public getCompletedQuests(): QuestData[] {
    return this.quest.getCompletedQuests();
  }

  public getInventory(): InventoryItem[] {
    return this.inventory.getAllItems();
  }

  public getUnlockedAchievements(): AchievementConfig[] {
    return this.achievement.getUnlockedAchievements();
  }

  public getAchievementProgress(): {
    unlocked: number;
    total: number;
    percentage: number;
  } {
    return this.achievement.getProgress();
  }

  public addSkill(characterId: string, skillId: string): boolean {
    return this.character.addSkill(characterId, skillId);
  }

  public learnSkill(characterId: string, skillId: string): boolean {
    const skill = this.battle.getSkillConfig(skillId);
    const level = this.character.getLevel(characterId);
    if (skill?.requiredLevel && level < skill.requiredLevel) return false;
    return this.character.addSkill(characterId, skillId);
  }

  public on(event: RPGEventType, callback: EventCallback): () => void {
    return super.on(event, callback);
  }

  public onAny(callback: EventCallback): () => void {
    return super.on('*' as any, callback);
  }

  public destroy(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    (this.save as any).stopPlayTimeCounter?.();
    this.removeAllListeners();
  }

  public toJSON(): {
    characters: CharacterData[];
    inventory: { items: InventoryItem[]; gold: number };
    quests: QuestData[];
    dialogue: { state: any; variables: Record<string, any> };
    achievements: string[];
    chapterId: string;
    variables: Record<string, any>;
  } {
    return {
      characters: this.character.toJSON(),
      inventory: this.inventory.toJSON(),
      quests: this.quest.toJSON(),
      dialogue: this.dialogue.toJSON(),
      achievements: this.achievement.toJSON(),
      chapterId: this.save.getCurrentChapterId(),
      variables: this.dialogue.getAllVariables(),
    };
  }
}

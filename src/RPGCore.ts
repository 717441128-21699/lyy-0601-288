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
} from './types';

import { EventEmitter } from './systems/EventEmitter';
import { AttributeSystem } from './systems/AttributeSystem';
import { CharacterSystem } from './systems/CharacterSystem';
import { InventorySystem } from './systems/InventorySystem';
import { QuestSystem } from './systems/QuestSystem';
import { DialogueSystem } from './systems/DialogueSystem';
import { BattleSystem } from './systems/BattleSystem';
import { SaveSystem } from './systems/SaveSystem';
import { AchievementSystem } from './systems/AchievementSystem';

export class RPGCore extends EventEmitter {
  public attribute: AttributeSystem;
  public character: CharacterSystem;
  public inventory: InventorySystem;
  public quest: QuestSystem;
  public dialogue: DialogueSystem;
  public battle: BattleSystem;
  public save: SaveSystem;
  public achievement: AchievementSystem;

  private config: RPGCoreConfig;
  private battleResults: Map<string, string> = new Map();

  constructor(config: RPGCoreConfig = {}) {
    super();
    this.config = config;

    this.attribute = new AttributeSystem(config.defaultAttributes || []);

    this.character = new CharacterSystem(
      config.characters || [],
      config.levelTable || [],
      config.maxLevel
    );

    this.inventory = new InventorySystem(
      config.items || [],
      config.initialGold || 0
    );

    this.quest = new QuestSystem(config.quests || []);

    this.dialogue = new DialogueSystem(config.dialogues || []);

    this.battle = new BattleSystem(config.battles || []);

    this.save = new SaveSystem(
      config.chapters || [],
      config.endings || [],
      config.saveStorageKey,
      config.autoSave
    );

    this.achievement = new AchievementSystem(config.achievements || []);

    this.setupContexts();
    this.setupEventBridging();
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

    this.battle.setContext({
      getCharacterAttribute: (charId, attrId) =>
        this.character.getAttribute(charId, attrId),
      getCharacterMaxHp: (charId) =>
        this.character.getAttribute(charId, 'maxHp') ||
        this.character.getAttribute(charId, 'hp') ||
        100,
      getCharacterMaxMp: (charId) =>
        this.character.getAttribute(charId, 'maxMp') ||
        this.character.getAttribute(charId, 'mp') ||
        50,
      addExp: (charId, exp) => this.character.addExp(charId, exp),
      hasItem: (itemId, quantity) => this.inventory.hasItem(itemId, quantity),
      useItem: (itemId, targetId) => this.inventory.useItem(itemId, targetId),
    });

    this.save.setContext({
      getCharacters: () => this.character.toJSON(),
      getInventory: () => this.inventory.toJSON(),
      getQuests: () => this.quest.toJSON(),
      getDialogueState: () => this.dialogue.toJSON().state,
      getVariables: () => this.dialogue.getAllVariables(),
      getAchievements: () => this.achievement.toJSON(),
      getChapterId: () => this.save.getCurrentChapterId(),
      getPlayTime: () => this.save.getPlayTime(),
      loadCharacters: (data) => this.character.fromJSON(data as CharacterData[]),
      loadInventory: (data) =>
        this.inventory.fromJSON(data as { items: InventoryItem[]; gold: number }),
      loadQuests: (data) => this.quest.fromJSON(data as QuestData[]),
      loadDialogueState: (data) => {
        const dialogueData = this.dialogue.toJSON();
        dialogueData.state = data;
        this.dialogue.fromJSON(dialogueData);
      },
      loadVariables: (data) => {
        const dialogueData = this.dialogue.toJSON();
        dialogueData.variables = data;
        this.dialogue.fromJSON(dialogueData);
      },
      loadAchievements: (data) => this.achievement.fromJSON(data),
      loadChapterId: (chapterId) => this.save.setCurrentChapter(chapterId),
      loadPlayTime: (playTime) => {},
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
        if (player) {
          this.applyQuestRewards(player.id, rewards);
        }
      },
      getPlayerCharacterId: () => this.character.getPlayerCharacter()?.id,
    });
  }

  private setupEventBridging(): void {
    const bridgeEvents: RPGEventType[] = [
      'levelUp',
      'attributeChange',
      'itemAdded',
      'itemRemoved',
      'itemUsed',
      'questStarted',
      'questUpdated',
      'questCompleted',
      'questFailed',
      'dialogueStart',
      'dialogueEnd',
      'choiceSelected',
      'battleStart',
      'battleEnd',
      'battleTurn',
      'achievementUnlocked',
      'chapterUnlocked',
      'endingTriggered',
      'saveCreated',
      'saveLoaded',
      'affinityChange',
      'variableChange',
    ];

    const systems = [
      this.attribute,
      this.character,
      this.inventory,
      this.quest,
      this.dialogue,
      this.battle,
      this.save,
      this.achievement,
    ];

    bridgeEvents.forEach((eventType) => {
      systems.forEach((system) => {
        system.on(eventType, (event) => {
          this.emit(event.type, event.payload);
        });
      });
    });

    this.on('questCompleted', () => {
      this.achievement.triggerCheck();
      this.save.autoSaveIfEnabled();
    });

    this.on('levelUp', () => {
      this.achievement.triggerCheck();
    });

    this.on('chapterUnlocked', () => {
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

    this.on('effectTriggered', (event: any) => {
      if (event.payload?.effect) {
        this.applyDialogueEffect(event.payload.effect);
      }
    });
  }

  private applyDialogueEffect(effect: DialogueEffect): void {
    const {
      type,
      attributeId,
      characterId,
      itemId,
      questId,
      variableKey,
      chapterId,
      value,
      operation = 'add',
      questAction,
    } = effect;

    const targetCharId = characterId || this.character.getPlayerCharacter()?.id;
    if (!targetCharId) return;

    switch (type) {
      case 'attribute':
        if (attributeId && typeof value === 'number') {
          if (operation === 'add') {
            this.character.addAttribute(targetCharId, attributeId, value);
          } else if (operation === 'set') {
            this.character.setAttribute(targetCharId, attributeId, value);
          } else if (operation === 'remove') {
            this.character.addAttribute(targetCharId, attributeId, -value);
          }
        }
        break;

      case 'affinity':
        if (typeof value === 'number') {
          if (operation === 'add') {
            this.character.addAffinity(targetCharId, value);
          } else if (operation === 'set') {
            this.character.setAffinity(targetCharId, value);
          }
        }
        break;

      case 'item':
        if (itemId && typeof value === 'number') {
          if (operation === 'add' || operation === 'set') {
            this.inventory.addItem(itemId, value);
          } else if (operation === 'remove') {
            this.inventory.removeItem(itemId, value);
          }
        }
        break;

      case 'quest':
        if (questId) {
          if (questAction === 'start') {
            this.quest.startQuest(questId);
          } else if (questAction === 'complete') {
            this.quest.completeQuest(questId);
          }
        }
        break;

      case 'variable':
        if (variableKey && value !== undefined) {
          if (operation === 'set') {
            this.dialogue.setVariable(variableKey, value);
          } else if (operation === 'add' && typeof value === 'number') {
            const current = this.dialogue.getVariable(variableKey) || 0;
            this.dialogue.setVariable(variableKey, current + value);
          }
        }
        break;

      case 'chapter':
        if (chapterId) {
          this.save.unlockChapter(chapterId);
          this.save.setCurrentChapter(chapterId);
        }
        break;
    }
  }

  private applyQuestRewards(characterId: string, rewards: QuestReward[]): void {
    rewards.forEach((reward) => {
      switch (reward.type) {
        case 'exp':
          this.character.addExp(characterId, reward.value);
          break;
        case 'item':
          if (reward.itemId) {
            this.inventory.addItem(reward.itemId, reward.quantity || 1);
          }
          break;
        case 'gold':
          this.inventory.addGold(reward.value);
          break;
        case 'attribute':
          if (reward.attributeId) {
            this.character.addAttribute(characterId, reward.attributeId, reward.value);
          }
          break;
        case 'affinity':
          this.character.addAffinity(
            reward.characterId || characterId,
            reward.value
          );
          break;
      }
    });
  }

  createPlayer(config: Omit<CharacterConfig, 'isPlayer'>): CharacterData {
    return this.character.createCharacter({
      ...config,
      isPlayer: true,
    });
  }

  addCompanion(config: CharacterConfig): CharacterData {
    return this.character.createCharacter({
      ...config,
      isPlayer: false,
    });
  }

  startQuest(questId: string): boolean {
    const success = this.quest.startQuest(questId);
    if (success) {
      this.save.autoSaveIfEnabled();
    }
    return success;
  }

  completeQuest(questId: string): boolean {
    const rewards = this.quest.completeQuest(questId);
    if (rewards) {
      const player = this.character.getPlayerCharacter();
      if (player) {
        this.applyQuestRewards(player.id, rewards);
      }
      return true;
    }
    return false;
  }

  updateQuestObjective(
    questId: string,
    objectiveId: string,
    count: number = 1
  ): boolean {
    return this.quest.updateObjective(questId, objectiveId, count);
  }

  startDialogue(dialogueId: string): DialogueConfig | null {
    return this.dialogue.startDialogue(dialogueId);
  }

  selectDialogueChoice(choiceId: string): DialogueConfig | null {
    return this.dialogue.selectChoice(choiceId);
  }

  nextDialogue(): DialogueConfig | null {
    return this.dialogue.next();
  }

  getAvailableChoices(): DialogueChoice[] {
    return this.dialogue.getAvailableChoices();
  }

  startBattle(battleId: string): BattleState | null {
    return this.battle.startBattle(battleId);
  }

  executeBattleAction(action: BattleAction): any {
    return this.battle.executeAction(action);
  }

  retryBattle(): BattleState | null {
    return this.battle.retryBattle();
  }

  createSave(slotId: string): SaveData | null {
    return this.save.createSave(slotId);
  }

  loadSave(slotId: string): boolean {
    const success = this.save.loadSave(slotId);
    if (success) {
      this.achievement.triggerCheck();
    }
    return success;
  }

  quickSave(): SaveData | null {
    return this.save.createSave('quicksave');
  }

  quickLoad(): boolean {
    return this.save.loadSave('quicksave');
  }

  getSaveSlots(): SaveSlotInfo[] {
    return this.save.getSaveSlotInfos();
  }

  unlockAchievement(achievementId: string): boolean {
    return this.achievement.unlockAchievement(achievementId);
  }

  checkAchievements(): string[] {
    return this.achievement.checkAllAchievements();
  }

  setVariable(key: string, value: any): void {
    this.dialogue.setVariable(key, value);
  }

  getVariable(key: string): any {
    return this.dialogue.getVariable(key);
  }

  unlockChapter(chapterId: string): boolean {
    return this.save.unlockChapter(chapterId);
  }

  getCurrentChapter(): ChapterConfig | undefined {
    return this.save.getCurrentChapter();
  }

  checkEnding(): EndingConfig | null {
    return this.save.checkEndingConditions((condition) =>
      this.checkDialogueCondition(condition)
    );
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

  addItemConfig(config: ItemConfig): void {
    this.inventory.addItemConfig(config);
  }

  addQuestConfig(config: QuestConfig): void {
    this.quest.addQuestConfig(config);
  }

  addDialogueConfig(config: DialogueConfig): void {
    this.dialogue.addDialogueConfig(config);
  }

  addCharacterConfig(config: CharacterConfig): void {
    this.character.createCharacter(config);
  }

  addAchievementConfig(config: AchievementConfig): void {
    this.achievement.addAchievement(config);
  }

  addChapterConfig(config: ChapterConfig): void {
    this.save.addChapter(config);
  }

  addEndingConfig(config: EndingConfig): void {
    this.save.addEnding(config);
  }

  addBattleConfig(config: BattleConfig): void {
    this.battle.addBattleConfig(config);
  }

  addAttributeConfig(config: AttributeConfig): void {
    this.attribute.addAttributeConfig(config);
  }

  addLevelConfig(config: LevelConfig): void {}

  addGold(amount: number): number {
    return this.inventory.addGold(amount);
  }

  spendGold(amount: number): boolean {
    return this.inventory.spendGold(amount);
  }

  getGold(): number {
    return this.inventory.getGold();
  }

  reset(): void {
    this.attribute.reset();
    this.inventory.clear();
    this.quest.resetAllQuests();
    this.dialogue.reset();
    this.achievement.reset();
    this.battleResults.clear();
  }

  getPlayer(): CharacterData | undefined {
    return this.character.getPlayerCharacter();
  }

  getCompanions(): CharacterData[] {
    return this.character.getAllCharacters().filter((c) => !c.isPlayer);
  }

  getQuests(): QuestData[] {
    return this.quest.getAllQuests();
  }

  getActiveQuests(): QuestData[] {
    return this.quest.getActiveQuests();
  }

  getCompletedQuests(): QuestData[] {
    return this.quest.getCompletedQuests();
  }

  getInventory(): InventoryItem[] {
    return this.inventory.getAllItems();
  }

  getUnlockedAchievements(): AchievementConfig[] {
    return this.achievement.getUnlockedAchievements();
  }

  getAchievementProgress(): {
    unlocked: number;
    total: number;
    percentage: number;
  } {
    return this.achievement.getProgress();
  }

  on(event: RPGEventType, callback: EventCallback): () => void {
    return super.on(event, callback);
  }

  toJSON(): {
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

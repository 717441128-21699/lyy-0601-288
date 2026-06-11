import {
  SaveData,
  SaveSlotInfo,
  ChapterConfig,
  EndingConfig,
  DialogueCondition,
} from '../types';
import { EventEmitter } from './EventEmitter';

export interface SaveContext {
  getCharacters: () => any[];
  getInventory: () => { items: any[]; gold: number };
  getQuests: () => any[];
  getDialogueState: () => any;
  getVariables: () => Record<string, any>;
  getAchievements: () => string[];
  getChapterId: () => string;
  getPlayTime: () => number;
  loadCharacters: (data: any[]) => void;
  loadInventory: (data: { items: any[]; gold: number }) => void;
  loadQuests: (data: any[]) => void;
  loadDialogueState: (data: any) => void;
  loadVariables: (data: Record<string, any>) => void;
  loadAchievements: (data: string[]) => void;
  loadChapterId: (chapterId: string) => void;
  loadPlayTime: (playTime: number) => void;
}

export class SaveSystem extends EventEmitter {
  private saves: Map<string, SaveData> = new Map();
  private chapters: Map<string, ChapterConfig> = new Map();
  private endings: Map<string, EndingConfig> = new Map();
  private currentChapterId: string = 'ch1';
  private storageKey: string = 'rpg_save_data';
  private autoSave: boolean = false;
  private context?: SaveContext;
  private playTime: number = 0;
  private playTimeInterval?: any;

  constructor(
    chapters: ChapterConfig[] = [],
    endings: EndingConfig[] = [],
    storageKey?: string,
    autoSave?: boolean
  ) {
    super();
    chapters.forEach((ch) => this.addChapter(ch));
    endings.forEach((e) => this.addEnding(e));
    if (storageKey) this.storageKey = storageKey;
    if (autoSave !== undefined) this.autoSave = autoSave;
  }

  setContext(context: SaveContext): void {
    this.context = context;
  }

  addChapter(chapter: ChapterConfig): void {
    this.chapters.set(chapter.id, chapter);
  }

  getChapter(id: string): ChapterConfig | undefined {
    return this.chapters.get(id);
  }

  getAllChapters(): ChapterConfig[] {
    return Array.from(this.chapters.values()).sort((a, b) => a.order - b.order);
  }

  getCurrentChapter(): ChapterConfig | undefined {
    return this.chapters.get(this.currentChapterId);
  }

  getCurrentChapterId(): string {
    return this.currentChapterId;
  }

  setCurrentChapter(chapterId: string): boolean {
    const chapter = this.chapters.get(chapterId);
    if (!chapter || !chapter.isUnlocked) return false;

    this.currentChapterId = chapterId;
    return true;
  }

  unlockChapter(chapterId: string): boolean {
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.isUnlocked) return false;

    chapter.isUnlocked = true;

    this.emit('chapterUnlocked', {
      chapterId,
      chapter,
    });

    return true;
  }

  isChapterUnlocked(chapterId: string): boolean {
    return this.chapters.get(chapterId)?.isUnlocked ?? false;
  }

  checkChapterPrerequisites(chapterId: string): boolean {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) return false;

    if (!chapter.prerequisites?.length) return true;

    return chapter.prerequisites.every((prereqId) => {
      const prereq = this.chapters.get(prereqId);
      return prereq?.isUnlocked ?? false;
    });
  }

  addEnding(ending: EndingConfig): void {
    this.endings.set(ending.id, ending);
  }

  getEnding(id: string): EndingConfig | undefined {
    return this.endings.get(id);
  }

  getAllEndings(): EndingConfig[] {
    return Array.from(this.endings.values());
  }

  checkEndingConditions(
    conditionChecker: (condition: DialogueCondition) => boolean
  ): EndingConfig | null {
    for (const ending of this.endings.values()) {
      const allConditionsMet = ending.condition.every((cond) =>
        conditionChecker(cond)
      );
      if (allConditionsMet) {
        return ending;
      }
    }
    return null;
  }

  triggerEnding(endingId: string): boolean {
    const ending = this.endings.get(endingId);
    if (!ending) return false;

    const chapter = this.getCurrentChapter();
    if (chapter) {
      (chapter as any).endingId = endingId;
    }

    this.emit('endingTriggered', {
      endingId,
      ending,
    });

    return true;
  }

  createSave(slotId: string): SaveData | null {
    if (!this.context) return null;

    const now = Date.now();
    const existing = this.saves.get(slotId);
    const inv = this.context.getInventory();

    const saveData: SaveData = {
      id: slotId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      chapterId: this.currentChapterId,
      characters: this.context.getCharacters(),
      inventory: inv.items,
      gold: inv.gold,
      quests: this.context.getQuests(),
      dialogue: this.context.getDialogueState(),
      variables: this.context.getVariables(),
      achievements: this.context.getAchievements(),
      playTime: this.playTime,
    };

    this.saves.set(slotId, saveData);
    this.persistToStorage();

    this.emit('saveCreated', {
      saveId: slotId,
      save: saveData,
    });

    return saveData;
  }

  loadSave(slotId: string): boolean {
    const saveData = this.saves.get(slotId);
    if (!saveData || !this.context) return false;

    this.context.loadCharacters(saveData.characters);
    this.context.loadInventory({
      items: saveData.inventory,
      gold: saveData.gold,
    });
    this.context.loadQuests(saveData.quests);
    this.context.loadDialogueState(saveData.dialogue);
    this.context.loadVariables(saveData.variables);
    this.context.loadAchievements(saveData.achievements);
    this.currentChapterId = saveData.chapterId;
    this.playTime = saveData.playTime;

    this.emit('saveLoaded', {
      saveId: slotId,
      save: saveData,
    });

    return true;
  }

  deleteSave(slotId: string): boolean {
    const result = this.saves.delete(slotId);
    if (result) {
      this.persistToStorage();
    }
    return result;
  }

  getSave(slotId: string): SaveData | undefined {
    return this.saves.get(slotId);
  }

  getAllSaves(): SaveData[] {
    return Array.from(this.saves.values());
  }

  getSaveSlotInfos(): SaveSlotInfo[] {
    return this.getAllSaves().map((save) => {
      const chapter = this.chapters.get(save.chapterId);
      const playerChar = save.characters.find((c: any) => c.isPlayer);

      return {
        id: save.id,
        chapterName: chapter?.name,
        playerName: playerChar?.name,
        playerLevel: playerChar?.level,
        updatedAt: save.updatedAt,
        playTime: save.playTime,
      };
    });
  }

  hasSave(slotId: string): boolean {
    return this.saves.has(slotId);
  }

  autoSaveIfEnabled(): void {
    if (this.autoSave) {
      this.createSave('auto');
    }
  }

  enableAutoSave(enable: boolean = true): void {
    this.autoSave = enable;
  }

  private persistToStorage(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const data = Array.from(this.saves.values());
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to persist saves:', e);
      }
    }
  }

  loadFromStorage(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const data = localStorage.getItem(this.storageKey);
        if (data) {
          const saves = JSON.parse(data) as SaveData[];
          this.saves.clear();
          saves.forEach((save) => {
            this.saves.set(save.id, save);
          });
        }
      } catch (e) {
        console.error('Failed to load saves:', e);
      }
    }
  }

  getPlayTime(): number {
    return this.playTime;
  }

  startPlayTimeCounter(): void {
    if (this.playTimeInterval) return;

    this.playTimeInterval = setInterval(() => {
      this.playTime += 1;
    }, 1000);
  }

  stopPlayTimeCounter(): void {
    if (this.playTimeInterval) {
      clearInterval(this.playTimeInterval);
      this.playTimeInterval = undefined;
    }
  }

  formatPlayTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  resetSaves(): void {
    this.saves.clear();
    this.persistToStorage();
  }

  importSaveData(data: SaveData[]): void {
    data.forEach((save) => {
      this.saves.set(save.id, save);
    });
    this.persistToStorage();
  }

  exportSaveData(): SaveData[] {
    return Array.from(this.saves.values());
  }
}

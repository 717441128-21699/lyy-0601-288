import {
  SaveData,
  SaveSlotInfo,
  ChapterConfig,
  EndingConfig,
  DialogueCondition,
  SaveStorageAdapter,
  SaveMigration,
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

export interface SaveSystemOptions {
  chapters?: ChapterConfig[];
  endings?: EndingConfig[];
  storageKey?: string;
  autoSave?: boolean;
  autoSaveInterval?: number;
  adapter?: SaveStorageAdapter;
  migrations?: SaveMigration[];
  currentVersion?: number;
  validateValues?: boolean;
  clampNegativeValues?: boolean;
  autoRestore?: boolean;
}

export class LocalStorageSaveAdapter implements SaveStorageAdapter {
  private storageKey: string;

  constructor(storageKey: string = 'rpg_save_data') {
    this.storageKey = storageKey;
  }

  private isAvailable(): boolean {
    return typeof localStorage !== 'undefined';
  }

  private readAll(): SaveData[] {
    if (!this.isAvailable()) return [];
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? (JSON.parse(raw) as SaveData[]) : [];
    } catch {
      return [];
    }
  }

  private writeAll(saves: SaveData[]): boolean {
    if (!this.isAvailable()) return false;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(saves));
      return true;
    } catch {
      return false;
    }
  }

  async save(slotId: string, data: SaveData): Promise<boolean> {
    const saves = this.readAll();
    const idx = saves.findIndex((s) => s.id === slotId);
    if (idx >= 0) {
      saves[idx] = data;
    } else {
      saves.push(data);
    }
    return this.writeAll(saves);
  }

  async load(slotId: string): Promise<SaveData | null> {
    const saves = this.readAll();
    return saves.find((s) => s.id === slotId) || null;
  }

  async delete(slotId: string): Promise<boolean> {
    const saves = this.readAll();
    const filtered = saves.filter((s) => s.id !== slotId);
    if (filtered.length === saves.length) return false;
    return this.writeAll(filtered);
  }

  async list(): Promise<SaveSlotInfo[]> {
    const saves = this.readAll();
    return saves.map((save) => ({
      id: save.id,
      version: save.version,
      updatedAt: save.updatedAt,
      playTime: save.playTime,
      size: JSON.stringify(save).length,
    }));
  }

  async exists(slotId: string): Promise<boolean> {
    const saves = this.readAll();
    return saves.some((s) => s.id === slotId);
  }

  async clear(): Promise<boolean> {
    return this.writeAll([]);
  }
}

const DEFAULT_VERSION = 1;
const LAST_SAVE_KEY = 'rpg_last_save_slot';
const CHECKSUM_SALT = 'rpg_save_checksum_salt_v1';

function computeChecksum(data: any): string {
  const str = JSON.stringify(data) + CHECKSUM_SALT;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function isValidNumber(val: any): boolean {
  return typeof val === 'number' && !isNaN(val) && isFinite(val);
}

function clampNonNegative(val: number): number {
  return Math.max(0, val);
}

export class SaveSystem extends EventEmitter {
  private saves: Map<string, SaveData> = new Map();
  private chapters: Map<string, ChapterConfig> = new Map();
  private endings: Map<string, EndingConfig> = new Map();
  private currentChapterId: string = 'ch1';
  private storageKey: string = 'rpg_save_data';
  private autoSave: boolean = false;
  private autoSaveIntervalMs: number = 60000;
  private autoSaveTimer?: any;
  private context?: SaveContext;
  private playTime: number = 0;
  private playTimeInterval?: any;
  private adapter: SaveStorageAdapter;
  private migrations: SaveMigration[] = [];
  private currentVersion: number = DEFAULT_VERSION;
  private validateValues: boolean = true;
  private clampNegativeValues: boolean = false;
  private lastSaveSlotId: string | null = null;

  constructor(options: SaveSystemOptions = {}) {
    super();

    const {
      chapters = [],
      endings = [],
      storageKey = 'rpg_save_data',
      autoSave = false,
      autoSaveInterval = 60000,
      adapter,
      migrations = [],
      currentVersion = DEFAULT_VERSION,
      validateValues = true,
      clampNegativeValues = false,
      autoRestore = true,
    } = options;

    chapters.forEach((ch) => this.addChapter(ch));
    endings.forEach((e) => this.addEnding(e));
    this.storageKey = storageKey;
    this.autoSave = autoSave;
    this.autoSaveIntervalMs = autoSaveInterval;
    this.adapter = adapter || new LocalStorageSaveAdapter(storageKey);
    this.migrations = migrations;
    this.currentVersion = currentVersion;
    this.validateValues = validateValues;
    this.clampNegativeValues = clampNegativeValues;

    if (this.autoSave) {
      this.startAutoSaveTimer();
    }

    if (autoRestore) {
      Promise.resolve().then(() => this.tryRestoreLastSave());
    }
  }

  setAdapter(adapter: SaveStorageAdapter): void {
    this.adapter = adapter;
  }

  getAdapter(): SaveStorageAdapter {
    return this.adapter;
  }

  addMigration(migration: SaveMigration): void {
    this.migrations.push(migration);
  }

  setMigrations(migrations: SaveMigration[]): void {
    this.migrations = [...migrations];
  }

  private findMigrationChain(fromVersion: number, toVersion: number): SaveMigration[] | null {
    if (fromVersion === toVersion) return [];

    const graph: Map<number, SaveMigration[]> = new Map();
    for (const m of this.migrations) {
      if (!graph.has(m.fromVersion)) {
        graph.set(m.fromVersion, []);
      }
      graph.get(m.fromVersion)!.push(m);
    }

    const queue: { version: number; path: SaveMigration[] }[] = [
      { version: fromVersion, path: [] },
    ];
    const visited = new Set<number>([fromVersion]);

    while (queue.length > 0) {
      const { version, path } = queue.shift()!;
      const edges = graph.get(version) || [];
      for (const migration of edges) {
        if (visited.has(migration.toVersion)) continue;
        const newPath = [...path, migration];
        if (migration.toVersion === toVersion) {
          return newPath;
        }
        visited.add(migration.toVersion);
        queue.push({ version: migration.toVersion, path: newPath });
      }
    }

    return null;
  }

  private migrateSaveData(rawData: any): { data: SaveData; migrated: boolean; chain: SaveMigration[] } {
    const fromVersion = typeof rawData.version === 'number' ? rawData.version : 0;
    const toVersion = this.currentVersion;

    if (fromVersion === toVersion) {
      return { data: rawData as SaveData, migrated: false, chain: [] };
    }

    const chain = this.findMigrationChain(fromVersion, toVersion);
    if (!chain) {
      throw new Error(
        `No migration path found from version ${fromVersion} to ${toVersion}`
      );
    }

    let data: any = rawData;
    for (const migration of chain) {
      data = migration.migrate(data);
    }

    data.version = toVersion;

    return { data: data as SaveData, migrated: true, chain };
  }

  private validateNumber(value: any, fieldName: string): number {
    if (!this.validateValues) {
      return typeof value === 'number' ? value : 0;
    }
    if (!isValidNumber(value)) {
      throw new Error(`Invalid numeric value for ${fieldName}: ${value}`);
    }
    if (value < 0) {
      if (this.clampNegativeValues) {
        return 0;
      }
      throw new Error(`Negative value not allowed for ${fieldName}: ${value}`);
    }
    return value;
  }

  private sanitizeSaveData(save: SaveData): SaveData {
    if (!this.validateValues) return save;

    try {
      save.gold = this.validateNumber(save.gold, 'gold');
      save.playTime = this.validateNumber(save.playTime, 'playTime');

      if (Array.isArray(save.characters)) {
        save.characters.forEach((char: any) => {
          if (char) {
            if (char.level !== undefined) {
              char.level = Math.max(1, Math.floor(this.validateNumber(char.level, 'character.level')));
            }
            if (char.exp !== undefined) {
              char.exp = this.validateNumber(char.exp, 'character.exp');
            }
            if (char.affinity !== undefined) {
              char.affinity = this.validateNumber(char.affinity, 'character.affinity');
            }
            if (char.affinityMax !== undefined) {
              char.affinityMax = this.validateNumber(char.affinityMax, 'character.affinityMax');
            }
            if (char.attributes && typeof char.attributes === 'object') {
              for (const key of Object.keys(char.attributes)) {
                char.attributes[key] = this.validateNumber(
                  char.attributes[key],
                  `character.attributes.${key}`
                );
              }
            }
            if (char.skillCooldowns && typeof char.skillCooldowns === 'object') {
              for (const key of Object.keys(char.skillCooldowns)) {
                char.skillCooldowns[key] = this.validateNumber(
                  char.skillCooldowns[key],
                  `character.skillCooldowns.${key}`
                );
              }
            }
          }
        });
      }

      if (Array.isArray(save.inventory)) {
        save.inventory.forEach((item: any) => {
          if (item) {
            item.quantity = Math.max(1, Math.floor(
              this.validateNumber(item.quantity, 'inventory.quantity')
            ));
          }
        });
      }

      return save;
    } catch (e) {
      if (this.clampNegativeValues) {
        return save;
      }
      throw e;
    }
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

  async createSave(slotId: string): Promise<SaveData | null> {
    if (!this.context) return null;

    const now = Date.now();
    const existing = this.saves.get(slotId);
    const inv = this.context.getInventory();

    const saveData: SaveData = {
      id: slotId,
      version: this.currentVersion,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      chapterId: this.currentChapterId,
      characters: this.context.getCharacters(),
      inventory: inv.items,
      gold: this.validateNumber(inv.gold, 'gold'),
      quests: this.context.getQuests(),
      dialogue: this.context.getDialogueState(),
      variables: this.context.getVariables(),
      achievements: this.context.getAchievements(),
      playTime: this.validateNumber(this.playTime, 'playTime'),
    };

    this.sanitizeSaveData(saveData);

    this.saves.set(slotId, saveData);
    this.lastSaveSlotId = slotId;
    this.setLastSaveSlot(slotId);

    await this.adapter.save(slotId, saveData);

    this.emit('saveCreated', {
      saveId: slotId,
      save: saveData,
    });

    return saveData;
  }

  async loadSave(slotId: string): Promise<boolean> {
    let saveData = this.saves.get(slotId);

    if (!saveData) {
      const raw = await this.adapter.load(slotId);
      if (raw) {
        try {
          const { data, migrated, chain } = this.migrateSaveData(raw);
          saveData = data;
          this.sanitizeSaveData(saveData);
          this.saves.set(slotId, saveData);
          if (migrated) {
            this.emit('saveMigrated', {
              saveId: slotId,
              fromVersion: raw.version,
              toVersion: this.currentVersion,
              migrations: chain.map((m) => ({
                from: m.fromVersion,
                to: m.toVersion,
              })),
            });
            await this.adapter.save(slotId, saveData);
          }
        } catch (e) {
          console.error('Failed to migrate save data:', e);
          return false;
        }
      }
    }

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
    this.lastSaveSlotId = slotId;
    this.setLastSaveSlot(slotId);

    this.emit('saveLoaded', {
      saveId: slotId,
      save: saveData,
    });

    return true;
  }

  async deleteSave(slotId: string): Promise<boolean> {
    const existed = this.saves.has(slotId);
    this.saves.delete(slotId);

    const adapterResult = await this.adapter.delete(slotId);
    const success = existed || adapterResult;

    if (success) {
      this.emit('saveDeleted', {
        saveId: slotId,
      });
      if (this.lastSaveSlotId === slotId) {
        this.lastSaveSlotId = null;
        this.setLastSaveSlot(null);
      }
    }

    return success;
  }

  getSave(slotId: string): SaveData | undefined {
    return this.saves.get(slotId);
  }

  getAllSaves(): SaveData[] {
    return Array.from(this.saves.values());
  }

  async getSaveSlotInfos(): Promise<SaveSlotInfo[]> {
    let adapterSlots: SaveSlotInfo[] = [];
    if (this.adapter.list) {
      try {
        adapterSlots = await this.adapter.list();
      } catch {
        adapterSlots = [];
      }
    }

    const memorySlots = this.getAllSaves().map((save) => {
      const chapter = this.chapters.get(save.chapterId);
      const playerChar = save.characters.find((c: any) => c.isPlayer);

      return {
        id: save.id,
        version: save.version,
        chapterName: chapter?.name,
        playerName: playerChar?.name,
        playerLevel: playerChar?.level,
        updatedAt: save.updatedAt,
        playTime: save.playTime,
        size: JSON.stringify(save).length,
      };
    });

    const slotMap = new Map<string, SaveSlotInfo>();
    for (const slot of memorySlots) {
      slotMap.set(slot.id, slot);
    }
    for (const slot of adapterSlots) {
      if (!slotMap.has(slot.id)) {
        slotMap.set(slot.id, slot);
      } else {
        const existing = slotMap.get(slot.id)!;
        slotMap.set(slot.id, {
          ...existing,
          ...slot,
        });
      }
    }

    return Array.from(slotMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async hasSave(slotId: string): Promise<boolean> {
    if (this.saves.has(slotId)) return true;
    if (this.adapter.exists) {
      try {
        return await this.adapter.exists(slotId);
      } catch {
        return false;
      }
    }
    return false;
  }

  autoSaveIfEnabled(): void {
    if (this.autoSave) {
      this.createSave('auto');
    }
  }

  enableAutoSave(enable: boolean = true, intervalMs?: number): void {
    this.autoSave = enable;
    if (intervalMs !== undefined) {
      this.autoSaveIntervalMs = intervalMs;
    }
    if (enable) {
      this.startAutoSaveTimer();
    } else {
      this.stopAutoSaveTimer();
    }
  }

  private startAutoSaveTimer(): void {
    this.stopAutoSaveTimer();
    if (this.autoSaveIntervalMs > 0) {
      this.autoSaveTimer = setInterval(() => {
        this.autoSaveIfEnabled();
      }, this.autoSaveIntervalMs);
    }
  }

  private stopAutoSaveTimer(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  private setLastSaveSlot(slotId: string | null): void {
    try {
      if (typeof localStorage !== 'undefined') {
        if (slotId) {
          localStorage.setItem(`${this.storageKey}_${LAST_SAVE_KEY}`, slotId);
        } else {
          localStorage.removeItem(`${this.storageKey}_${LAST_SAVE_KEY}`);
        }
      }
    } catch {
    }
  }

  private getLastSaveSlot(): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(`${this.storageKey}_${LAST_SAVE_KEY}`);
      }
    } catch {
    }
    return null;
  }

  async tryRestoreLastSave(): Promise<SaveData | null> {
    if (!this.context) return null;

    let slotId = this.getLastSaveSlot() || this.lastSaveSlotId;

    if (!slotId) {
      const slots = await this.getSaveSlotInfos();
      if (slots.length > 0) {
        slotId = slots[0].id;
      }
    }

    if (!slotId) return null;

    const loaded = await this.loadSave(slotId);
    if (loaded) {
      return this.saves.get(slotId) || null;
    }

    return null;
  }

  exportSave(slotId: string, includeChecksum: boolean = true): string {
    const save = this.saves.get(slotId);
    if (!save) {
      throw new Error(`Save slot "${slotId}" not found`);
    }

    const exportObj: any = {
      save,
      exportedAt: Date.now(),
      exporterVersion: 1,
    };

    if (includeChecksum) {
      exportObj.checksum = computeChecksum(save);
    }

    return JSON.stringify(exportObj);
  }

  exportAllSaves(includeChecksum: boolean = true): string {
    const saves = this.getAllSaves();
    const exportObj: any = {
      saves,
      exportedAt: Date.now(),
      exporterVersion: 1,
      count: saves.length,
    };

    if (includeChecksum) {
      exportObj.checksum = computeChecksum(saves);
    }

    return JSON.stringify(exportObj);
  }

  async importSave(jsonString: string, options?: { overwrite?: boolean; slotId?: string }): Promise<SaveData> {
    const { overwrite = true, slotId } = options || {};

    let parsed: any;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Invalid JSON format');
    }

    let rawSave: any;
    if (parsed.save) {
      rawSave = parsed.save;
      if (parsed.checksum) {
        const expected = computeChecksum(rawSave);
        if (expected !== parsed.checksum) {
          throw new Error('Checksum validation failed: save data may be corrupted');
        }
      }
    } else {
      rawSave = parsed;
    }

    if (!rawSave || typeof rawSave !== 'object') {
      throw new Error('Invalid save data structure');
    }

    const { data: migratedSave, migrated, chain } = this.migrateSaveData(rawSave);
    this.sanitizeSaveData(migratedSave);

    const targetSlotId = slotId || migratedSave.id || `imported_${Date.now()}`;
    migratedSave.id = targetSlotId;
    migratedSave.updatedAt = Date.now();
    if (!migratedSave.createdAt) {
      migratedSave.createdAt = migratedSave.updatedAt;
    }

    if (!overwrite) {
      const exists = await this.hasSave(targetSlotId);
      if (exists) {
        throw new Error(`Save slot "${targetSlotId}" already exists`);
      }
    }

    this.saves.set(targetSlotId, migratedSave);
    this.lastSaveSlotId = targetSlotId;
    this.setLastSaveSlot(targetSlotId);
    await this.adapter.save(targetSlotId, migratedSave);

    if (migrated) {
      this.emit('saveMigrated', {
        saveId: targetSlotId,
        fromVersion: rawSave.version,
        toVersion: this.currentVersion,
        migrations: chain.map((m) => ({
          from: m.fromVersion,
          to: m.toVersion,
        })),
      });
    }

    this.emit('saveImported', {
      saveId: targetSlotId,
      save: migratedSave,
      migrated,
    });

    return migratedSave;
  }

  async importAllSaves(jsonString: string, overwrite: boolean = true): Promise<SaveData[]> {
    let parsed: any;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Invalid JSON format');
    }

    let rawSaves: any[];
    if (parsed.saves && Array.isArray(parsed.saves)) {
      rawSaves = parsed.saves;
      if (parsed.checksum) {
        const expected = computeChecksum(rawSaves);
        if (expected !== parsed.checksum) {
          throw new Error('Checksum validation failed: save data may be corrupted');
        }
      }
    } else if (Array.isArray(parsed)) {
      rawSaves = parsed;
    } else {
      rawSaves = [parsed];
    }

    const imported: SaveData[] = [];
    for (const rawSave of rawSaves) {
      try {
        const singleJson = JSON.stringify({ save: rawSave });
        const save = await this.importSave(singleJson, { overwrite });
        imported.push(save);
      } catch (e) {
        console.warn('Failed to import save:', e);
      }
    }

    return imported;
  }

  async clearAllSaves(): Promise<boolean> {
    this.saves.clear();

    let result = true;
    if (this.adapter.clear) {
      try {
        result = await this.adapter.clear();
      } catch {
        result = false;
      }
    }

    this.lastSaveSlotId = null;
    this.setLastSaveSlot(null);

    return result;
  }

  getPlayTime(): number {
    return this.playTime;
  }

  addPlayTime(seconds: number): number {
    const validSeconds = this.validateNumber(seconds, 'playTime increment');
    this.playTime += validSeconds;
    return this.playTime;
  }

  setPlayTime(seconds: number): void {
    this.playTime = this.validateNumber(seconds, 'playTime');
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
    const validSeconds = isValidNumber(seconds) ? Math.max(0, seconds) : 0;
    const hours = Math.floor(validSeconds / 3600);
    const minutes = Math.floor((validSeconds % 3600) / 60);
    const secs = validSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  resetSaves(): void {
    this.saves.clear();
    this.lastSaveSlotId = null;
    this.setLastSaveSlot(null);
    if (this.adapter.clear) {
      this.adapter.clear();
    }
  }

  importSaveData(data: SaveData[]): void {
    data.forEach((save) => {
      try {
        const { data: migrated } = this.migrateSaveData(save);
        this.sanitizeSaveData(migrated);
        this.saves.set(save.id, migrated);
      } catch (e) {
        console.warn('Skipping save during importSaveData:', e);
      }
    });
    if (this.adapter.clear) {
      this.adapter.clear();
    }
    this.saves.forEach((save, id) => {
      this.adapter.save(id, save);
    });
  }

  exportSaveData(): SaveData[] {
    return Array.from(this.saves.values());
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }

  setValidateValues(enable: boolean): void {
    this.validateValues = enable;
  }

  setClampNegativeValues(enable: boolean): void {
    this.clampNegativeValues = enable;
  }

  validateSaveData(save: SaveData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const oldValidate = this.validateValues;
    const oldClamp = this.clampNegativeValues;
    this.validateValues = true;
    this.clampNegativeValues = false;

    try {
      this.sanitizeSaveData(JSON.parse(JSON.stringify(save)));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    this.validateValues = oldValidate;
    this.clampNegativeValues = oldClamp;

    return { valid: errors.length === 0, errors };
  }

  destroy(): void {
    this.stopPlayTimeCounter();
    this.stopAutoSaveTimer();
    this.saves.clear();
    this.removeAllListeners();
  }
}

import {
  CharacterConfig,
  CharacterData,
  LevelConfig,
  AttributeData,
  QuestReward,
  AttributeConfig,
} from '../types';
import { EventEmitter } from './EventEmitter';

export class CharacterSystem extends EventEmitter {
  private characters: Map<string, CharacterData> = new Map();
  private levelTable: LevelConfig[] = [];
  private maxLevel: number = 99;
  private defaultAttributes: AttributeConfig[] = [];

  constructor(
    configs: CharacterConfig[] = [],
    levelTable: LevelConfig[] = [],
    maxLevel: number = 99,
    defaultAttributes: AttributeConfig[] = []
  ) {
    super();
    this.levelTable = levelTable;
    this.maxLevel = maxLevel;
    this.defaultAttributes = defaultAttributes;
    configs.forEach((config) => this.createCharacter(config));
  }

  private isValidNumber(n: any): boolean {
    return typeof n === 'number' && !isNaN(n) && isFinite(n);
  }

  private sanitizeAmount(
    n: number,
    min: number = 0,
    max: number = Infinity
  ): number {
    if (!this.isValidNumber(n)) return min;
    return Math.min(Math.max(min, n), max);
  }

  private getAttributeConfig(attributeId: string): AttributeConfig | undefined {
    return this.defaultAttributes.find((a) => a.id === attributeId);
  }

  createCharacter(config: CharacterConfig): CharacterData {
    const attributes: Record<string, number> = {};
    if (config.initialAttributes) {
      config.initialAttributes.forEach((attr: AttributeData) => {
        const attrConfig = this.getAttributeConfig(attr.id);
        const min = attrConfig?.minValue ?? 0;
        const max = attrConfig?.maxValue ?? Infinity;
        attributes[attr.id] = this.sanitizeAmount(attr.value, min, max);
      });
    }

    const initialLevel = this.sanitizeAmount(config.initialLevel ?? 1, 1, this.maxLevel);
    const initialExp = this.sanitizeAmount(config.initialExp ?? 0, 0);
    const affinityMax = this.sanitizeAmount(config.affinityMax ?? 100, 0);
    const initialAffinity = this.sanitizeAmount(config.affinity ?? 0, 0, affinityMax);

    const character: CharacterData = {
      id: config.id,
      name: config.name,
      avatar: config.avatar,
      description: config.description,
      level: initialLevel,
      exp: initialExp,
      attributes,
      affinity: initialAffinity,
      affinityMax,
      isPlayer: config.isPlayer ?? false,
      skills: [],
      skillCooldowns: {},
    };

    this.characters.set(config.id, character);
    return character;
  }

  getCharacter(id: string): CharacterData | undefined {
    return this.characters.get(id);
  }

  getAllCharacters(): CharacterData[] {
    return Array.from(this.characters.values());
  }

  getPlayerCharacter(): CharacterData | undefined {
    return this.getAllCharacters().find((c) => c.isPlayer);
  }

  addCharacter(character: CharacterData): void {
    this.characters.set(character.id, character);
  }

  removeCharacter(id: string): boolean {
    return this.characters.delete(id);
  }

  hasCharacter(id: string): boolean {
    return this.characters.has(id);
  }

  getAttribute(characterId: string, attributeId: string): number {
    const character = this.getCharacter(characterId);
    if (!character) return 0;
    return character.attributes[attributeId] ?? 0;
  }

  setAttribute(
    characterId: string,
    attributeId: string,
    value: number
  ): number {
    const character = this.getCharacter(characterId);
    if (!character) return 0;

    if (!this.isValidNumber(value)) {
      return character.attributes[attributeId] ?? 0;
    }

    const attrConfig = this.getAttributeConfig(attributeId);
    const min = attrConfig?.minValue ?? 0;
    const max = attrConfig?.maxValue ?? Infinity;
    const clampedValue = this.sanitizeAmount(value, min, max);

    const oldValue = character.attributes[attributeId] ?? 0;
    character.attributes[attributeId] = clampedValue;

    if (oldValue !== clampedValue) {
      this.emit('attributeChange', {
        characterId,
        attributeId,
        oldValue,
        newValue: clampedValue,
      });
    }

    return clampedValue;
  }

  addAttribute(
    characterId: string,
    attributeId: string,
    amount: number
  ): number {
    if (!this.isValidNumber(amount)) {
      return this.getAttribute(characterId, attributeId);
    }
    const current = this.getAttribute(characterId, attributeId);
    return this.setAttribute(characterId, attributeId, current + amount);
  }

  getExp(characterId: string): number {
    return this.getCharacter(characterId)?.exp ?? 0;
  }

  getLevel(characterId: string): number {
    return this.getCharacter(characterId)?.level ?? 1;
  }

  getExpRequiredForLevel(level: number): number {
    if (!this.isValidNumber(level) || level < 1) return 0;
    const config = this.levelTable.find((l) => l.level === level);
    if (config) return config.expRequired;
    return Math.floor(100 * Math.pow(1.5, level - 1));
  }

  getExpToNextLevel(characterId: string): number {
    const character = this.getCharacter(characterId);
    if (!character) return 0;
    if (character.level >= this.maxLevel) return 0;
    const required = this.getExpRequiredForLevel(character.level + 1);
    return Math.max(0, required - character.exp);
  }

  addExp(characterId: string, exp: number): { leveledUp: boolean; levelsGained: number } {
    const character = this.getCharacter(characterId);
    if (!character) return { leveledUp: false, levelsGained: 0 };

    if (!this.isValidNumber(exp) || exp <= 0) {
      return { leveledUp: false, levelsGained: 0 };
    }

    if (character.level >= this.maxLevel) return { leveledUp: false, levelsGained: 0 };

    const safeExp = this.sanitizeAmount(exp, 0);
    character.exp += safeExp;
    let levelsGained = 0;

    while (character.level < this.maxLevel) {
      const expRequired = this.getExpRequiredForLevel(character.level + 1);
      if (character.exp < expRequired) break;

      character.exp -= expRequired;
      character.level++;
      levelsGained++;

      const levelConfig = this.levelTable.find((l) => l.level === character.level);
      if (levelConfig?.attributeGains) {
        Object.entries(levelConfig.attributeGains).forEach(([attrId, value]) => {
          this.addAttribute(characterId, attrId, value);
        });
      }

      this.emit('levelUp', {
        characterId,
        level: character.level,
        attributeGains: levelConfig?.attributeGains || {},
      });
    }

    return { leveledUp: levelsGained > 0, levelsGained };
  }

  setLevel(characterId: string, level: number): void {
    const character = this.getCharacter(characterId);
    if (!character) return;

    if (!this.isValidNumber(level)) return;

    character.level = this.sanitizeAmount(level, 1, this.maxLevel);
    character.exp = 0;
  }

  getAffinity(characterId: string): number {
    return this.getCharacter(characterId)?.affinity ?? 0;
  }

  addAffinity(characterId: string, amount: number): number {
    const character = this.getCharacter(characterId);
    if (!character) return 0;

    if (!this.isValidNumber(amount)) {
      return character.affinity;
    }

    const oldValue = character.affinity;
    character.affinity = this.sanitizeAmount(
      character.affinity + amount,
      0,
      character.affinityMax
    );

    if (oldValue !== character.affinity) {
      this.emit('affinityChange', {
        characterId,
        oldValue,
        newValue: character.affinity,
      });
    }

    return character.affinity;
  }

  setAffinity(characterId: string, value: number): number {
    const character = this.getCharacter(characterId);
    if (!character) return 0;

    if (!this.isValidNumber(value)) {
      return character.affinity;
    }

    const oldValue = character.affinity;
    character.affinity = this.sanitizeAmount(value, 0, character.affinityMax);

    if (oldValue !== character.affinity) {
      this.emit('affinityChange', {
        characterId,
        oldValue,
        newValue: character.affinity,
      });
    }

    return character.affinity;
  }

  addSkill(characterId: string, skillId: string): boolean {
    const character = this.getCharacter(characterId);
    if (!character || character.skills.includes(skillId)) return false;
    character.skills.push(skillId);
    return true;
  }

  removeSkill(characterId: string, skillId: string): boolean {
    const character = this.getCharacter(characterId);
    if (!character) return false;
    const index = character.skills.indexOf(skillId);
    if (index === -1) return false;
    character.skills.splice(index, 1);
    return true;
  }

  hasSkill(characterId: string, skillId: string): boolean {
    return this.getCharacter(characterId)?.skills.includes(skillId) ?? false;
  }

  getSkillCooldown(characterId: string, skillId: string): number {
    const character = this.getCharacter(characterId);
    if (!character) return 0;
    return character.skillCooldowns[skillId] ?? 0;
  }

  setSkillCooldown(characterId: string, skillId: string, cooldown: number): boolean {
    const character = this.getCharacter(characterId);
    if (!character) return false;

    const safeCooldown = this.isValidNumber(cooldown)
      ? this.sanitizeAmount(cooldown, 0)
      : 0;

    character.skillCooldowns[skillId] = safeCooldown;
    return true;
  }

  decrementSkillCooldowns(): void {
    this.characters.forEach((character) => {
      Object.keys(character.skillCooldowns).forEach((skillId) => {
        const current = character.skillCooldowns[skillId];
        if (current > 0) {
          character.skillCooldowns[skillId] = current - 1;
        }
      });
    });
  }

  applyRewards(characterId: string, rewards: QuestReward[]): void {
    rewards.forEach((reward) => {
      if (!this.isValidNumber(reward.value)) return;

      switch (reward.type) {
        case 'exp':
          this.addExp(characterId, reward.value);
          break;
        case 'attribute':
          if (reward.attributeId) {
            this.addAttribute(characterId, reward.attributeId, reward.value);
          }
          break;
        case 'affinity':
          this.addAffinity(reward.characterId ?? characterId, reward.value);
          break;
      }
    });
  }

  toJSON(): CharacterData[] {
    return Array.from(this.characters.values());
  }

  fromJSON(data: CharacterData[]): void {
    this.characters.clear();
    data.forEach((char) => {
      this.characters.set(char.id, char);
    });
  }
}

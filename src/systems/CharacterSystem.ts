import {
  CharacterConfig,
  CharacterData,
  LevelConfig,
  AttributeData,
  QuestReward,
} from '../types';
import { EventEmitter } from './EventEmitter';

export class CharacterSystem extends EventEmitter {
  private characters: Map<string, CharacterData> = new Map();
  private levelTable: LevelConfig[] = [];
  private maxLevel: number = 99;

  constructor(
    configs: CharacterConfig[] = [],
    levelTable: LevelConfig[] = [],
    maxLevel: number = 99
  ) {
    super();
    this.levelTable = levelTable;
    this.maxLevel = maxLevel;
    configs.forEach((config) => this.createCharacter(config));
  }

  createCharacter(config: CharacterConfig): CharacterData {
    const attributes: Record<string, number> = {};
    if (config.initialAttributes) {
      config.initialAttributes.forEach((attr: AttributeData) => {
        attributes[attr.id] = attr.value;
      });
    }

    const character: CharacterData = {
      id: config.id,
      name: config.name,
      avatar: config.avatar,
      description: config.description,
      level: config.initialLevel ?? 1,
      exp: config.initialExp ?? 0,
      attributes,
      affinity: config.affinity ?? 0,
      affinityMax: config.affinityMax ?? 100,
      isPlayer: config.isPlayer ?? false,
      skills: [],
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

    const oldValue = character.attributes[attributeId] ?? 0;
    character.attributes[attributeId] = value;

    if (oldValue !== value) {
      this.emit('attributeChange', {
        characterId,
        attributeId,
        oldValue,
        newValue: value,
      });
    }

    return value;
  }

  addAttribute(
    characterId: string,
    attributeId: string,
    amount: number
  ): number {
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
    if (!character || exp <= 0) return { leveledUp: false, levelsGained: 0 };
    if (character.level >= this.maxLevel) return { leveledUp: false, levelsGained: 0 };

    character.exp += exp;
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

    character.level = Math.min(Math.max(1, level), this.maxLevel);
    character.exp = 0;
  }

  getAffinity(characterId: string): number {
    return this.getCharacter(characterId)?.affinity ?? 0;
  }

  addAffinity(characterId: string, amount: number): number {
    const character = this.getCharacter(characterId);
    if (!character) return 0;

    const oldValue = character.affinity;
    character.affinity = Math.min(
      character.affinityMax,
      Math.max(0, character.affinity + amount)
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

    const oldValue = character.affinity;
    character.affinity = Math.min(
      character.affinityMax,
      Math.max(0, value)
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

  applyRewards(characterId: string, rewards: QuestReward[]): void {
    rewards.forEach((reward) => {
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

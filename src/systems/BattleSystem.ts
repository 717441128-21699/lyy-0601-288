import {
  BattleConfig,
  BattleState,
  BattleCharacter,
  BattleAction,
  BattleLogEntry,
  EnemyConfig,
  Buff,
  DialogueEffect,
  SkillConfig,
  QuestReward,
  InventoryItem,
  ItemEffect,
} from '../types';
import { EventEmitter } from './EventEmitter';

export interface BattleContext {
  getCharacterAttribute: (characterId: string, attributeId: string) => number;
  getCharacterMaxHp: (characterId: string) => number;
  getCharacterMaxMp: (characterId: string) => number;
  getCharacterSpeed?: (characterId: string) => number;
  getCharacterSkills?: (characterId: string) => string[];
  getCharacterLevel?: (characterId: string) => number;
  getPlayerCharacterId?: () => string | undefined;
  getSkillConfig?: (skillId: string) => SkillConfig | undefined;
  addExp: (characterId: string, exp: number) => { leveledUp: boolean; levelsGained: number };
  addGold?: (amount: number) => number;
  addItem?: (itemId: string, quantity: number) => boolean;
  hasItem: (itemId: string, quantity?: number) => boolean;
  useItem: (itemId: string, targetCharacterId?: string) => ItemEffect[] | null;
  getInventorySnapshot?: () => InventoryItem[];
  restoreInventory?: (snapshot: InventoryItem[]) => void;
  executeDialogueEffects?: (effects: DialogueEffect[]) => void;
}

const BUFF_OPERATION_ADD = 'add';
const BUFF_OPERATION_SUB = 'sub';
const BUFF_OPERATION_MUL = 'mul';
const BUFF_OPERATION_DIV = 'div';

export class BattleSystem extends EventEmitter {
  private battleConfigs: Map<string, BattleConfig> = new Map();
  private skillConfigs: Map<string, SkillConfig> = new Map();
  private currentBattle: BattleState | null = null;
  private context?: BattleContext;
  private retryCount: Map<string, number> = new Map();
  private enemyTurnTimeout?: any;

  constructor(configs: BattleConfig[] = [], skillConfigs: SkillConfig[] = []) {
    super();
    configs.forEach((config) => this.addBattleConfig(config));
    skillConfigs.forEach((config) => this.addSkillConfig(config));
  }

  setContext(context: BattleContext): void {
    this.context = context;
  }

  addBattleConfig(config: BattleConfig): void {
    this.battleConfigs.set(config.id, config);
  }

  getBattleConfig(id: string): BattleConfig | undefined {
    return this.battleConfigs.get(id);
  }

  getAllBattleConfigs(): BattleConfig[] {
    return Array.from(this.battleConfigs.values());
  }

  addSkillConfig(config: SkillConfig): void {
    this.skillConfigs.set(config.id, config);
  }

  getSkillConfig(id: string): SkillConfig | undefined {
    return this.skillConfigs.get(id) || this.context?.getSkillConfig?.(id);
  }

  getAllSkillConfigs(): SkillConfig[] {
    return Array.from(this.skillConfigs.values());
  }

  getCurrentBattle(): BattleState | null {
    return this.currentBattle;
  }

  private isValidNumber(value: any): value is number {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
  }

  private sanitizeAmount(value: number, min: number = 0, max?: number): number {
    if (!this.isValidNumber(value)) {
      return 0;
    }
    let result = value;
    result = Math.max(min, result);
    if (max !== undefined) {
      result = Math.min(max, result);
    }
    return Math.floor(result);
  }

  private sanitizeOptional(value: number | undefined, defaultValue: number = 0): number {
    if (value === undefined || value === null) return defaultValue;
    return this.sanitizeAmount(value);
  }

  startBattle(battleId: string): BattleState | null {
    const config = this.battleConfigs.get(battleId);
    if (!config || !this.context) return null;

    const characters: BattleCharacter[] = [];

    const playerChars = config.playerCharacters?.length
      ? config.playerCharacters
      : this.context?.getPlayerCharacterId?.()
        ? [this.context.getPlayerCharacterId()!]
        : [];

    playerChars.forEach((charId) => {
      const maxHp = this.sanitizeAmount(this.context!.getCharacterMaxHp(charId), 1);
      const rawMaxMp = this.context!.getCharacterMaxMp(charId);
      const maxMp = this.isValidNumber(rawMaxMp) ? this.sanitizeAmount(rawMaxMp, 0) : undefined;
      const skills = this.context!.getCharacterSkills?.(charId) || [];
      const skillCooldowns: Record<string, number> = {};
      skills.forEach((sid) => {
        skillCooldowns[sid] = 0;
      });

      characters.push({
        characterId: charId,
        isPlayerSide: true,
        currentHp: maxHp,
        maxHp,
        currentMp: maxMp,
        maxMp,
        buffs: [],
        debuffs: [],
        isDefending: false,
        skillCooldowns,
        tookDamageThisTurn: false,
      });
    });

    config.enemies.forEach((enemy) => {
      const maxHp = this.sanitizeAmount(enemy.attributes.hp || enemy.attributes.maxHp || 100, 1);
      const rawMaxMp = enemy.attributes.mp || enemy.attributes.maxMp;
      const maxMp = this.isValidNumber(rawMaxMp) ? this.sanitizeAmount(rawMaxMp, 0) : undefined;
      const skills = enemy.skills || [];
      const skillCooldowns: Record<string, number> = {};
      skills.forEach((sid) => {
        skillCooldowns[sid] = 0;
      });

      characters.push({
        characterId: enemy.id,
        isPlayerSide: false,
        currentHp: maxHp,
        maxHp,
        currentMp: maxMp,
        maxMp,
        buffs: [],
        debuffs: [],
        isDefending: false,
        skillCooldowns,
        tookDamageThisTurn: false,
      });
    });

    const originalState = {
      characters: characters.map((c) => ({
        hp: c.currentHp,
        mp: c.currentMp,
      })),
      inventory: this.context.getInventorySnapshot?.() || [],
    };

    this.currentBattle = {
      id: battleId,
      turn: 1,
      phase: 'start',
      characters,
      actionLog: [],
      turnQueue: [],
      turnQueueIndex: 0,
      awardedRewards: false,
      originalState,
    };

    const turnQueue = this.buildTurnQueue(characters);
    this.currentBattle.turnQueue = turnQueue;

    this.emit('battleStart', {
      battleId,
      battle: this.currentBattle,
    });

    this.startTurnPhase();

    return this.currentBattle;
  }

  private getCharacterSpeed(char: BattleCharacter): number {
    let base = 10;
    if (char.isPlayerSide && this.context) {
      const fromCtx = this.context.getCharacterSpeed?.(char.characterId);
      if (this.isValidNumber(fromCtx)) base = this.sanitizeAmount(fromCtx, 0);
      else {
        const fromAttr = this.context.getCharacterAttribute(char.characterId, 'speed');
        if (this.isValidNumber(fromAttr)) base = this.sanitizeAmount(fromAttr, 0);
      }
    } else {
      const enemyConfig = this.getEnemyConfig(char.characterId);
      const fromEnemy = enemyConfig?.attributes.speed;
      if (this.isValidNumber(fromEnemy)) base = this.sanitizeAmount(fromEnemy, 0);
    }
    const mod = this.getBuffAttributeModifier(char, 'speed');
    return this.sanitizeAmount(base + mod, 0);
  }

  private getBuffAttributeModifier(char: BattleCharacter, attributeId: string): number {
    let modifier = 0;
    for (const buff of char.buffs) {
      if (buff.attributeId === attributeId) {
        modifier += buff.value;
      }
    }
    for (const debuff of char.debuffs) {
      if (debuff.attributeId === attributeId) {
        modifier -= debuff.value;
      }
    }
    return modifier;
  }

  private buildTurnQueue(characters: BattleCharacter[]): string[] {
    const alive = characters.filter((c) => c.currentHp > 0);
    alive.sort((a, b) => {
      const speedA = this.getCharacterSpeed(a);
      const speedB = this.getCharacterSpeed(b);
      return speedB - speedA;
    });
    return alive.map((c) => c.characterId);
  }

  private rebuildTurnQueue(): void {
    if (!this.currentBattle) return;
    this.currentBattle.turnQueue = this.buildTurnQueue(this.currentBattle.characters);
    this.currentBattle.turnQueueIndex = 0;
  }

  private startTurnPhase(): void {
    if (!this.currentBattle) return;

    this.processTurnStartStatusEffects();

    if (this.checkBattleEnd()) return;

    this.rebuildTurnQueue();

    if (this.currentBattle.turnQueue.length === 0) {
      this.checkBattleEnd();
      return;
    }

    this.advanceToNextActor();
  }

  private advanceToNextActor(): void {
    if (!this.currentBattle) return;

    while (this.currentBattle.turnQueueIndex < this.currentBattle.turnQueue.length) {
      const actorId = this.currentBattle.turnQueue[this.currentBattle.turnQueueIndex];
      const actor = this.currentBattle.characters.find((c) => c.characterId === actorId);

      if (!actor || actor.currentHp <= 0) {
        this.currentBattle.turnQueueIndex++;
        continue;
      }

      this.currentBattle.currentTurnCharacterId = actorId;
      this.currentBattle.phase = actor.isPlayerSide ? 'playerTurn' : 'enemyTurn';

      actor.tookDamageThisTurn = false;
      actor.isDefending = false;

      this.emit('battleTurn', {
        battleId: this.currentBattle.id,
        turn: this.currentBattle.turn,
        phase: this.currentBattle.phase,
        currentCharacterId: actorId,
      });

      if (!actor.isPlayerSide) {
        this.enemyTurnTimeout = setTimeout(() => this.executeEnemyTurn(), 500);
      }
      return;
    }

    this.endRoundPhase();
  }

  private endRoundPhase(): void {
    if (!this.currentBattle) return;

    this.processTurnEndStatusEffects();
    this.processCooldownsAndBuffDurations();

    if (this.checkBattleEnd()) return;

    this.currentBattle.turn++;
    this.startTurnPhase();
  }

  private processTurnStartStatusEffects(): void {
    if (!this.currentBattle) return;

    this.currentBattle.characters.forEach((char) => {
      if (char.currentHp <= 0) return;

      const allEffects = [...char.buffs, ...char.debuffs];
      allEffects.forEach((buff) => {
        if (buff.attributeId && this.isValidNumber(buff.value)) {
          this.applyBuffAttributeEffect(char, buff);
        }
      });
    });
  }

  private applyBuffAttributeEffect(char: BattleCharacter, buff: Buff): void {
    if (!buff.attributeId || !this.isValidNumber(buff.value)) return;

    const operation = this.detectBuffOperation(buff);

    if (buff.attributeId === 'hp' || buff.attributeId === 'maxHp') {
      return;
    }
    if (buff.attributeId === 'mp' || buff.attributeId === 'maxMp') {
      return;
    }
  }

  private detectBuffOperation(buff: Buff): string {
    const id = buff.id.toLowerCase();
    if (id.includes('mul') || id.includes('percent') || id.includes('%')) {
      return BUFF_OPERATION_MUL;
    }
    if (id.includes('div')) {
      return BUFF_OPERATION_DIV;
    }
    return BUFF_OPERATION_ADD;
  }

  private processTurnEndStatusEffects(): void {
    if (!this.currentBattle) return;

    this.currentBattle.characters.forEach((char) => {
      if (char.currentHp <= 0) return;

      const allEffects = [...char.buffs, ...char.debuffs];
      allEffects.forEach((buff) => {
        if (this.isValidNumber(buff.tickDamage) && buff.tickDamage !== 0) {
          const tick = this.sanitizeAmount(Math.abs(buff.tickDamage!));
          if (buff.type === 'debuff') {
            const oldHp = char.currentHp;
            char.currentHp = this.sanitizeAmount(char.currentHp - tick, 0, char.maxHp);
            if (oldHp !== char.currentHp && buff.onTickMessage) {
              this.pushLog(
                this.createLogEntry(
                  char.characterId,
                  'dot',
                  char.characterId,
                  tick,
                  buff.onTickMessage.replace('{value}', String(tick))
                )
              );
            } else if (oldHp !== char.currentHp) {
              this.pushLog(
                this.createLogEntry(
                  char.characterId,
                  'dot',
                  char.characterId,
                  tick,
                  `${char.characterId} 受到 ${tick} 点持续伤害`
                )
              );
            }
          } else {
            const oldHp = char.currentHp;
            char.currentHp = this.sanitizeAmount(char.currentHp + tick, 0, char.maxHp);
            if (oldHp !== char.currentHp && buff.onTickMessage) {
              this.pushLog(
                this.createLogEntry(
                  char.characterId,
                  'hot',
                  char.characterId,
                  undefined,
                  buff.onTickMessage.replace('{value}', String(tick)),
                  tick
                )
              );
            } else if (oldHp !== char.currentHp) {
              this.pushLog(
                this.createLogEntry(
                  char.characterId,
                  'hot',
                  char.characterId,
                  undefined,
                  `${char.characterId} 恢复了 ${tick} 点生命`,
                  tick
                )
              );
            }
          }
        }
      });
    });
  }

  private processCooldownsAndBuffDurations(): void {
    if (!this.currentBattle) return;

    this.currentBattle.characters.forEach((char) => {
      Object.keys(char.skillCooldowns).forEach((skillId) => {
        if (char.skillCooldowns[skillId] > 0) {
          char.skillCooldowns[skillId] = this.sanitizeAmount(char.skillCooldowns[skillId] - 1, 0);
        }
      });

      char.buffs = char.buffs.filter((buff) => {
        buff.remainingTurns = this.sanitizeAmount(buff.remainingTurns - 1, 0);
        return buff.remainingTurns > 0;
      });

      char.debuffs = char.debuffs.filter((debuff) => {
        debuff.remainingTurns = this.sanitizeAmount(debuff.remainingTurns - 1, 0);
        return debuff.remainingTurns > 0;
      });
    });
  }

  getCurrentActor(): BattleCharacter | undefined {
    if (!this.currentBattle || !this.currentBattle.currentTurnCharacterId) return undefined;
    return this.currentBattle.characters.find(
      (c) => c.characterId === this.currentBattle!.currentTurnCharacterId
    );
  }

  canUseSkill(characterId: string, skillId: string): { canUse: boolean; reason?: string } {
    const char = this.currentBattle?.characters.find((c) => c.characterId === characterId);
    if (!char) return { canUse: false, reason: 'character_not_found' };

    const skill = this.getSkillConfig(skillId);
    if (!skill) return { canUse: false, reason: 'skill_not_found' };

    const requiredLevel = this.sanitizeOptional(skill.requiredLevel, 0);
    if (requiredLevel > 0 && this.context) {
      const charLevel = this.context.getCharacterLevel?.(characterId) || 1;
      if (charLevel < requiredLevel) {
        return { canUse: false, reason: 'level_insufficient' };
      }
    }

    const mpCost = this.sanitizeOptional(skill.mpCost, 0);
    if (mpCost > 0) {
      const currentMp = this.sanitizeOptional(char.currentMp, 0);
      if (currentMp < mpCost) {
        return { canUse: false, reason: 'mp_insufficient' };
      }
    }

    const cooldown = char.skillCooldowns[skillId] || 0;
    if (cooldown > 0) {
      return { canUse: false, reason: 'cooldown_active' };
    }

    return { canUse: true };
  }

  executeAction(action: BattleAction): BattleLogEntry | null {
    if (!this.currentBattle) return null;

    const validPhases: string[] = ['playerTurn'];
    if (!validPhases.includes(this.currentBattle.phase)) {
      return null;
    }

    const actor = this.getCurrentActor();
    if (!actor || !actor.isPlayerSide) return null;

    let logEntry: BattleLogEntry | null = null;

    switch (action.type) {
      case 'attack':
        logEntry = this.performAttack(actor, action.targetId);
        break;
      case 'defend':
        logEntry = this.performDefend(actor);
        break;
      case 'item':
        if (action.itemId) {
          logEntry = this.performItem(actor, action.itemId, action.targetId);
        }
        break;
      case 'flee':
        logEntry = this.performFlee(actor);
        if (logEntry) {
          const fledMsg = logEntry.message;
          if (fledMsg && fledMsg.includes('成功')) {
            this.endBattle('fled');
            return logEntry;
          }
        }
        break;
      case 'skill':
        if (action.skillId) {
          logEntry = this.performSkill(actor, action.skillId, action.targetId);
        }
        break;
    }

    if (logEntry) {
      this.pushLog(logEntry);
    }

    if (this.checkBattleEnd()) {
      return logEntry;
    }

    this.currentBattle!.turnQueueIndex++;
    this.advanceToNextActor();

    return logEntry;
  }

  executeEnemyAction(action: BattleAction): BattleLogEntry | null {
    if (!this.currentBattle) return null;

    const validPhases: string[] = ['enemyTurn'];
    if (!validPhases.includes(this.currentBattle.phase)) {
      return null;
    }

    const actor = this.getCurrentActor();
    if (!actor || actor.isPlayerSide || actor.currentHp <= 0) return null;

    if (this.enemyTurnTimeout) {
      clearTimeout(this.enemyTurnTimeout);
      this.enemyTurnTimeout = undefined;
    }

    let logEntry: BattleLogEntry | null = null;

    switch (action.type) {
      case 'attack':
        logEntry = this.performAttack(actor, action.targetId);
        break;
      case 'skill':
        if (action.skillId) {
          logEntry = this.performSkill(actor, action.skillId, action.targetId);
        }
        break;
      case 'defend':
        logEntry = this.performDefend(actor);
        break;
    }

    if (logEntry) {
      this.pushLog(logEntry);
      this.emit('battleEnemyAction', {
        battleId: this.currentBattle!.id,
        logEntry,
      });
    }

    if (this.checkBattleEnd()) return logEntry;

    this.currentBattle!.turnQueueIndex++;
    this.advanceToNextActor();

    return logEntry;
  }

  private pushLog(entry: BattleLogEntry): void {
    if (!this.currentBattle) return;
    this.currentBattle.actionLog.push(entry);
  }

  private performAttack(
    actor: BattleCharacter,
    targetId?: string
  ): BattleLogEntry {
    const target = this.findTarget(targetId, !actor.isPlayerSide);
    if (!target) {
      return this.createLogEntry(actor.characterId, 'attack', targetId, 0, '目标不存在');
    }

    const attackPower = this.getCharacterAttackPower(actor);
    const defensePower = this.getCharacterDefensePower(target);

    let damage = Math.max(1, attackPower - defensePower * 0.5);
    damage = Math.floor(damage * (0.9 + Math.random() * 0.2));
    damage = this.sanitizeAmount(damage, 1);

    if (target.isDefending) {
      damage = this.sanitizeAmount(Math.floor(damage * 0.5), 1);
    }

    const oldHp = target.currentHp;
    target.currentHp = this.sanitizeAmount(target.currentHp - damage, 0, target.maxHp);
    target.tookDamageThisTurn = oldHp !== target.currentHp;

    return this.createLogEntry(
      actor.characterId,
      'attack',
      target.characterId,
      damage,
      `${actor.characterId} 对 ${target.characterId} 造成了 ${damage} 点伤害`
    );
  }

  private performDefend(actor: BattleCharacter): BattleLogEntry {
    actor.isDefending = true;

    return this.createLogEntry(
      actor.characterId,
      'defend',
      undefined,
      undefined,
      `${actor.characterId} 进入防御姿态，受到的伤害减半`
    );
  }

  private performItem(
    actor: BattleCharacter,
    itemId: string,
    targetId?: string
  ): BattleLogEntry | null {
    if (!this.context?.hasItem(itemId)) {
      return this.createLogEntry(actor.characterId, 'item', undefined, 0, '没有该道具');
    }

    const effects = this.context.useItem(itemId, targetId);

    if (targetId) {
      const target = this.findTarget(targetId);
      if (target && effects) {
        effects.forEach((effect: ItemEffect) => {
          if (effect.type === 'heal') {
            const healAmount = this.sanitizeAmount(effect.value, 0);
            target.currentHp = this.sanitizeAmount(target.currentHp + healAmount, 0, target.maxHp);
          } else if (effect.type === 'mpRestore') {
            const mpAmount = this.sanitizeAmount(effect.value, 0);
            if (target.maxMp !== undefined && target.currentMp !== undefined) {
              target.currentMp = this.sanitizeAmount(target.currentMp + mpAmount, 0, target.maxMp);
            }
          } else if (effect.type === 'buff' || effect.type === 'debuff') {
            const duration = this.sanitizeOptional(effect.duration, 3);
            const buff: Buff = {
              id: `${itemId}_${effect.type}_${Date.now()}`,
              name: itemId,
              type: effect.type,
              attributeId: effect.attributeId,
              value: this.sanitizeAmount(effect.value, 0),
              duration,
              remainingTurns: duration,
              onTickMessage: undefined,
            };
            this.addBuffToCharacter(target, buff);
          }
        });
      }
    }

    return this.createLogEntry(
      actor.characterId,
      'item',
      targetId,
      undefined,
      `${actor.characterId} 使用了 ${itemId}`,
      undefined,
      undefined,
      undefined,
      itemId
    );
  }

  private performFlee(actor: BattleCharacter): BattleLogEntry | null {
    const config = this.battleConfigs.get(this.currentBattle!.id);
    if (!config?.allowFlee) {
      return this.createLogEntry(actor.characterId, 'flee', undefined, 0, '无法逃跑', undefined, undefined, undefined, undefined, undefined, false);
    }

    const success = Math.random() > 0.3;

    if (success) {
      return this.createLogEntry(actor.characterId, 'flee', undefined, 0, '成功逃跑');
    }

    return this.createLogEntry(actor.characterId, 'flee', undefined, 0, '逃跑失败', undefined, undefined, undefined, undefined, undefined, false);
  }

  private performSkill(
    actor: BattleCharacter,
    skillId: string,
    targetId?: string
  ): BattleLogEntry | null {
    const check = this.canUseSkill(actor.characterId, skillId);
    if (!check.canUse) {
      const reasonMap: Record<string, string> = {
        character_not_found: '角色不存在',
        skill_not_found: '技能不存在',
        level_insufficient: '等级不足',
        mp_insufficient: 'MP不足',
        cooldown_active: '技能冷却中',
      };
      return this.createLogEntry(
        actor.characterId,
        'skill',
        targetId,
        0,
        `无法使用技能：${reasonMap[check.reason || 'unknown'] || '未知原因'}`,
        undefined,
        undefined,
        undefined,
        undefined,
        skillId,
        false
      );
    }

    const skill = this.getSkillConfig(skillId)!;
    const mpCost = this.sanitizeOptional(skill.mpCost, 0);
    const cooldown = this.sanitizeOptional(skill.cooldown, 0);

    if (mpCost > 0 && actor.currentMp !== undefined && actor.maxMp !== undefined) {
      actor.currentMp = this.sanitizeAmount(actor.currentMp - mpCost, 0, actor.maxMp);
    }

    if (cooldown > 0) {
      actor.skillCooldowns[skillId] = cooldown;
    }

    const targets = this.resolveSkillTargets(actor, skill, targetId);

    let totalDamage = 0;
    let totalHeal = 0;
    const targetMessages: string[] = [];

    targets.forEach((target) => {
      const result = this.applySkillToTarget(actor, target, skill);
      if (result.damage) {
        totalDamage += result.damage;
        targetMessages.push(`${target.characterId} 受到 ${result.damage} 点伤害`);
      }
      if (result.heal) {
        totalHeal += result.heal;
        targetMessages.push(`${target.characterId} 恢复 ${result.heal} 点生命`);
      }
    });

    this.emit('battleSkillUsed', {
      battleId: this.currentBattle!.id,
      actorId: actor.characterId,
      skillId,
      skill,
      targets: targets.map((t) => t.characterId),
      totalDamage,
      totalHeal,
    });

    const baseMessage = `${actor.characterId} 使用了 ${skill.name}${mpCost > 0 ? ` (消耗 ${mpCost} MP)` : ''}`;
    const effectMessage = targetMessages.length > 0 ? `，${targetMessages.join('，')}` : '';

    return this.createLogEntry(
      actor.characterId,
      'skill',
      targets.length === 1 ? targets[0].characterId : undefined,
      totalDamage > 0 ? totalDamage : undefined,
      baseMessage + effectMessage,
      totalHeal > 0 ? totalHeal : undefined,
      undefined,
      undefined,
      undefined,
      skillId
    );
  }

  private resolveSkillTargets(
    actor: BattleCharacter,
    skill: SkillConfig,
    explicitTargetId?: string
  ): BattleCharacter[] {
    if (!this.currentBattle) return [];

    const alive = this.currentBattle.characters.filter((c) => c.currentHp > 0);

    switch (skill.targetType) {
      case 'self':
        return [actor];
      case 'single':
        const single = explicitTargetId
          ? alive.find((c) => c.characterId === explicitTargetId)
          : this.findTarget(undefined, !actor.isPlayerSide);
        return single ? [single] : [];
      case 'single_enemy':
        const singleEnemy = explicitTargetId
          ? alive.find((c) => c.characterId === explicitTargetId && c.isPlayerSide !== actor.isPlayerSide)
          : this.findTarget(undefined, !actor.isPlayerSide);
        return singleEnemy ? [singleEnemy] : [];
      case 'single_ally':
        const singleAlly = explicitTargetId
          ? alive.find((c) => c.characterId === explicitTargetId && c.isPlayerSide === actor.isPlayerSide)
          : this.findTarget(undefined, actor.isPlayerSide);
        return singleAlly ? [singleAlly] : [];
      case 'all_enemies':
        return alive.filter((c) => c.isPlayerSide !== actor.isPlayerSide);
      case 'all_allies':
        return alive.filter((c) => c.isPlayerSide === actor.isPlayerSide);
      default:
        return [];
    }
  }

  private applySkillToTarget(
    actor: BattleCharacter,
    target: BattleCharacter,
    skill: SkillConfig
  ): { damage: number; heal: number } {
    let damage = 0;
    let heal = 0;

    const multiplier = this.sanitizeOptional(skill.damageMultiplier, 0);
    if (multiplier > 0) {
      const attackPower = this.getCharacterAttackPower(actor);
      const defensePower = this.getCharacterDefensePower(target);
      let rawDamage = Math.max(1, attackPower * multiplier - defensePower * 0.5);
      rawDamage = Math.floor(rawDamage * (0.9 + Math.random() * 0.2));
      rawDamage = this.sanitizeAmount(rawDamage, 1);

      if (target.isDefending) {
        rawDamage = this.sanitizeAmount(Math.floor(rawDamage * 0.5), 1);
      }

      const oldHp = target.currentHp;
      target.currentHp = this.sanitizeAmount(target.currentHp - rawDamage, 0, target.maxHp);
      target.tookDamageThisTurn = oldHp !== target.currentHp;
      damage = rawDamage;
    }

    const healAmount = this.sanitizeOptional(skill.healAmount, 0);
    if (healAmount > 0) {
      const oldHp = target.currentHp;
      target.currentHp = this.sanitizeAmount(target.currentHp + healAmount, 0, target.maxHp);
      heal = target.currentHp - oldHp;
    }

    if (skill.effects && skill.effects.length > 0) {
      skill.effects.forEach((effect) => {
        this.applyItemEffectToTarget(target, effect);
      });
    }

    return { damage, heal };
  }

  private applyItemEffectToTarget(target: BattleCharacter, effect: ItemEffect): void {
    if (effect.type === 'heal') {
      const amt = this.sanitizeAmount(effect.value, 0);
      target.currentHp = this.sanitizeAmount(target.currentHp + amt, 0, target.maxHp);
    } else if (effect.type === 'damage') {
      const dmg = this.sanitizeAmount(effect.value, 1);
      target.currentHp = this.sanitizeAmount(target.currentHp - dmg, 0, target.maxHp);
      target.tookDamageThisTurn = true;
    } else if (effect.type === 'mpRestore') {
      if (target.currentMp !== undefined && target.maxMp !== undefined) {
        const amt = this.sanitizeAmount(effect.value, 0);
        target.currentMp = this.sanitizeAmount(target.currentMp + amt, 0, target.maxMp);
      }
    } else if (effect.type === 'buff' || effect.type === 'debuff') {
      const duration = this.sanitizeOptional(effect.duration, 3);
      let firstAttrKey: string | undefined;
      let firstAttrValue: number = 0;
      if (effect.attributes) {
        const keys = Object.keys(effect.attributes);
        if (keys.length > 0) {
          firstAttrKey = keys[0];
          firstAttrValue = this.sanitizeAmount(effect.attributes[firstAttrKey], 0);
        }
      }
      const valueFromAttrId = this.isValidNumber(effect.value) ? Math.abs(effect.value) : firstAttrValue;
      const rawDotDamage = this.isValidNumber(effect.dotDamage)
        ? effect.dotDamage
        : this.isValidNumber(effect.tickDamage)
          ? effect.tickDamage
          : undefined;
      const buff: Buff = {
        id: effect.id || `effect_${effect.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: effect.name || effect.attributeId || effect.type,
        type: effect.type,
        attributeId: effect.attributeId || firstAttrKey,
        value: this.sanitizeAmount(valueFromAttrId, 0),
        duration,
        remainingTurns: duration,
        tickDamage: effect.type === 'debuff' && this.isValidNumber(rawDotDamage) ? -Math.abs(rawDotDamage as number) : undefined,
        onTickMessage: undefined,
      };
      this.addBuffToCharacter(target, buff);
    }
  }

  private addBuffToCharacter(char: BattleCharacter, buff: Buff): void {
    if (buff.type === 'buff') {
      char.buffs.push(buff);
    } else {
      char.debuffs.push(buff);
    }
  }

  private executeEnemyTurn(): void {
    if (!this.currentBattle || this.currentBattle.phase !== 'enemyTurn') return;

    const actor = this.getCurrentActor();
    if (!actor || actor.isPlayerSide || actor.currentHp <= 0) {
      this.currentBattle!.turnQueueIndex++;
      this.advanceToNextActor();
      return;
    }

    const action = this.decideEnemyAction(actor);
    let logEntry: BattleLogEntry | null = null;

    switch (action.type) {
      case 'attack':
        logEntry = this.performAttack(actor, action.targetId);
        break;
      case 'skill':
        if (action.skillId) {
          logEntry = this.performSkill(actor, action.skillId, action.targetId);
        }
        break;
      case 'defend':
        logEntry = this.performDefend(actor);
        break;
    }

    if (logEntry) {
      this.pushLog(logEntry);
      this.emit('battleEnemyAction', {
        battleId: this.currentBattle!.id,
        logEntry,
      });
    }

    if (this.checkBattleEnd()) return;

    this.currentBattle!.turnQueueIndex++;
    this.enemyTurnTimeout = setTimeout(() => this.advanceToNextActor(), 400);
  }

  private decideEnemyAction(actor: BattleCharacter): BattleAction {
    const enemyConfig = this.getEnemyConfig(actor.characterId);
    const behavior = enemyConfig?.behavior || 'aggressive';
    const skills = enemyConfig?.skills || [];

    const playerChars = this.currentBattle!.characters.filter(
      (c) => c.isPlayerSide && c.currentHp > 0
    );
    if (playerChars.length === 0) {
      return { type: 'attack' };
    }

    const target = playerChars[Math.floor(Math.random() * playerChars.length)];

    const availableSkills = skills.filter((sid) => {
      const check = this.canUseSkill(actor.characterId, sid);
      return check.canUse;
    });

    if (availableSkills.length > 0) {
      let useSkillChance = 0.3;
      if (behavior === 'aggressive') useSkillChance = 0.5;
      if (behavior === 'defensive') useSkillChance = 0.2;
      if (behavior === 'support') useSkillChance = 0.6;

      if (Math.random() < useSkillChance) {
        const chosenSkill = availableSkills[Math.floor(Math.random() * availableSkills.length)];
        return {
          type: 'skill',
          skillId: chosenSkill,
          targetId: target.characterId,
        };
      }
    }

    if (behavior === 'defensive' && actor.currentHp < actor.maxHp * 0.3 && Math.random() < 0.4) {
      return { type: 'defend' };
    }

    return {
      type: 'attack',
      targetId: target.characterId,
    };
  }

  private findTarget(
    targetId?: string,
    isEnemySide?: boolean
  ): BattleCharacter | undefined {
    if (!this.currentBattle) return undefined;

    if (targetId) {
      return this.currentBattle.characters.find((c) => c.characterId === targetId);
    }

    const targets = this.currentBattle.characters.filter((c) => {
      if (c.currentHp <= 0) return false;
      if (isEnemySide !== undefined && c.isPlayerSide === isEnemySide) return false;
      return true;
    });

    if (!targets.length) return undefined;

    return targets[Math.floor(Math.random() * targets.length)];
  }

  private getCharacterAttackPower(char: BattleCharacter): number {
    let base = 10;
    if (char.isPlayerSide && this.context) {
      const val = this.context.getCharacterAttribute(char.characterId, 'attack');
      if (this.isValidNumber(val)) base = this.sanitizeAmount(val, 0);
    } else {
      const enemyConfig = this.getEnemyConfig(char.characterId);
      const val = enemyConfig?.attributes.attack;
      if (this.isValidNumber(val)) base = this.sanitizeAmount(val, 0);
    }
    const mod = this.getBuffAttributeModifier(char, 'attack');
    return this.sanitizeAmount(base + mod, 0);
  }

  private getCharacterDefensePower(char: BattleCharacter): number {
    let base = 5;
    if (char.isPlayerSide && this.context) {
      const val = this.context.getCharacterAttribute(char.characterId, 'defense');
      if (this.isValidNumber(val)) base = this.sanitizeAmount(val, 0);
    } else {
      const enemyConfig = this.getEnemyConfig(char.characterId);
      const val = enemyConfig?.attributes.defense;
      if (this.isValidNumber(val)) base = this.sanitizeAmount(val, 0);
    }
    const mod = this.getBuffAttributeModifier(char, 'defense');
    return this.sanitizeAmount(base + mod, 0);
  }

  private getEnemyConfig(enemyId: string, battleId?: string): EnemyConfig | undefined {
    const bid = battleId ?? this.currentBattle?.id;
    if (!bid) return undefined;
    const config = this.battleConfigs.get(bid);
    return config?.enemies.find((e) => e.id === enemyId);
  }

  private createLogEntry(
    actorId: string,
    action: string,
    targetId?: string,
    damage?: number,
    message?: string,
    heal?: number,
    critical?: boolean,
    missed?: boolean,
    itemId?: string,
    skillId?: string,
    success?: boolean
  ): BattleLogEntry {
    const safeDamage = damage !== undefined ? this.sanitizeAmount(damage, 0) : undefined;
    const safeHeal = heal !== undefined ? this.sanitizeAmount(heal, 0) : undefined;

    return {
      turn: this.currentBattle!.turn,
      actorId,
      action,
      targetId,
      damage: safeDamage,
      heal: safeHeal,
      message: message || `${actorId} 使用了 ${action}`,
      timestamp: Date.now(),
      critical,
      missed,
      skillId,
      itemId,
      success: success !== false,
    };
  }

  private checkBattleEnd(): boolean {
    if (!this.currentBattle) return false;

    const playerChars = this.currentBattle.characters.filter((c) => c.isPlayerSide);
    const enemyChars = this.currentBattle.characters.filter((c) => !c.isPlayerSide);

    const allPlayersDead = playerChars.every((c) => c.currentHp <= 0);
    const allEnemiesDead = enemyChars.every((c) => c.currentHp <= 0);

    if (allEnemiesDead) {
      this.endBattle('victory');
      return true;
    }

    if (allPlayersDead) {
      this.endBattle('defeat');
      return true;
    }

    return false;
  }

  private endBattle(result: 'victory' | 'defeat' | 'fled'): void {
    if (!this.currentBattle) return;

    this.currentBattle.phase = result;
    const config = this.battleConfigs.get(this.currentBattle.id);

    if (result === 'victory' && !this.currentBattle.awardedRewards) {
      this.currentBattle.awardedRewards = true;
      this.awardVictoryRewards(config);
      this.executeBattleEffects(config?.onVictory || []);
      this.emit('battleVictory', {
        battleId: this.currentBattle.id,
        battle: this.currentBattle,
        rewards: config?.victoryRewards || [],
        effects: config?.onVictory || [],
      });
    } else if (result === 'defeat') {
      this.executeBattleEffects(config?.onDefeat || []);
      if (config?.retryable) {
        const count = (this.retryCount.get(this.currentBattle.id) || 0) + 1;
        this.retryCount.set(this.currentBattle.id, count);
      }
      this.emit('battleDefeat', {
        battleId: this.currentBattle.id,
        battle: this.currentBattle,
        effects: config?.onDefeat || [],
        retryable: config?.retryable ?? false,
      });
    } else if (result === 'fled') {
      this.executeBattleEffects(config?.onFlee || []);
      this.emit('battleFled', {
        battleId: this.currentBattle.id,
        battle: this.currentBattle,
        effects: config?.onFlee || [],
      });
    }

    this.emit('battleEnd', {
      battleId: this.currentBattle.id,
      result,
      battle: this.currentBattle,
    });
  }

  private awardVictoryRewards(config: BattleConfig | undefined): void {
    if (!this.currentBattle || !this.context) return;

    const playerChars = this.currentBattle.characters.filter((c) => c.isPlayerSide);
    if (playerChars.length === 0) return;

    config?.enemies.forEach((enemy) => {
      const exp = this.sanitizeOptional(enemy.expReward, 0);
      const gold = this.sanitizeOptional(enemy.goldReward, 0);

      if (exp > 0) {
        playerChars.forEach((pc) => {
          this.context!.addExp(pc.characterId, exp);
        });
      }

      if (gold > 0 && this.context?.addGold) {
        this.context.addGold(gold);
      }

      if (enemy.loot && enemy.loot.length > 0) {
        enemy.loot.forEach((loot) => {
          if (Math.random() <= loot.chance) {
            const minQty = this.sanitizeOptional(loot.minQuantity, 1);
            const maxQty = this.sanitizeOptional(loot.maxQuantity, minQty);
            const qty = minQty === maxQty ? minQty : minQty + Math.floor(Math.random() * (maxQty - minQty + 1));
            if (qty > 0) {
              this.context!.addItem?.(loot.itemId, qty);
            }
          }
        });
      }
    });

    const rewards = config?.victoryRewards || [];
    rewards.forEach((reward) => {
      this.applyQuestReward(reward, playerChars);
    });
  }

  private applyQuestReward(reward: QuestReward, playerChars: BattleCharacter[]): void {
    if (!this.context) return;
    const value = this.sanitizeAmount(reward.value, 0);

    switch (reward.type) {
      case 'exp':
        if (value > 0) {
          playerChars.forEach((pc) => {
            this.context!.addExp(pc.characterId, value);
          });
        }
        break;
      case 'gold':
        if (value > 0) {
          this.context.addGold?.(value);
        }
        break;
      case 'item':
        if (reward.itemId) {
          const qty = this.sanitizeOptional(reward.quantity, 1);
          if (qty > 0) {
            this.context.addItem?.(reward.itemId, qty);
          }
        }
        break;
      case 'attribute':
        break;
      case 'affinity':
        break;
    }
  }

  private executeBattleEffects(effects: DialogueEffect[]): void {
    if (effects.length === 0) return;
    this.context?.executeDialogueEffects?.(effects);
  }

  retryBattle(): BattleState | null {
    if (!this.currentBattle) return null;

    const config = this.battleConfigs.get(this.currentBattle.id);
    if (!config?.retryable) return null;

    const battleId = this.currentBattle.id;
    const originalState = this.currentBattle.originalState;

    if (originalState) {
      this.context?.restoreInventory?.(originalState.inventory);
    }

    this.currentBattle = null;

    const result = this.startBattle(battleId);

    if (result && originalState) {
      result.characters.forEach((char, idx) => {
        const orig = originalState.characters[idx];
        if (orig) {
          char.currentHp = this.sanitizeAmount(orig.hp, 0, char.maxHp);
          if (orig.mp !== undefined && char.maxMp !== undefined && char.currentMp !== undefined) {
            char.currentMp = this.sanitizeAmount(orig.mp, 0, char.maxMp);
          }
        }
      });
    }

    this.emit('battleRetry', {
      battleId,
      battle: result,
      retryCount: this.retryCount.get(battleId) || 0,
    });

    return result;
  }

  canRetry(): boolean {
    if (!this.currentBattle) return false;
    const config = this.battleConfigs.get(this.currentBattle.id);
    return config?.retryable ?? false;
  }

  getRetryCount(battleId: string): number {
    return this.retryCount.get(battleId) || 0;
  }

  getPlayerCharacters(): BattleCharacter[] {
    return this.currentBattle?.characters.filter((c) => c.isPlayerSide) || [];
  }

  getEnemyCharacters(): BattleCharacter[] {
    return this.currentBattle?.characters.filter((c) => !c.isPlayerSide) || [];
  }

  addBuff(
    characterId: string,
    buff: Omit<Buff, 'remainingTurns'>
  ): boolean {
    if (!this.currentBattle) return false;

    const char = this.currentBattle.characters.find(
      (c) => c.characterId === characterId
    );

    if (!char) return false;

    const safeBuff: Buff = {
      ...buff,
      value: this.isValidNumber(buff.value) ? buff.value : 0,
      duration: this.sanitizeOptional(buff.duration, 1),
      remainingTurns: this.sanitizeOptional(buff.duration, 1),
    };

    this.addBuffToCharacter(char, safeBuff);
    return true;
  }

  removeBuff(characterId: string, buffId: string): boolean {
    if (!this.currentBattle) return false;

    const char = this.currentBattle.characters.find(
      (c) => c.characterId === characterId
    );

    if (!char) return false;

    const buffIndex = char.buffs.findIndex((b) => b.id === buffId);
    if (buffIndex !== -1) {
      char.buffs.splice(buffIndex, 1);
      return true;
    }

    const debuffIndex = char.debuffs.findIndex((b) => b.id === buffId);
    if (debuffIndex !== -1) {
      char.debuffs.splice(debuffIndex, 1);
      return true;
    }

    return false;
  }

  getCharacterBuffs(characterId: string): { buffs: Buff[]; debuffs: Buff[] } | null {
    const char = this.currentBattle?.characters.find((c) => c.characterId === characterId);
    if (!char) return null;
    return { buffs: [...char.buffs], debuffs: [...char.debuffs] };
  }

  toJSON(): BattleState | null {
    return this.currentBattle;
  }

  fromJSON(data: BattleState): void {
    this.currentBattle = data;
  }
}

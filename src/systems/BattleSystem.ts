import {
  BattleConfig,
  BattleState,
  BattleCharacter,
  BattleAction,
  BattleLogEntry,
  EnemyConfig,
  Buff,
  DialogueEffect,
} from '../types';
import { EventEmitter } from './EventEmitter';

export interface BattleContext {
  getCharacterAttribute: (characterId: string, attributeId: string) => number;
  getCharacterMaxHp: (characterId: string) => number;
  getCharacterMaxMp: (characterId: string) => number;
  addExp: (characterId: string, exp: number) => { leveledUp: boolean; levelsGained: number };
  hasItem: (itemId: string, quantity?: number) => boolean;
  useItem: (itemId: string, targetCharacterId?: string) => any[] | null;
}

export class BattleSystem extends EventEmitter {
  private battleConfigs: Map<string, BattleConfig> = new Map();
  private currentBattle: BattleState | null = null;
  private context?: BattleContext;
  private retryCount: Map<string, number> = new Map();

  constructor(configs: BattleConfig[] = []) {
    super();
    configs.forEach((config) => this.addBattleConfig(config));
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

  getCurrentBattle(): BattleState | null {
    return this.currentBattle;
  }

  startBattle(battleId: string): BattleState | null {
    const config = this.battleConfigs.get(battleId);
    if (!config || !this.context) return null;

    const characters: BattleCharacter[] = [];

    config.playerCharacters.forEach((charId) => {
      const maxHp = this.context!.getCharacterMaxHp(charId);
      const maxMp = this.context!.getCharacterMaxMp(charId);
      characters.push({
        characterId: charId,
        isPlayerSide: true,
        currentHp: maxHp,
        maxHp,
        currentMp: maxMp,
        maxMp,
        buffs: [],
        isDefending: false,
      });
    });

    config.enemies.forEach((enemy) => {
      const maxHp = enemy.attributes.hp || 100;
      const maxMp = enemy.attributes.mp;
      characters.push({
        characterId: enemy.id,
        isPlayerSide: false,
        currentHp: maxHp,
        maxHp,
        currentMp: maxMp,
        maxMp,
        buffs: [],
        isDefending: false,
      });
    });

    this.currentBattle = {
      id: battleId,
      turn: 1,
      phase: 'start',
      characters,
      actionLog: [],
    };

    this.emit('battleStart', {
      battleId,
      battle: this.currentBattle,
    });

    this.currentBattle.phase = 'playerTurn';
    this.currentBattle.currentTurnCharacterId = this.getNextPlayerCharacter();

    this.emit('battleTurn', {
      battleId,
      turn: 1,
      phase: 'playerTurn',
      currentCharacterId: this.currentBattle.currentTurnCharacterId,
    });

    return this.currentBattle;
  }

  private getNextPlayerCharacter(): string | undefined {
    if (!this.currentBattle) return undefined;

    const playerChars = this.currentBattle.characters.filter(
      (c) => c.isPlayerSide && c.currentHp > 0
    );

    if (!playerChars.length) return undefined;

    return playerChars[0].characterId;
  }

  private getNextEnemyCharacter(): string | undefined {
    if (!this.currentBattle) return undefined;

    const enemyChars = this.currentBattle.characters.filter(
      (c) => !c.isPlayerSide && c.currentHp > 0
    );

    if (!enemyChars.length) return undefined;

    return enemyChars[Math.floor(Math.random() * enemyChars.length)].characterId;
  }

  executeAction(action: BattleAction): BattleLogEntry | null {
    if (!this.currentBattle || this.currentBattle.phase !== 'playerTurn') {
      return null;
    }

    const actor = this.currentBattle.characters.find(
      (c) => c.characterId === this.currentBattle!.currentTurnCharacterId
    );

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
          this.endBattle('fled');
          return logEntry;
        }
        break;
      case 'skill':
        break;
    }

    if (logEntry) {
      this.currentBattle.actionLog.push(logEntry);
    }

    if (this.checkBattleEnd()) {
      return logEntry;
    }

    this.nextTurn();

    return logEntry;
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

    if (target.isDefending) {
      damage = Math.floor(damage * 0.5);
    }

    target.currentHp = Math.max(0, target.currentHp - damage);

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
      `${actor.characterId} 进入防御姿态，受到的伤害减半`,
      undefined
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
        effects.forEach((effect: any) => {
          if (effect.type === 'heal' && target) {
            const healAmount = effect.value;
            target.currentHp = Math.min(target.maxHp, target.currentHp + healAmount);
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
      undefined
    );
  }

  private performFlee(actor: BattleCharacter): BattleLogEntry | null {
    const config = this.battleConfigs.get(this.currentBattle!.id);
    if (!config?.allowFlee) {
      return this.createLogEntry(actor.characterId, 'flee', undefined, 0, '无法逃跑');
    }

    const success = Math.random() > 0.3;

    if (success) {
      return this.createLogEntry(actor.characterId, 'flee', undefined, 0, '成功逃跑');
    }

    return this.createLogEntry(actor.characterId, 'flee', undefined, 0, '逃跑失败');
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
    if (char.isPlayerSide && this.context) {
      return this.context.getCharacterAttribute(char.characterId, 'attack') || 10;
    }
    const enemyConfig = this.getEnemyConfig(char.characterId);
    return enemyConfig?.attributes.attack || 10;
  }

  private getCharacterDefensePower(char: BattleCharacter): number {
    if (char.isPlayerSide && this.context) {
      return this.context.getCharacterAttribute(char.characterId, 'defense') || 5;
    }
    const enemyConfig = this.getEnemyConfig(char.characterId);
    return enemyConfig?.attributes.defense || 5;
  }

  private getEnemyConfig(enemyId: string): EnemyConfig | undefined {
    const config = this.battleConfigs.get(this.currentBattle!.id);
    return config?.enemies.find((e) => e.id === enemyId);
  }

  private createLogEntry(
    actorId: string,
    action: string,
    targetId?: string,
    damage?: number,
    message?: string,
    heal?: number
  ): BattleLogEntry {
    return {
      turn: this.currentBattle!.turn,
      actorId,
      action,
      targetId,
      damage,
      heal,
      message: message || `${actorId} 使用了 ${action}`,
    };
  }

  private nextTurn(): void {
    if (!this.currentBattle) return;

    this.currentBattle.characters.forEach((c) => {
      if (c.isPlayerSide) {
        c.isDefending = false;
      }
    });

    if (this.currentBattle.phase === 'playerTurn') {
      this.currentBattle.phase = 'enemyTurn';
      this.currentBattle.currentTurnCharacterId = this.getNextEnemyCharacter();

      this.emit('battleTurn', {
        battleId: this.currentBattle.id,
        turn: this.currentBattle.turn,
        phase: 'enemyTurn',
        currentCharacterId: this.currentBattle.currentTurnCharacterId,
      });

      setTimeout(() => this.executeEnemyTurn(), 500);
    } else {
      this.currentBattle.turn++;
      this.currentBattle.phase = 'playerTurn';
      this.currentBattle.currentTurnCharacterId = this.getNextPlayerCharacter();

      this.processBuffs();

      this.emit('battleTurn', {
        battleId: this.currentBattle.id,
        turn: this.currentBattle.turn,
        phase: 'playerTurn',
        currentCharacterId: this.currentBattle.currentTurnCharacterId,
      });
    }
  }

  private executeEnemyTurn(): void {
    if (!this.currentBattle || this.currentBattle.phase !== 'enemyTurn') return;

    const enemyChars = this.currentBattle.characters.filter(
      (c) => !c.isPlayerSide && c.currentHp > 0
    );

    let delay = 0;
    enemyChars.forEach((enemy) => {
      setTimeout(() => {
        if (!this.currentBattle || this.currentBattle.phase !== 'enemyTurn') return;

        const playerChars = this.currentBattle!.characters.filter(
          (c) => c.isPlayerSide && c.currentHp > 0
        );
        if (!playerChars.length) return;

        const target = playerChars[Math.floor(Math.random() * playerChars.length)];

        const attackPower = this.getCharacterAttackPower(enemy);
        const defensePower = this.getCharacterDefensePower(target);

        let damage = Math.max(1, attackPower - defensePower * 0.5);
        damage = Math.floor(damage * (0.9 + Math.random() * 0.2));

        if (target.isDefending) {
          damage = Math.floor(damage * 0.5);
        }

        target.currentHp = Math.max(0, target.currentHp - damage);

        const logEntry = this.createLogEntry(
          enemy.characterId,
          'attack',
          target.characterId,
          damage,
          `${enemy.characterId} 对 ${target.characterId} 造成了 ${damage} 点伤害`
        );

        this.currentBattle!.actionLog.push(logEntry);

        this.emit('battleEnemyAction', {
          battleId: this.currentBattle!.id,
          logEntry,
        });

        if (this.checkBattleEnd()) return;
      }, delay);

      delay += 600;
    });

    setTimeout(() => {
      if (!this.currentBattle || this.currentBattle.phase !== 'enemyTurn') return;
      if (!this.checkBattleEnd()) {
        this.nextTurn();
      }
    }, delay + 300);
  }

  private processBuffs(): void {
    if (!this.currentBattle) return;

    this.currentBattle.characters.forEach((char) => {
      char.buffs = char.buffs.filter((buff) => {
        buff.remainingTurns--;
        return buff.remainingTurns > 0;
      });
    });
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

    if (result === 'victory') {
      let totalExp = 0;
      config?.enemies.forEach((enemy) => {
        totalExp += enemy.expReward || 0;
      });

      if (totalExp > 0 && this.context) {
        const player = config?.playerCharacters[0];
        if (player) {
          this.context.addExp(player, totalExp);
        }
      }
    }

    if (result === 'defeat' && config?.retryable) {
      const count = (this.retryCount.get(this.currentBattle.id) || 0) + 1;
      this.retryCount.set(this.currentBattle.id, count);
    }

    this.emit('battleEnd', {
      battleId: this.currentBattle.id,
      result,
      battle: this.currentBattle,
      effects: config?.[`on${result.charAt(0).toUpperCase() + result.slice(1)}` as keyof BattleConfig] as DialogueEffect[] || [],
    });
  }

  retryBattle(): BattleState | null {
    if (!this.currentBattle) return null;

    const config = this.battleConfigs.get(this.currentBattle.id);
    if (!config?.retryable) return null;

    const battleId = this.currentBattle.id;
    this.currentBattle = null;

    return this.startBattle(battleId);
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

    char.buffs.push({
      ...buff,
      remainingTurns: buff.duration,
    });

    return true;
  }

  removeBuff(characterId: string, buffId: string): boolean {
    if (!this.currentBattle) return false;

    const char = this.currentBattle.characters.find(
      (c) => c.characterId === characterId
    );

    if (!char) return false;

    const index = char.buffs.findIndex((b) => b.id === buffId);
    if (index === -1) return false;

    char.buffs.splice(index, 1);
    return true;
  }

  toJSON(): BattleState | null {
    return this.currentBattle;
  }

  fromJSON(data: BattleState): void {
    this.currentBattle = data;
  }
}

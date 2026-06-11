import {
  DialogueEffect,
  EffectResult,
  EffectsExecutionResult,
  QuestRewardsExecutionResult,
} from '../types';
import { EventEmitter } from './EventEmitter';

export interface EffectContext {
  getAttribute: (characterId: string, attributeId: string) => number;
  setAttribute: (characterId: string, attributeId: string, value: number) => number;
  addAttribute: (characterId: string, attributeId: string, amount: number) => number;
  getAffinity: (characterId: string) => number;
  addAffinity: (characterId: string, amount: number) => number;
  setAffinity: (characterId: string, value: number) => number;
  hasItem: (itemId: string, quantity?: number) => boolean;
  addItem: (itemId: string, quantity: number) => boolean;
  removeItem: (itemId: string, quantity: number) => boolean;
  setItemCount: (itemId: string, quantity: number) => boolean;
  startQuest: (questId: string) => boolean;
  completeQuest: (questId: string) => QuestRewardsExecutionResult | null;
  updateQuestObjective: (questId: string, objectiveId: string, count: number) => boolean;
  reportQuestProgress: (
    questId: string,
    objectiveId: string,
    amount: number
  ) => { success: boolean; newCount: number; completed: boolean };
  resetQuest: (questId: string) => boolean;
  getVariable: (key: string) => any;
  setVariable: (key: string, value: any) => void;
  unlockChapter: (chapterId: string) => boolean;
  setCurrentChapter: (chapterId: string) => boolean;
  addGold: (amount: number) => number;
  setGold: (amount: number) => number;
  spendGold: (amount: number) => boolean;
  addExp: (characterId: string, exp: number) => { leveledUp: boolean; levelsGained: number };
  addSkill: (characterId: string, skillId: string) => boolean;
  getPlayerCharacterId: () => string | undefined;
  clampValue: (value: number, min?: number, max?: number) => number;
  isValidNumber: (value: any) => boolean;
}

export class EffectExecutor extends EventEmitter {
  private context: EffectContext;

  constructor(context: EffectContext) {
    super();
    this.context = context;
  }

  setContext(context: EffectContext): void {
    this.context = context;
  }

  execute(effects: DialogueEffect[], source?: string): EffectsExecutionResult {
    const results: EffectResult[] = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const effect of effects) {
      const result = this.executeSingle(effect);
      results.push(result);

      if (result.success) {
        totalSuccess++;
      } else {
        totalFailed++;
      }

      this.emit('effectTriggered', {
        effect,
        result,
        source,
      });
    }

    const executionResult: EffectsExecutionResult = {
      results,
      totalSuccess,
      totalFailed,
      allSuccess: totalFailed === 0,
    };

    this.emit('effectsExecuted', {
      ...executionResult,
      source,
      effects,
    });

    return executionResult;
  }

  private executeSingle(effect: DialogueEffect): EffectResult {
    const {
      type,
      attributeId,
      characterId,
      itemId,
      questId,
      objectiveId,
      variableKey,
      chapterId,
      skillId,
      value,
      operation = 'add',
      questAction,
    } = effect;

    const targetCharId = characterId || this.context.getPlayerCharacterId();
    let oldValue: any;
    let newValue: any;
    let success = false;
    let message: string | undefined;
    let error: string | undefined;

    try {
      switch (type) {
        case 'attribute': {
          if (!attributeId || !targetCharId || !this.context.isValidNumber(value)) {
            error = '属性效果缺少必要参数';
            break;
          }
          const attrValue = value as number;
          oldValue = this.context.getAttribute(targetCharId, attributeId);

          if (operation === 'add') {
            const safeValue = this.context.clampValue(attrValue, 0);
            newValue = this.context.addAttribute(targetCharId, attributeId, safeValue);
          } else if (operation === 'set') {
            newValue = this.context.setAttribute(targetCharId, attributeId, attrValue);
          } else if (operation === 'remove') {
            const safeValue = this.context.clampValue(attrValue, 0);
            newValue = this.context.addAttribute(targetCharId, attributeId, -safeValue);
          }
          success = true;
          message = `属性 ${attributeId}: ${oldValue} → ${newValue}`;
          break;
        }

        case 'affinity': {
          if (!targetCharId || !this.context.isValidNumber(value)) {
            error = '好感度效果缺少必要参数';
            break;
          }
          const affValue = value as number;
          oldValue = this.context.getAffinity(targetCharId);

          if (operation === 'add') {
            const safeValue = this.context.clampValue(affValue, -100, 100);
            newValue = this.context.addAffinity(targetCharId, safeValue);
          } else if (operation === 'set') {
            const safeValue = this.context.clampValue(affValue, 0, 100);
            newValue = this.context.setAffinity(targetCharId, safeValue);
          }
          success = true;
          message = `好感度: ${oldValue} → ${newValue}`;
          break;
        }

        case 'item': {
          if (!itemId || !this.context.isValidNumber(value)) {
            error = '道具效果缺少必要参数';
            break;
          }
          const itemValue = value as number;

          if (operation === 'add') {
            const qty = this.context.clampValue(Math.abs(itemValue), 0, 9999);
            oldValue = 0;
            success = this.context.addItem(itemId, qty);
            newValue = qty;
            message = success ? `获得道具 ${itemId} x${qty}` : `道具 ${itemId} 添加失败`;
          } else if (operation === 'set') {
            const qty = this.context.clampValue(itemValue, 0, 9999);
            oldValue = 0;
            success = this.context.setItemCount(itemId, qty);
            newValue = qty;
            message = success ? `道具 ${itemId} 数量设为 ${qty}` : `道具 ${itemId} 设置失败`;
          } else if (operation === 'remove') {
            const qty = this.context.clampValue(Math.abs(itemValue), 0, 9999);
            oldValue = qty;
            success = this.context.removeItem(itemId, qty);
            newValue = 0;
            message = success ? `移除道具 ${itemId} x${qty}` : `道具 ${itemId} 数量不足`;
          }
          break;
        }

        case 'quest': {
          if (!questId) {
            error = '任务效果缺少任务ID';
            break;
          }

          if (questAction === 'start') {
            success = this.context.startQuest(questId);
            message = success ? `任务 ${questId} 已开始` : `任务 ${questId} 无法开始`;
          } else if (questAction === 'complete') {
            const rewards = this.context.completeQuest(questId);
            success = rewards !== null;
            message = success ? `任务 ${questId} 已完成` : `任务 ${questId} 无法完成`;
            newValue = rewards;
          } else if (questAction === 'progress') {
            if (!objectiveId || !this.context.isValidNumber(value) || (value as number) < 1) {
              error = '任务进度推进缺少 objectiveId 或有效 value（必须 ≥ 1）';
              success = false;
              break;
            }
            const amount = this.context.clampValue(value as number, 1);
            const progressResult = this.context.reportQuestProgress(questId, objectiveId, amount);
            success = progressResult.success;
            newValue = progressResult;
            message = success
              ? `任务 ${questId} 目标 ${objectiveId} 推进 ${amount}，当前 ${progressResult.newCount}${progressResult.completed ? '（已完成）' : ''}`
              : `任务 ${questId} 目标 ${objectiveId} 推进失败`;
          } else if (questAction === 'update') {
            success = true;
            message = `任务 ${questId} 目标已更新`;
          } else if (questAction === 'reset') {
            success = this.context.resetQuest(questId);
            message = success ? `任务 ${questId} 已重置` : `任务 ${questId} 无法重置`;
          }
          break;
        }

        case 'variable': {
          if (!variableKey) {
            error = '变量效果缺少变量键';
            break;
          }
          oldValue = this.context.getVariable(variableKey);

          if (operation === 'set') {
            newValue = value;
            this.context.setVariable(variableKey, value);
            success = true;
          } else if (operation === 'add' && typeof value === 'number' && typeof oldValue === 'number') {
            newValue = oldValue + value;
            this.context.setVariable(variableKey, newValue);
            success = true;
          } else if (operation === 'remove' && typeof value === 'number' && typeof oldValue === 'number') {
            newValue = oldValue - value;
            this.context.setVariable(variableKey, newValue);
            success = true;
          } else {
            newValue = value;
            this.context.setVariable(variableKey, value);
            success = true;
          }
          message = `变量 ${variableKey}: ${oldValue} → ${newValue}`;
          break;
        }

        case 'chapter': {
          if (!chapterId) {
            error = '章节效果缺少章节ID';
            break;
          }
          this.context.unlockChapter(chapterId);
          success = this.context.setCurrentChapter(chapterId);
          message = success ? `已进入章节 ${chapterId}` : `章节 ${chapterId} 无法进入`;
          break;
        }

        case 'gold': {
          if (!this.context.isValidNumber(value)) {
            error = '金币效果缺少有效数值';
            break;
          }
          const goldValue = value as number;

          if (operation === 'add') {
            const safeAmount = this.context.clampValue(goldValue, 0);
            newValue = this.context.addGold(safeAmount);
            oldValue = newValue - safeAmount;
            success = true;
            message = `获得金币 ${safeAmount}`;
          } else if (operation === 'set') {
            const safeAmount = this.context.clampValue(goldValue, 0);
            oldValue = 0;
            newValue = this.context.setGold(safeAmount);
            success = true;
            message = `金币设为 ${safeAmount}`;
          } else if (operation === 'remove') {
            const safeAmount = this.context.clampValue(goldValue, 0);
            oldValue = 0;
            success = this.context.spendGold(safeAmount);
            newValue = success ? -safeAmount : 0;
            message = success ? `消耗金币 ${safeAmount}` : `金币不足`;
          }
          break;
        }

        case 'exp': {
          if (!targetCharId || !this.context.isValidNumber(value)) {
            error = '经验效果缺少必要参数';
            break;
          }
          const expValue = value as number;
          const safeExp = this.context.clampValue(expValue, 0);
          oldValue = 0;
          const result = this.context.addExp(targetCharId, safeExp);
          newValue = result;
          success = true;
          message = result.leveledUp
            ? `获得 ${safeExp} 经验，升级 ${result.levelsGained} 级`
            : `获得 ${safeExp} 经验`;
          break;
        }

        case 'skill': {
          if (!skillId || !targetCharId) {
            error = '技能效果缺少必要参数';
            break;
          }
          if (operation === 'add' || operation === 'set') {
            success = this.context.addSkill(targetCharId, skillId);
            message = success ? `学会技能 ${skillId}` : `已掌握技能 ${skillId}`;
          }
          break;
        }

        default:
          error = `未知效果类型: ${type}`;
      }
    } catch (e: any) {
      error = e?.message || '效果执行异常';
      success = false;
    }

    return {
      effect,
      success,
      oldValue,
      newValue,
      message,
      error,
    };
  }
}

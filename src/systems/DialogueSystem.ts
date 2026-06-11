import {
  DialogueConfig,
  DialogueState,
  DialogueChoice,
  DialogueEffect,
  DialogueCondition,
} from '../types';
import { EventEmitter } from './EventEmitter';

export interface DialogueContext {
  getAttribute: (characterId: string, attributeId: string) => number;
  getAffinity: (characterId: string) => number;
  hasItem: (itemId: string, quantity?: number) => boolean;
  getQuestStatus: (questId: string) => string | undefined;
  getVariable: (key: string) => any;
  getLevel: (characterId: string) => number;
  getChapterId: () => string;
}

export class DialogueSystem extends EventEmitter {
  private dialogueConfigs: Map<string, DialogueConfig> = new Map();
  private state: DialogueState = {
    currentDialogueId: null,
    history: [],
  };
  private variables: Record<string, any> = {};
  private context?: DialogueContext;

  constructor(configs: DialogueConfig[] = []) {
    super();
    configs.forEach((config) => this.addDialogueConfig(config));
  }

  setContext(context: DialogueContext): void {
    this.context = context;
  }

  addDialogueConfig(config: DialogueConfig): void {
    this.dialogueConfigs.set(config.id, config);
  }

  getDialogueConfig(id: string): DialogueConfig | undefined {
    return this.dialogueConfigs.get(id);
  }

  getAllDialogueConfigs(): DialogueConfig[] {
    return Array.from(this.dialogueConfigs.values());
  }

  getState(): DialogueState {
    return { ...this.state };
  }

  getCurrentDialogue(): DialogueConfig | null {
    if (!this.state.currentDialogueId) return null;
    return this.dialogueConfigs.get(this.state.currentDialogueId) || null;
  }

  startDialogue(dialogueId: string): DialogueConfig | null {
    const config = this.dialogueConfigs.get(dialogueId);
    if (!config) return null;

    this.state.currentDialogueId = dialogueId;
    this.state.history.push(dialogueId);

    if (config.effects?.length) {
      this.applyEffects(config.effects);
    }

    this.emit('dialogueStart', {
      dialogueId,
      dialogue: config,
    });

    return config;
  }

  getAvailableChoices(): DialogueChoice[] {
    const current = this.getCurrentDialogue();
    if (!current?.choices) return [];

    return current.choices.filter((choice) => {
      if (!choice.condition) return true;
      return this.checkCondition(choice.condition);
    });
  }

  selectChoice(choiceId: string): DialogueConfig | null {
    const current = this.getCurrentDialogue();
    if (!current?.choices) return null;

    const choice = current.choices.find((c) => c.id === choiceId);
    if (!choice) return null;

    if (choice.condition && !this.checkCondition(choice.condition)) {
      return null;
    }

    this.emit('choiceSelected', {
      dialogueId: this.state.currentDialogueId,
      choiceId,
      choice,
    });

    if (choice.effects?.length) {
      this.applyEffects(choice.effects);
    }

    if (choice.nextDialogueId) {
      return this.goToDialogue(choice.nextDialogueId);
    }

    this.endDialogue();
    return null;
  }

  next(): DialogueConfig | null {
    const current = this.getCurrentDialogue();
    if (!current) return null;

    if (current.isEnd) {
      this.endDialogue();
      return null;
    }

    if (current.nextDialogueId) {
      return this.goToDialogue(current.nextDialogueId);
    }

    if (!current.choices?.length) {
      this.endDialogue();
      return null;
    }

    return current;
  }

  private goToDialogue(dialogueId: string): DialogueConfig | null {
    const config = this.dialogueConfigs.get(dialogueId);
    if (!config) {
      this.endDialogue();
      return null;
    }

    this.state.currentDialogueId = dialogueId;
    this.state.history.push(dialogueId);

    if (config.effects?.length) {
      this.applyEffects(config.effects);
    }

    return config;
  }

  endDialogue(): void {
    const dialogueId = this.state.currentDialogueId;
    this.state.currentDialogueId = null;

    this.emit('dialogueEnd', {
      dialogueId,
      history: [...this.state.history],
    });
  }

  private checkCondition(condition: DialogueCondition): boolean {
    if (!this.context) return true;

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

    let actualValue: any;

    switch (type) {
      case 'attribute':
        if (!characterId || !attributeId) return true;
        actualValue = this.context.getAttribute(characterId, attributeId);
        break;
      case 'affinity':
        if (!characterId) return true;
        actualValue = this.context.getAffinity(characterId);
        break;
      case 'item':
        if (!itemId) return true;
        actualValue = this.context.hasItem(itemId, value as number);
        return operator === 'has' ? actualValue : !actualValue;
      case 'quest':
        if (!questId) return true;
        actualValue = this.context.getQuestStatus(questId);
        return actualValue === questStatus;
      case 'variable':
        if (!variableKey) return true;
        actualValue = this.getVariable(variableKey);
        break;
      case 'level':
        if (!characterId) return true;
        actualValue = this.context.getLevel(characterId);
        break;
      case 'chapter':
        if (!chapterId) return true;
        actualValue = this.context.getChapterId();
        return actualValue === chapterId;
      default:
        return true;
    }

    return this.compareValues(actualValue, value, operator);
  }

  private compareValues(
    actual: any,
    expected: any,
    operator: string
  ): boolean {
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

  private applyEffects(effects: DialogueEffect[]): void {
    effects.forEach((effect) => {
      this.emit('effectTriggered', { effect });
    });
  }

  getVariable(key: string): any {
    return this.variables[key];
  }

  setVariable(key: string, value: any): void {
    const oldValue = this.variables[key];
    this.variables[key] = value;

    if (oldValue !== value) {
      this.emit('variableChange', {
        key,
        oldValue,
        newValue: value,
      });
    }
  }

  getAllVariables(): Record<string, any> {
    return { ...this.variables };
  }

  hasDialogue(dialogueId: string): boolean {
    return this.dialogueConfigs.has(dialogueId);
  }

  getDialoguesByChapter(chapterId: string): DialogueConfig[] {
    return this.getAllDialogueConfigs().filter((d) => d.chapterId === chapterId);
  }

  reset(): void {
    this.state = {
      currentDialogueId: null,
      history: [],
    };
  }

  toJSON(): { state: DialogueState; variables: Record<string, any> } {
    return {
      state: { ...this.state },
      variables: { ...this.variables },
    };
  }

  fromJSON(data: { state: DialogueState; variables: Record<string, any> }): void {
    this.state = { ...data.state };
    this.variables = { ...data.variables };
  }
}

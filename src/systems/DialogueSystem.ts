import {
  DialogueConfig,
  DialogueState,
  DialogueChoice,
  DialogueEffect,
  DialogueCondition,
  EffectsExecutionResult,
} from '../types';
import { EventEmitter } from './EventEmitter';
import { EffectExecutor } from './EffectExecutor';

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
    choicesMade: {},
  };
  private variables: Record<string, any> = {};
  private context?: DialogueContext;
  private effectExecutor?: EffectExecutor;

  constructor(configs: DialogueConfig[] = []) {
    super();
    configs.forEach((config) => this.addDialogueConfig(config));
  }

  setContext(context: DialogueContext): void {
    this.context = context;
  }

  setEffectExecutor(executor: EffectExecutor): void {
    this.effectExecutor = executor;
  }

  runEffects(effects: DialogueEffect[]): EffectsExecutionResult {
    if (this.effectExecutor) {
      return this.effectExecutor.execute(effects, 'dialogue');
    }
    const results = effects.map((effect) => {
      this.emit('effectTriggered', { effect });
      return {
        effect,
        success: true,
      };
    });
    const totalSuccess = results.filter((r) => r.success).length;
    const totalFailed = results.length - totalSuccess;
    return {
      results,
      totalSuccess,
      totalFailed,
      allSuccess: totalFailed === 0,
    };
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
    return {
      ...this.state,
      choicesMade: { ...this.state.choicesMade },
    };
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

    if (config.onStartEffects?.length) {
      this.runEffects(config.onStartEffects);
    }

    if (config.effects?.length) {
      this.runEffects(config.effects);
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

    if (this.state.currentDialogueId) {
      this.state.choicesMade[this.state.currentDialogueId] = choiceId;
    }

    this.emit('choiceSelected', {
      dialogueId: this.state.currentDialogueId,
      choiceId,
      choice,
    });

    if (choice.effects?.length) {
      const result = this.runEffects(choice.effects);
      this.emit('effectsExecuted', {
        ...result,
        source: 'choice',
        dialogueId: this.state.currentDialogueId,
        choiceId,
        effects: choice.effects,
      });
    }

    if (choice.nextDialogueId) {
      return this.goToDialogue(choice.nextDialogueId).dialogue;
    }

    this.endDialogue();
    return null;
  }

  next(): EffectsExecutionResult & { dialogue: DialogueConfig | null } {
    const current = this.getCurrentDialogue();
    if (!current) {
      return {
        results: [],
        totalSuccess: 0,
        totalFailed: 0,
        allSuccess: true,
        dialogue: null,
      };
    }

    if (current.isEnd) {
      this.endDialogue();
      return {
        results: [],
        totalSuccess: 0,
        totalFailed: 0,
        allSuccess: true,
        dialogue: null,
      };
    }

    if (current.nextDialogueId) {
      return this.goToDialogue(current.nextDialogueId);
    }

    if (!current.choices?.length) {
      this.endDialogue();
      return {
        results: [],
        totalSuccess: 0,
        totalFailed: 0,
        allSuccess: true,
        dialogue: null,
      };
    }

    return {
      results: [],
      totalSuccess: 0,
      totalFailed: 0,
      allSuccess: true,
      dialogue: current,
    };
  }

  private goToDialogue(dialogueId: string): EffectsExecutionResult & { dialogue: DialogueConfig | null } {
    const config = this.dialogueConfigs.get(dialogueId);
    if (!config) {
      this.endDialogue();
      return {
        results: [],
        totalSuccess: 0,
        totalFailed: 0,
        allSuccess: true,
        dialogue: null,
      };
    }

    this.state.currentDialogueId = dialogueId;
    this.state.history.push(dialogueId);

    let effectsResult: EffectsExecutionResult = {
      results: [],
      totalSuccess: 0,
      totalFailed: 0,
      allSuccess: true,
    };

    if (config.onStartEffects?.length) {
      this.runEffects(config.onStartEffects);
    }

    if (config.effects?.length) {
      effectsResult = this.runEffects(config.effects);
    }

    return {
      ...effectsResult,
      dialogue: config,
    };
  }

  endDialogue(): void {
    const dialogueId = this.state.currentDialogueId;
    const config = dialogueId ? this.dialogueConfigs.get(dialogueId) : undefined;
    const history = [...this.state.history];

    if (config?.onEndEffects?.length) {
      this.runEffects(config.onEndEffects);
    }

    this.state.currentDialogueId = null;

    this.emit('dialogueEnd', {
      dialogueId,
      history,
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

  setAllVariables(variables: Record<string, any>): void {
    this.variables = { ...variables };
  }

  getDialogueState(): DialogueState {
    return {
      ...this.state,
      choicesMade: { ...this.state.choicesMade },
      history: [...this.state.history],
    };
  }

  setDialogueState(state: DialogueState): void {
    this.state = {
      ...state,
      choicesMade: { ...state.choicesMade },
      history: [...state.history],
    };
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
      choicesMade: {},
    };
  }

  toJSON(): { state: DialogueState; variables: Record<string, any> } {
    return {
      state: {
        ...this.state,
        choicesMade: { ...this.state.choicesMade },
      },
      variables: { ...this.variables },
    };
  }

  fromJSON(data: { state: DialogueState; variables: Record<string, any> }): void {
    this.state = {
      ...data.state,
      choicesMade: { ...data.state.choicesMade },
    };
    this.variables = { ...data.variables };
  }
}

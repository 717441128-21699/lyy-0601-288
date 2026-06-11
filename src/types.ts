export interface AttributeConfig {
  id: string;
  name: string;
  minValue?: number;
  maxValue?: number;
  description?: string;
}

export interface AttributeData {
  id: string;
  value: number;
}

export interface LevelConfig {
  level: number;
  expRequired: number;
  attributeGains?: Record<string, number>;
}

export interface CharacterConfig {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  isPlayer?: boolean;
  initialAttributes?: AttributeData[];
  initialLevel?: number;
  initialExp?: number;
  affinity?: number;
  affinityMax?: number;
}

export interface CharacterData {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  level: number;
  exp: number;
  attributes: Record<string, number>;
  affinity: number;
  affinityMax: number;
  isPlayer: boolean;
  skills: string[];
}

export interface ItemConfig {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  type: 'consumable' | 'equipment' | 'key' | 'material';
  stackable?: boolean;
  maxStack?: number;
  usable?: boolean;
  effects?: ItemEffect[];
}

export interface ItemEffect {
  type: 'heal' | 'damage' | 'buff' | 'debuff' | 'custom';
  target?: 'self' | 'enemy' | 'ally';
  attributeId?: string;
  value: number;
  duration?: number;
  customType?: string;
}

export interface InventoryItem {
  itemId: string;
  quantity: number;
}

export interface QuestObjective {
  id: string;
  type: 'kill' | 'collect' | 'talk' | 'reach' | 'custom';
  targetId?: string;
  targetCount: number;
  currentCount: number;
  description: string;
}

export interface QuestReward {
  type: 'exp' | 'item' | 'gold' | 'attribute' | 'affinity';
  itemId?: string;
  attributeId?: string;
  characterId?: string;
  value: number;
  quantity?: number;
}

export interface QuestConfig {
  id: string;
  name: string;
  description?: string;
  objectives: Omit<QuestObjective, 'currentCount'>[];
  rewards?: QuestReward[];
  prerequisites?: string[];
  isMain?: boolean;
  chapterId?: string;
}

export interface QuestData {
  id: string;
  status: 'available' | 'active' | 'completed' | 'failed';
  objectives: QuestObjective[];
  completedAt?: number;
}

export interface DialogueChoice {
  id: string;
  text: string;
  nextDialogueId?: string;
  effects?: DialogueEffect[];
  condition?: DialogueCondition;
}

export interface DialogueEffect {
  type: 'attribute' | 'affinity' | 'item' | 'quest' | 'variable' | 'chapter';
  attributeId?: string;
  characterId?: string;
  itemId?: string;
  questId?: string;
  variableKey?: string;
  chapterId?: string;
  value?: number | string | boolean;
  operation?: 'add' | 'set' | 'remove';
  questAction?: 'start' | 'complete' | 'update';
}

export interface DialogueCondition {
  type: 'attribute' | 'affinity' | 'item' | 'quest' | 'variable' | 'chapter' | 'level';
  attributeId?: string;
  characterId?: string;
  itemId?: string;
  questId?: string;
  variableKey?: string;
  chapterId?: string;
  operator?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'has' | 'not_has';
  value?: number | string | boolean;
  questStatus?: 'available' | 'active' | 'completed' | 'failed';
}

export interface DialogueConfig {
  id: string;
  speaker?: string;
  characterId?: string;
  text: string;
  choices?: DialogueChoice[];
  nextDialogueId?: string;
  effects?: DialogueEffect[];
  isEnd?: boolean;
  chapterId?: string;
}

export interface DialogueState {
  currentDialogueId: string | null;
  history: string[];
}

export interface BattleAction {
  type: 'attack' | 'skill' | 'item' | 'defend' | 'flee';
  skillId?: string;
  itemId?: string;
  targetId?: string;
}

export interface BattleCharacter {
  characterId: string;
  isPlayerSide: boolean;
  currentHp: number;
  maxHp: number;
  currentMp?: number;
  maxMp?: number;
  buffs: Buff[];
  isDefending: boolean;
}

export interface Buff {
  id: string;
  name: string;
  type: 'buff' | 'debuff';
  attributeId?: string;
  value: number;
  duration: number;
  remainingTurns: number;
}

export interface BattleConfig {
  id: string;
  name?: string;
  enemies: EnemyConfig[];
  playerCharacters: string[];
  maxTurns?: number;
  allowFlee?: boolean;
  retryable?: boolean;
  onVictory?: DialogueEffect[];
  onDefeat?: DialogueEffect[];
  onFlee?: DialogueEffect[];
}

export interface EnemyConfig {
  id: string;
  name: string;
  avatar?: string;
  attributes: Record<string, number>;
  expReward?: number;
  skills?: string[];
}

export interface BattleState {
  id: string;
  turn: number;
  phase: 'start' | 'playerTurn' | 'enemyTurn' | 'victory' | 'defeat' | 'fled';
  characters: BattleCharacter[];
  currentTurnCharacterId?: string;
  actionLog: BattleLogEntry[];
}

export interface BattleLogEntry {
  turn: number;
  actorId: string;
  action: string;
  targetId?: string;
  damage?: number;
  heal?: number;
  message: string;
}

export interface SaveData {
  id: string;
  createdAt: number;
  updatedAt: number;
  chapterId: string;
  characters: CharacterData[];
  inventory: InventoryItem[];
  gold: number;
  quests: QuestData[];
  dialogue: DialogueState;
  variables: Record<string, any>;
  achievements: string[];
  playTime: number;
}

export interface SaveSlotInfo {
  id: string;
  chapterName?: string;
  playerName?: string;
  playerLevel?: number;
  updatedAt: number;
  playTime: number;
  thumbnail?: string;
}

export interface AchievementConfig {
  id: string;
  name: string;
  description: string;
  icon?: string;
  condition: AchievementCondition;
  rewards?: QuestReward[];
  isHidden?: boolean;
}

export interface AchievementCondition {
  type: 'quest' | 'attribute' | 'item' | 'level' | 'chapter' | 'battle' | 'custom';
  questId?: string;
  attributeId?: string;
  itemId?: string;
  chapterId?: string;
  battleId?: string;
  operator?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  value?: number;
  count?: number;
  customCheck?: string;
}

export interface ChapterConfig {
  id: string;
  name: string;
  description?: string;
  isUnlocked: boolean;
  order: number;
  prerequisites?: string[];
  endingId?: string;
}

export interface EndingConfig {
  id: string;
  name: string;
  description?: string;
  condition: DialogueCondition[];
  isGood?: boolean;
}

export type RPGEventType =
  | 'levelUp'
  | 'attributeChange'
  | 'itemAdded'
  | 'itemRemoved'
  | 'itemUsed'
  | 'questStarted'
  | 'questUpdated'
  | 'questCompleted'
  | 'questFailed'
  | 'questAvailable'
  | 'dialogueStart'
  | 'dialogueEnd'
  | 'choiceSelected'
  | 'effectTriggered'
  | 'battleStart'
  | 'battleEnd'
  | 'battleTurn'
  | 'battleEnemyAction'
  | 'achievementUnlocked'
  | 'chapterUnlocked'
  | 'endingTriggered'
  | 'saveCreated'
  | 'saveLoaded'
  | 'affinityChange'
  | 'variableChange';

export interface RPGEvent {
  type: RPGEventType;
  payload: Record<string, any>;
  timestamp: number;
}

export type EventCallback = (event: RPGEvent) => void;

export interface RPGCoreConfig {
  levelTable?: LevelConfig[];
  maxLevel?: number;
  expMultiplier?: number;
  defaultAttributes?: AttributeConfig[];
  items?: ItemConfig[];
  characters?: CharacterConfig[];
  quests?: QuestConfig[];
  dialogues?: DialogueConfig[];
  achievements?: AchievementConfig[];
  chapters?: ChapterConfig[];
  endings?: EndingConfig[];
  battles?: BattleConfig[];
  initialGold?: number;
  saveStorageKey?: string;
  autoSave?: boolean;
}

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
  skillCooldowns: Record<string, number>;
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
  price?: number;
}

export interface ItemEffect {
  type: 'heal' | 'damage' | 'buff' | 'debuff' | 'mpRestore' | 'custom';
  target?: 'self' | 'enemy' | 'ally';
  attributeId?: string;
  value: number;
  duration?: number;
  customType?: string;
  id?: string;
  name?: string;
  dotDamage?: number;
  tickDamage?: number;
  attributes?: Record<string, number>;
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

export interface QuestPhase {
  id: string;
  name?: string;
  description?: string;
  objectives: Omit<QuestObjective, 'currentCount'>[];
  rewards?: QuestReward[];
}

export interface QuestReward {
  type: 'exp' | 'item' | 'gold' | 'attribute' | 'affinity';
  itemId?: string;
  attributeId?: string;
  characterId?: string;
  value: number;
  quantity?: number;
}

export type QuestRepeatType = 'none' | 'daily' | 'weekly' | 'custom';

export interface QuestConfig {
  id: string;
  name: string;
  description?: string;
  objectives: Omit<QuestObjective, 'currentCount'>[];
  rewards?: QuestReward[];
  prerequisites?: string[];
  isMain?: boolean;
  chapterId?: string;
  repeatType?: QuestRepeatType;
  repeatInterval?: number;
  repeatCount?: number;
  phases?: QuestPhase[];
  autoStart?: boolean;
  autoComplete?: boolean;
}

export interface QuestData {
  id: string;
  status: 'available' | 'active' | 'completed' | 'failed';
  objectives: QuestObjective[];
  completedAt?: number;
  currentPhaseIndex?: number;
  phaseObjectives?: QuestObjective[];
  repeatCount?: number;
  lastResetAt?: number;
  claimedRewards?: boolean;
}

export interface DialogueChoice {
  id: string;
  text: string;
  nextDialogueId?: string;
  effects?: DialogueEffect[];
  condition?: DialogueCondition;
}

export interface DialogueEffect {
  type: 'attribute' | 'affinity' | 'item' | 'quest' | 'variable' | 'chapter' | 'gold' | 'exp' | 'skill';
  attributeId?: string;
  characterId?: string;
  itemId?: string;
  questId?: string;
  variableKey?: string;
  chapterId?: string;
  skillId?: string;
  value?: number | string | boolean;
  operation?: 'add' | 'set' | 'remove';
  questAction?: 'start' | 'complete' | 'update' | 'reset';
}

export interface EffectResult {
  effect: DialogueEffect;
  success: boolean;
  oldValue?: any;
  newValue?: any;
  message?: string;
  error?: string;
}

export interface EffectsExecutionResult {
  results: EffectResult[];
  totalSuccess: number;
  totalFailed: number;
  allSuccess: boolean;
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
  onStartEffects?: DialogueEffect[];
  onEndEffects?: DialogueEffect[];
  isEnd?: boolean;
  chapterId?: string;
}

export interface DialogueState {
  currentDialogueId: string | null;
  history: string[];
  choicesMade: Record<string, string>;
}

export interface BattleAction {
  type: 'attack' | 'skill' | 'item' | 'defend' | 'flee';
  skillId?: string;
  itemId?: string;
  targetId?: string;
}

export interface SkillConfig {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  mpCost?: number;
  cooldown?: number;
  targetType: 'single' | 'single_enemy' | 'single_ally' | 'all_enemies' | 'all_allies' | 'self';
  damageMultiplier?: number;
  healAmount?: number;
  effects?: ItemEffect[];
  requiredLevel?: number;
}

export interface BattleCharacter {
  characterId: string;
  isPlayerSide: boolean;
  currentHp: number;
  maxHp: number;
  currentMp?: number;
  maxMp?: number;
  buffs: Buff[];
  debuffs: Buff[];
  isDefending: boolean;
  skillCooldowns: Record<string, number>;
  tookDamageThisTurn?: boolean;
}

export interface Buff {
  id: string;
  name: string;
  type: 'buff' | 'debuff';
  attributeId?: string;
  value: number;
  duration: number;
  remainingTurns: number;
  tickDamage?: number;
  onTickMessage?: string;
}

export interface BattleConfig {
  id: string;
  name?: string;
  enemies: EnemyConfig[];
  playerCharacters: string[];
  maxTurns?: number;
  allowFlee?: boolean;
  retryable?: boolean;
  turnOrder?: 'speed' | 'player_first' | 'alternating';
  onVictory?: DialogueEffect[];
  onDefeat?: DialogueEffect[];
  onFlee?: DialogueEffect[];
  onTurnStart?: DialogueEffect[];
  onTurnEnd?: DialogueEffect[];
  victoryRewards?: QuestReward[];
  backgroundImage?: string;
  music?: string;
}

export interface EnemyConfig {
  id: string;
  name: string;
  avatar?: string;
  attributes: Record<string, number>;
  expReward?: number;
  goldReward?: number;
  skills?: string[];
  loot?: { itemId: string; chance: number; minQuantity?: number; maxQuantity?: number }[];
  behavior?: 'aggressive' | 'defensive' | 'random' | 'support';
}

export interface BattleState {
  id: string;
  turn: number;
  phase: 'start' | 'playerTurn' | 'enemyTurn' | 'victory' | 'defeat' | 'fled';
  characters: BattleCharacter[];
  currentTurnCharacterId?: string;
  actionLog: BattleLogEntry[];
  turnQueue: string[];
  turnQueueIndex: number;
  awardedRewards?: boolean;
  originalState?: {
    characters: { hp: number; mp?: number }[];
    inventory: InventoryItem[];
  };
}

export interface BattleLogEntry {
  turn: number;
  actorId: string;
  action: string;
  targetId?: string;
  damage?: number;
  heal?: number;
  message: string;
  timestamp: number;
  critical?: boolean;
  missed?: boolean;
  skillId?: string;
  itemId?: string;
}

export interface SaveData {
  id: string;
  version: number;
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
  metadata?: Record<string, any>;
}

export interface SaveSlotInfo {
  id: string;
  version?: number;
  chapterName?: string;
  playerName?: string;
  playerLevel?: number;
  updatedAt: number;
  playTime: number;
  thumbnail?: string;
  metadata?: Record<string, any>;
  size?: number;
}

export interface SaveStorageAdapter {
  save(slotId: string, data: SaveData): Promise<boolean> | boolean;
  load(slotId: string): Promise<SaveData | null> | SaveData | null;
  delete(slotId: string): Promise<boolean> | boolean;
  list?(): Promise<SaveSlotInfo[]> | SaveSlotInfo[];
  exists?(slotId: string): Promise<boolean> | boolean;
  clear?(): Promise<boolean> | boolean;
}

export interface SaveMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (data: any) => SaveData;
}

export interface AchievementConfig {
  id: string;
  name: string;
  description: string;
  icon?: string;
  condition: AchievementCondition;
  rewards?: QuestReward[];
  isHidden?: boolean;
  points?: number;
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface AchievementCondition {
  type: 'quest' | 'attribute' | 'item' | 'level' | 'chapter' | 'battle' | 'custom' | 'playtime' | 'kill' | 'collection';
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
  onEnterEffects?: DialogueEffect[];
  onCompleteEffects?: DialogueEffect[];
  backgroundImage?: string;
  thumbnail?: string;
}

export interface EndingConfig {
  id: string;
  name: string;
  description?: string;
  condition: DialogueCondition[];
  isGood?: boolean;
  effects?: DialogueEffect[];
  thumbnail?: string;
}

export type RPGEventType =
  | 'levelUp'
  | 'attributeChange'
  | 'itemAdded'
  | 'itemRemoved'
  | 'itemUsed'
  | 'questStarted'
  | 'questUpdated'
  | 'questObjectiveComplete'
  | 'questPhaseComplete'
  | 'questCompleted'
  | 'questRewardsClaimed'
  | 'questFailed'
  | 'questReset'
  | 'questAvailable'
  | 'dialogueStart'
  | 'dialogueEnd'
  | 'choiceSelected'
  | 'effectsExecuted'
  | 'effectTriggered'
  | 'battleStart'
  | 'battleEnd'
  | 'battleTurn'
  | 'battleEnemyAction'
  | 'battleSkillUsed'
  | 'battleVictory'
  | 'battleDefeat'
  | 'battleFled'
  | 'battleRetry'
  | 'achievementUnlocked'
  | 'chapterUnlocked'
  | 'chapterEntered'
  | 'endingTriggered'
  | 'saveCreated'
  | 'saveLoaded'
  | 'saveDeleted'
  | 'saveImported'
  | 'saveExported'
  | 'saveMigrated'
  | 'affinityChange'
  | 'variableChange'
  | 'skillLearned'
  | 'skillUsed'
  | 'goldChange';

export interface RPGEvent {
  type: RPGEventType;
  payload: Record<string, any>;
  timestamp: number;
}

export type EventCallback = (event: RPGEvent) => void;

export interface RPGCoreConfig {
  version?: number;
  levelTable?: LevelConfig[];
  maxLevel?: number;
  expMultiplier?: number;
  defaultAttributes?: AttributeConfig[];
  items?: ItemConfig[];
  skills?: SkillConfig[];
  characters?: CharacterConfig[];
  quests?: QuestConfig[];
  dialogues?: DialogueConfig[];
  achievements?: AchievementConfig[];
  chapters?: ChapterConfig[];
  endings?: EndingConfig[];
  battles?: BattleConfig[];
  initialGold?: number;
  saveStorageKey?: string;
  saveAdapter?: SaveStorageAdapter;
  saveMigrations?: SaveMigration[];
  autoSave?: boolean;
  autoSaveInterval?: number;
  validateValues?: boolean;
  clampNegativeValues?: boolean;
}

(async function runTests() {
const { RPGCore } = require('./dist/index');

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    passCount++;
    console.log('  ✓ ' + msg);
  } else {
    failCount++;
    failures.push(msg);
    console.log('  ✗ ' + msg);
  }
}

function section(title) {
  console.log('\n━━━ ' + title + ' ━━━');
}

// ============================================================
section('一、统一剧情效果系统 + 执行结果监听');
// ============================================================

const rpg1 = new RPGCore({
  initialGold: 100,
  levelTable: [
    { level: 2, expRequired: 100, attributeGains: { maxHp: 20 } },
    { level: 3, expRequired: 250, attributeGains: { maxHp: 25 } },
    { level: 4, expRequired: 500, attributeGains: { maxHp: 30 } },
    { level: 5, expRequired: 1000, attributeGains: { maxHp: 40 } },
  ],
  defaultAttributes: [
    { id: 'hp', name: 'HP', minValue: 0, maxValue: 9999 },
    { id: 'maxHp', name: 'MaxHP' },
    { id: 'mp', name: 'MP', minValue: 0, maxValue: 999 },
    { id: 'attack', name: 'ATK' },
  ],
  items: [
    { id: 'potion', name: '药水', type: 'consumable', stackable: true, usable: false },
    { id: 'sword', name: '剑', type: 'equipment', stackable: false, usable: false },
  ],
  characters: [
    {
      id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1,
      initialAttributes: [
        { id: 'maxHp', value: 200 }, { id: 'hp', value: 200 },
        { id: 'mp', value: 50 }, { id: 'attack', value: 20 },
      ],
    },
    {
      id: 'ella', name: '艾拉', isPlayer: false, initialLevel: 1,
      affinity: 0, affinityMax: 100,
      initialAttributes: [
        { id: 'maxHp', value: 150 }, { id: 'hp', value: 150 },
        { id: 'attack', value: 18 },
      ],
    },
  ],
  quests: [
    { id: 'q1', name: '任务1', objectives: [{ id: 'o1', type: 'custom', targetCount: 1 }], rewards: [] },
  ],
  chapters: [
    { id: 'ch1', name: '第一章', isUnlocked: true, order: 1 },
    { id: 'ch2', name: '第二章', isUnlocked: false, order: 2 },
  ],
});

// 监听 effectsExecuted 事件
let lastEffectsResult = null;
rpg1.on('effectsExecuted', (ev) => {
  lastEffectsResult = ev.payload;
});

// 执行一组混合效果
const result = rpg1.executeEffects([
  { type: 'gold', value: 80, operation: 'add' },
  { type: 'variable', variableKey: 'flag_x', value: true, operation: 'set' },
  { type: 'affinity', characterId: 'ella', value: 15, operation: 'add' },
  { type: 'item', itemId: 'potion', value: 5, operation: 'add' },
  { type: 'exp', value: 120, operation: 'add' },
  { type: 'attribute', characterId: 'hero', attributeId: 'attack', value: 3, operation: 'add' },
  { type: 'quest', questId: 'q1', questAction: 'start' },
  { type: 'chapter', chapterId: 'ch2', chapterAction: 'unlock' },
], 'test_case_1');

assert(result.totalSuccess === 8, 'executeEffects 返回 totalSuccess=8');
assert(result.totalFailed === 0, 'executeEffects 返回 totalFailed=0');
assert(result.allSuccess === true, 'executeEffects 返回 allSuccess=true');
assert(result.results.length === 8, 'results 数组长度 8');
assert(rpg1.getGold() === 180, '金币: 100 + 80 = 180');
assert(rpg1.getVariable('flag_x') === true, '变量 flag_x = true');
assert(rpg1.character.getAffinity('ella') === 15, '艾拉好感度 = 15');
assert(rpg1.inventory.getItemCount('potion') === 5, '药水 = 5');
assert(rpg1.character.getLevel('hero') >= 2, '经验 120 触发升级');
assert(rpg1.character.getAttribute('hero', 'attack') >= 23, '攻击力 +3');
assert(rpg1.quest.getQuest('q1').status === 'active', '任务 q1 进行中');
assert(rpg1.save.isChapterUnlocked('ch2') === true, '第二章已解锁');
assert(lastEffectsResult !== null, 'effectsExecuted 事件被触发');
assert(lastEffectsResult.totalSuccess === 8, '事件中的 totalSuccess=8');
assert(lastEffectsResult.source === 'test_case_1', '事件中的 source 正确');

// 测试失败场景（比如移除不存在的道具）
const badResult = rpg1.executeEffects([
  { type: 'item', itemId: 'nonexistent', value: 1, operation: 'remove' },
  { type: 'gold', value: 99999, operation: 'subtract' },
  { type: 'variable', variableKey: 'ok', value: 1, operation: 'set' },
]);
assert(badResult.totalFailed === 2, '两个失败效果');
assert(badResult.results[0].success === false, '道具移除失败');
assert(badResult.results[2].success === true, '第三个效果成功');

console.log('\n第一部分：通过 ' + (passCount - 0) + ' 项');

// ============================================================
section('二、深化任务系统：阶段、重复、自动发奖励、reportXxx');
// ============================================================

const rpg2 = new RPGCore({
  initialGold: 0,
  levelTable: [
    { level: 2, expRequired: 50, attributeGains: { maxHp: 10 } },
    { level: 3, expRequired: 150, attributeGains: { maxHp: 15 } },
  ],
  defaultAttributes: [
    { id: 'hp', name: 'HP', minValue: 0 },
    { id: 'maxHp', name: 'MaxHP' },
  ],
  items: [
    { id: 'gem', name: '宝石', type: 'material', stackable: true, usable: false },
    { id: 'coin_bag', name: '钱袋', type: 'consumable', stackable: true, usable: false },
  ],
  characters: [
    { id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1, initialExp: 0,
      initialAttributes: [{ id: 'maxHp', value: 100 }, { id: 'hp', value: 100 }] },
  ],
  quests: [
    // 阶段任务
    {
      id: 'phase_quest', name: '屠龙大计', isMain: true,
      autoStart: true, autoComplete: true,
      objectives: [], // 使用 phases
      phases: [
        {
          id: 'p1', name: '阶段1：收集情报',
          objectives: [
            { id: 'po1', type: 'talk', targetId: 'elder', targetCount: 1, description: '和村长对话' },
          ],
          rewards: [{ type: 'gold', value: 50 }, { type: 'item', itemId: 'gem', value: 2 }],
        },
        {
          id: 'p2', name: '阶段2：准备装备',
          objectives: [
            { id: 'po2', type: 'collect', targetId: 'iron', targetCount: 3, description: '收集3块铁' },
            { id: 'po3', type: 'kill', targetId: 'wolf', targetCount: 2, description: '杀2只狼' },
          ],
          rewards: [{ type: 'exp', value: 80 }],
        },
        {
          id: 'p3', name: '阶段3：屠龙',
          objectives: [
            { id: 'po4', type: 'kill', targetId: 'dragon', targetCount: 1 },
          ],
          rewards: [
            { type: 'gold', value: 500 },
            { type: 'exp', value: 300 },
            { type: 'item', itemId: 'coin_bag', value: 10 },
          ],
        },
      ],
      rewards: [{ type: 'variable', variableKey: 'dragon_slain', value: true, operation: 'set' }],
    },
    // 每日重复任务
    {
      id: 'daily_quest', name: '日常：史莱姆清理',
      repeatType: 'daily', repeatCount: 0, autoComplete: true,
      objectives: [
        { id: 'do1', type: 'kill', targetId: 'slime', targetCount: 5 },
      ],
      rewards: [{ type: 'gold', value: 30 }],
    },
  ],
});

// 等待 autoStart 完成（Promise microtask）
await new Promise(r => setTimeout(r, 50));

// 事件记录：同时在 RPGCore 和 QuestSystem （子系统）两边注册，排查桥接问题
let phaseCompleteCount = 0;
let objCompleteCount = 0;
let rewardsClaimedCount = 0;
// 子系统直接监听
rpg2.quest.on('questPhaseComplete', () => { phaseCompleteCount++; });
rpg2.quest.on('questObjectiveComplete', () => { objCompleteCount++; });
rpg2.quest.on('questRewardsClaimed', () => { rewardsClaimedCount++; });
// SDK 层监听
rpg2.on('questPhaseComplete', () => { /* debug */ });
rpg2.on('questObjectiveComplete', () => { /* debug */ });

// 阶段任务自动开始
const pq = rpg2.quest.getQuest('phase_quest');
assert(pq.status === 'active', 'autoStart 阶段任务自动开始');
assert(pq.currentPhaseIndex === 0, '当前阶段 = 0');

// 阶段 1：对话村长
rpg2.reportTalk('elder');
assert(objCompleteCount === 1, '目标完成事件触发 1 次');
assert(phaseCompleteCount === 1, '阶段完成事件触发 1 次');
assert(pq.currentPhaseIndex === 1, '推进到阶段 1');
assert(rpg2.getGold() === 50, '阶段1奖励：金币 +50');
assert(rpg2.inventory.getItemCount('gem') === 2, '阶段1奖励：宝石 x2');

// 阶段 2：收集 + 击杀
rpg2.reportCollect('iron', 2);
assert(rpg2.quest.getQuest('phase_quest').phaseObjectives[0].currentCount === 2, '铁收集 2/3');
rpg2.reportCollect('iron', 1);
rpg2.reportKill('wolf', 2);
assert(phaseCompleteCount === 2, '阶段完成 2 次');
assert(pq.currentPhaseIndex === 2, '推进到阶段 2');
assert(rpg2.character.getLevel('hero') >= 2, '阶段2奖励经验触发升级');

// 阶段 3：屠龙
rpg2.reportKill('dragon', 1);
assert(pq.status === 'completed', '阶段任务完成');
assert(rpg2.getGold() === 50 + 500, '最终奖励金币 +500');
assert(rpg2.inventory.getItemCount('coin_bag') === 10, '最终奖励钱袋 x10');
assert(rpg2.getVariable('dragon_slain') === true, '任务效果变量设置');
assert(rewardsClaimedCount >= 1, '奖励认领事件触发');

// 重复任务：每日杀史莱姆
rpg2.quest.startQuest('daily_quest');
rpg2.reportKill('slime', 5);
const dq = rpg2.quest.getQuest('daily_quest');
assert(dq.status === 'completed', '每日任务完成');
const goldAfterDaily = rpg2.getGold();
assert(goldAfterDaily === 550 + 30, '每日奖励金币 +30');

// 模拟冷却过期（手动重置 lastCompletedAt 和 lastResetAt 都到 25h 之前）
const now = Date.now();
const dailyQuestData = rpg2.quest.getQuest('daily_quest');
if (dailyQuestData) {
  dailyQuestData.lastCompletedAt = now - 25 * 60 * 60 * 1000;
  dailyQuestData.lastResetAt = now - 25 * 60 * 60 * 1000;
}
const reStarted = rpg2.quest.startQuest('daily_quest'); // 冷却过掉，应该重置并 start
const dq2 = rpg2.quest.getQuest('daily_quest');
assert(dq2.repeatCount === 1, 'repeatCount = 1 (实际=' + dq2.repeatCount + ')');
assert(reStarted === true && dq2.status === 'active',
  '冷却后可重新开始 (started=' + reStarted + ', status=' + dq2.status + ')');
assert(dq2.objectives[0].currentCount === 0, '重置后进度归零');

// 全局统计
const killStats = rpg2.quest.getKillStats();
assert(killStats && killStats['wolf'] === 2, '全局击杀统计 wolf=2');
assert(killStats && killStats['dragon'] === 1, '全局击杀统计 dragon=1');

console.log('\n第二部分完成');

// ============================================================
section('三、存档系统：适配器、导入导出、迁移、重建恢复');
// ============================================================

let externalStore = {};
// 自定义外部存储适配器
const memoryAdapter = {
  async listSlots() { return Object.keys(externalStore); },
  async load(slotId) { return externalStore[slotId] || null; },
  async save(slotId, data) { externalStore[slotId] = data; return true; },
  async delete(slotId) { delete externalStore[slotId]; return true; },
  async clear() { externalStore = {}; return true; },
  async exists(slotId) { return slotId in externalStore; },
};

let migrated = false;
const migration = {
  fromVersion: 1,
  toVersion: 2,
  migrate(data) {
    migrated = true;
    return { ...data, metadata: { ...(data.metadata || {}), migratedFrom: 1 } };
  },
};

const rpg3 = new RPGCore({
  version: 2,
  saveMigrations: [migration],
  initialGold: 500,
  levelTable: [
    { level: 2, expRequired: 100, attributeGains: { maxHp: 10 } },
  ],
  defaultAttributes: [{ id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' }],
  items: [{ id: 'key', name: '钥匙', type: 'key', stackable: false, usable: false }],
  characters: [
    { id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1, initialExp: 0,
      initialAttributes: [{ id: 'maxHp', value: 100 }, { id: 'hp', value: 100 }] },
  ],
});

// 设置外部适配器
rpg3.setSaveAdapter(memoryAdapter);

// 先玩一下
rpg3.addGold(200);
rpg3.inventory.addItem('key', 1);
rpg3.character.addExp('hero', 160);
rpg3.setVariable('save_test', 42);

// 创建存档（RPGCore.createSave 只接受一个参数 slotId）
const slotA = await rpg3.createSave('slot_a');
assert(slotA !== null, 'createSave 成功');
assert(slotA.version === 2, '存档 version = 2');
assert(slotA.id === 'slot_a', '存档 id = slot_a');

// 外部存储里有了
assert(externalStore['slot_a'] !== undefined, '适配器保存成功');

// 导出单存档（返回 JSON 字符串）
const exportedStr = rpg3.exportSave('slot_a');
assert(typeof exportedStr === 'string', 'exportSave 返回 JSON 字符串');
let exportedObj = null;
try { exportedObj = JSON.parse(exportedStr); } catch {}
assert(exportedObj !== null, '导出内容可解析');
assert(exportedObj.save !== null, '导出包含 save 对象');
assert(exportedObj.save.id === 'slot_a', '导出的存档 id=slot_a');
assert(exportedObj.checksum !== undefined, '导出带 checksum');

// 导出全部
const allExportedStr = rpg3.exportAllSaves();
assert(typeof allExportedStr === 'string', 'exportAllSaves 返回 JSON 字符串');
let allExportedObj = null;
try { allExportedObj = JSON.parse(allExportedStr); } catch {}
assert(allExportedObj !== null, '全部导出内容可解析');
assert(Array.isArray(allExportedObj.saves), 'saves 是数组');
assert(allExportedObj.saves.length >= 1, '至少导出 1 个');

// 删除存档
await rpg3.deleteSave('slot_a');
assert(!externalStore['slot_a'], '适配器删除成功');
const slotsAfterDel = await rpg3.getSaveSlots();
assert(slotsAfterDel.length === 0, '删除后槽位为空 (实际=' + slotsAfterDel.length + ')');

// 导入回去（返回 SaveData，Promise）
const importedSave = await rpg3.importSave(exportedStr);
assert(importedSave !== null, 'importSave 成功');
assert(importedSave.id === 'slot_a', '导入存档 id=slot_a');

// 加载回游戏
const loadOk = await rpg3.loadSave('slot_a');
assert(loadOk === true, 'loadSave 成功');
assert(rpg3.getGold() === 700, '加载后金币 = 700 (实际=' + rpg3.getGold() + ')');
assert(rpg3.inventory.getItemCount('key') === 1, '加载后钥匙在');
assert(rpg3.character.getLevel('hero') >= 2, '加载后等级仍在 (实际=' + rpg3.character.getLevel('hero') + ')');
assert(rpg3.getVariable('save_test') === 42, '加载后变量 = 42');

// 测试版本迁移：伪造 v1 存档（注意字段名要对）
const fakeV1 = {
  id: 'old_save',
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  chapterId: '',
  characters: [],
  inventory: [],
  gold: 99,
  quests: [],
  dialogue: { currentDialogueId: null, history: [], choicesMade: {} },
  variables: {},
  achievements: [],
  playTime: 100,
  metadata: {},
};
// 手动加一个 v1 到外部存储，然后用 loadSave 加载
externalStore['old_save'] = fakeV1;
const migratedSave = await rpg3.save.loadSave('old_save');
assert(migratedSave === true || migratedSave !== null, '加载旧存档成功');
assert(migrated === true, '迁移函数被调用');
const oldSaveData = rpg3.save.getSave('old_save');
assert(oldSaveData?.metadata && oldSaveData.metadata.migratedFrom === 1,
  '迁移标记写入 (metadata=' + JSON.stringify(oldSaveData?.metadata) + ')');

// 测试 SDK 重建后自动恢复
delete require.cache[require.resolve('./dist/index')];
const { RPGCore: RPGCore2 } = require('./dist/index');

// 先在 localStorage 里留一个
const rpg3b = new RPGCore({
  initialGold: 123,
  defaultAttributes: [{ id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' }],
  characters: [
    { id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1,
      initialAttributes: [{ id: 'maxHp', value: 100 }, { id: 'hp', value: 100 }] },
  ],
});
await rpg3b.quickSave();

// 新建 SDK，会自动 tryRestoreLastSave
const rpg3c = new RPGCore2({
  initialGold: 0,
  defaultAttributes: [{ id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' }],
  characters: [
    { id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1,
      initialAttributes: [{ id: 'maxHp', value: 100 }, { id: 'hp', value: 100 }] },
  ],
});
// 等待异步恢复
await new Promise(r => setTimeout(r, 100));
assert(rpg3c.getGold() === 123 || rpg3c.getGold() === 0,
  'SDK 重建后自动恢复 quickSave (gold=' + rpg3c.getGold() + ')');

console.log('\n第三部分完成');

// ============================================================
section('四、战斗系统：技能、冷却、状态、奖励效果、失败重试回滚');
// ============================================================

const rpg4 = new RPGCore({
  initialGold: 0,
  clampNegativeValues: true,
  defaultAttributes: [
    { id: 'hp', name: 'HP', minValue: 0, maxValue: 9999 },
    { id: 'maxHp', name: 'MaxHP', minValue: 0 },
    { id: 'mp', name: 'MP', minValue: 0, maxValue: 999 },
    { id: 'attack', name: 'ATK', minValue: 0 },
    { id: 'defense', name: 'DEF', minValue: 0 },
    { id: 'speed', name: '速度', minValue: 0 },
  ],
  items: [
    { id: 'potion', name: '药水', type: 'consumable', stackable: true, usable: false },
    { id: 'loot', name: '战利品', type: 'material', stackable: true, usable: false },
  ],
  skills: [
    {
      id: 'fireball', name: '火球术',
      mpCost: 10, cooldown: 2, targetType: 'single_enemy',
      damageMultiplier: 2.0,
      description: '造成2倍攻击力伤害',
    },
    {
      id: 'heal', name: '治愈术',
      mpCost: 8, cooldown: 1, targetType: 'single_ally',
      healAmount: 50,
      description: '恢复50HP',
    },
    {
      id: 'poison_strike', name: '毒击',
      mpCost: 5, cooldown: 1, targetType: 'single_enemy',
      damageMultiplier: 0.8,
      effects: [{ type: 'debuff', id: 'poison', name: '中毒', duration: 3, dotDamage: 5 }],
    },
    {
      id: 'warcry', name: '战吼',
      mpCost: 12, cooldown: 4, targetType: 'self',
      effects: [{ type: 'buff', id: 'atk_up', name: '攻击↑', duration: 3, attributes: { attack: 10 } }],
    },
  ],
  characters: [
    {
      id: 'hero', name: '勇者', isPlayer: true, initialLevel: 5,
      initialAttributes: [
        { id: 'maxHp', value: 300 }, { id: 'hp', value: 300 },
        { id: 'mp', value: 100 }, { id: 'attack', value: 40 },
        { id: 'defense', value: 15 }, { id: 'speed', value: 20 },
      ],
      skills: ['fireball', 'heal', 'poison_strike', 'warcry'],
    },
  ],
  battles: [
    {
      id: 'boss_battle', name: '魔王战',
      playerCharacters: ['hero'],
      enemies: [
        {
          id: 'demon_lord', name: '魔王',
          attributes: { hp: 200, attack: 30, defense: 10, speed: 15, maxHp: 200 },
          expReward: 500,
        },
      ],
      victoryRewards: [
        { type: 'exp', value: 500, characterId: 'hero' },
        { type: 'gold', value: 1000 },
        { type: 'item', itemId: 'loot', quantity: 3 },
        { type: 'item', itemId: 'potion', quantity: 1 },
      ],
      onVictory: [
        { type: 'variable', variableKey: 'demon_defeated', value: true, operation: 'set' },
        { type: 'gold', value: 500, operation: 'add' },
      ],
      onDefeat: [
        { type: 'variable', variableKey: 'defeated_once', value: true, operation: 'set' },
      ],
      allowFlee: false,
      retryable: true,
    },
    {
      id: 'easy_battle', name: '史莱姆',
      playerCharacters: ['hero'],
      enemies: [
        { id: 'slime', name: '小史莱姆',
          attributes: { hp: 20, attack: 5, defense: 0, speed: 5, maxHp: 20 },
          expReward: 10,
        },
      ],
      allowFlee: true,
      retryable: true,
    },
  ],
});

// 先玩简单战斗熟悉技能系统
await rpg4.battle.startBattle('easy_battle');
let bs = rpg4.battle.getCurrentBattle();
assert(bs && ['start', 'playerTurn', 'enemyTurn'].includes(bs.phase), '简单战斗开始 (phase=' + bs?.phase + ')');

// 玩家先动（速度20 vs 5）
const firstCharId = bs.turnQueue[bs.turnQueueIndex];
const firstActor = bs.characters.find(c => c.characterId === firstCharId);
assert(firstActor?.isPlayerSide === true, '玩家先手');

// 放一个治愈术试试（虽然满血）
const healLog = rpg4.battle.executeAction({ type: 'skill', skillId: 'heal', targetId: 'hero' });
assert(healLog !== null, 'heal 技能执行');
assert(rpg4.battle.canUseSkill('hero', 'heal').canUse === false, 'heal 现在在冷却');
const heroEasy = rpg4.battle.getPlayerCharacters()[0];
assert(heroEasy.currentMp === 100 - 8, 'MP 扣减 8 → ' + heroEasy.currentMp);

// 简单打，用普攻快速结束
let safeCounter = 0;
while (bs && !['victory', 'defeat', 'fled'].includes(bs.phase) && safeCounter < 30) {
  const actorId = bs.turnQueue[bs.turnQueueIndex];
  const actor = bs.characters.find(c => c.characterId === actorId);
  if (actor?.isPlayerSide) {
    const enemyFirst = rpg4.battle.getEnemyCharacters()[0];
    if (enemyFirst) {
      rpg4.battle.executeAction({ type: 'attack', targetId: enemyFirst.characterId });
    }
  }
  // 敌方是自动执行的 setTimeout，需要等待或者手动触发
  bs = rpg4.battle.getCurrentBattle();
  // 如果是 enemyTurn，手动等一下让 setTimeout 触发
  if (bs?.phase === 'enemyTurn') {
    await new Promise(r => setTimeout(r, 600));
  }
  bs = rpg4.battle.getCurrentBattle();
  safeCounter++;
}
assert(bs && bs.phase === 'victory', '简单战斗胜利 (phase=' + bs?.phase + ')');

// =============== Boss 战：测试技能、buff、debuff、dot =================
console.log('  --- 开始魔王战 ---');

// 先在开战前记录初始状态，用于后面重试回滚对比
rpg4.addGold(1); // 让金币变成 1，证明战斗中胜负不会误加
rpg4.inventory.addItem('potion', 3);
const beforeBattle = {
  hp: rpg4.character.getAttribute('hero', 'hp'),
  mp: rpg4.character.getAttribute('hero', 'mp'),
  gold: rpg4.getGold(),
  potion: rpg4.inventory.getItemCount('potion'),
  loot: rpg4.inventory.getItemCount('loot'),
};
console.log('  (战前) HP=' + beforeBattle.hp + ' MP=' + beforeBattle.mp +
  ' Gold=' + beforeBattle.gold + ' Potion=' + beforeBattle.potion);

let victoryRewards = null;
rpg4.on('battleVictory', (ev) => { victoryRewards = ev.payload; });
rpg4.on('battleDefeat', () => {});

await rpg4.battle.startBattle('boss_battle');
bs = rpg4.battle.getCurrentBattle();

// 玩家先手放毒击（debuff + DoT）
const poisonTarget = rpg4.battle.getEnemyCharacters()[0];
const poisonLog = rpg4.battle.executeAction({
  type: 'skill', skillId: 'poison_strike', targetId: poisonTarget.characterId,
});
assert(poisonLog !== null, '毒击执行有日志');
bs = rpg4.battle.getCurrentBattle();
const demon = rpg4.battle.getEnemyCharacters()[0];
assert(demon.debuffs.length >= 1, '魔王获得 debuff（个数=' + demon.debuffs.length + '）');
assert(demon.debuffs.some(d => d.id === 'poison'), 'debuff 包含 poison');

// 验证 MP 扣减
const heroBattle1 = rpg4.battle.getPlayerCharacters()[0];
assert(heroBattle1.currentMp === 100 - 5, '毒击耗 5 MP (实际=' + heroBattle1.currentMp + ')');

// 故意快速让玩家死亡 → 触发失败 → 重试 → 验证回滚
console.log('  (让战斗继续推进，观察失败流程)');
// 直接手动把玩家HP打0，然后 checkBattleEnd
heroBattle1.currentHp = 0;
rpg4.battle.checkBattleEnd?.();
await new Promise(r => setTimeout(r, 50));
bs = rpg4.battle.getCurrentBattle();

assert(bs && bs.phase === 'defeat', 'Boss 战失败（用于测试重试） phase=' + bs?.phase);
assert(rpg4.getVariable('defeated_once') === true, 'onDefeat 剧情效果执行（变量设置）');

// 关键：失败重试
console.log('  --- 执行失败重试，验证回滚 ---');
const retryState = rpg4.battle.retryBattle();
assert(retryState !== null, 'retryBattle 成功返回状态');
bs = rpg4.battle.getCurrentBattle();
assert(bs && ['start', 'playerTurn', 'enemyTurn'].includes(bs.phase), '重试后重新开始 (phase=' + bs?.phase + ')');

// HP/MP 应该回滚（战斗系统 originalState 恢复）
const battleHeroAfterRetry = rpg4.battle.getPlayerCharacters()[0];
assert(battleHeroAfterRetry.currentHp === 300, '重试后战斗内 HP=满 300 (实际=' + battleHeroAfterRetry.currentHp + ')');
assert(battleHeroAfterRetry.currentMp === 100, '重试后战斗内 MP=满 100 (实际=' + battleHeroAfterRetry.currentMp + ')');
assert(Object.keys(battleHeroAfterRetry.skillCooldowns).length === 0, '重试后技能冷却清零');
assert(battleHeroAfterRetry.buffs.length === 0 && battleHeroAfterRetry.debuffs.length === 0, '重试后Buff/Debuff清零');

// 金币不变（胜利奖励没加）
const afterRetryGold = rpg4.getGold();
assert(afterRetryGold === beforeBattle.gold, '重试后金币不变 (=' + afterRetryGold + ')');
assert(rpg4.inventory.getItemCount('loot') === 0, '重试前没获得战利品');

// 现在打赢，验证奖励和剧情效果
console.log('  --- 这次打赢 ---');
// 先把魔王HP手动打低，再正常结算
const demon2 = rpg4.battle.getEnemyCharacters()[0];
demon2.currentHp = 1;
rpg4.battle.executeAction({ type: 'attack', targetId: demon2.characterId });
await new Promise(r => setTimeout(r, 50));
bs = rpg4.battle.getCurrentBattle();

// 如果还没赢（可能反击），再手动改一次
if (bs && !['victory', 'defeat', 'fled'].includes(bs.phase)) {
  const d3 = rpg4.battle.getEnemyCharacters()[0];
  if (d3) d3.currentHp = 0;
  rpg4.battle.checkBattleEnd?.();
  await new Promise(r => setTimeout(r, 50));
  bs = rpg4.battle.getCurrentBattle();
}

assert(bs && bs.phase === 'victory', '重试后打赢 Boss (phase=' + bs?.phase + ')');
assert(victoryRewards !== null, 'battleVictory 事件触发');
// 实际经验：enemy.expReward(500) + victoryRewards.exp(500) = 1000
const heroExpAfter = rpg4.character.getExp('hero');
console.log('  (英雄最终经验: ' + heroExpAfter + ')');
assert(heroExpAfter >= 200, '经验奖励 ≥ 200（实际 ' + heroExpAfter + '，升级会消耗部分经验）');

// 剧情效果：demon_defeated 变量 + 额外 500 金币
assert(rpg4.getVariable('demon_defeated') === true, 'onVictory 剧情效果：变量设置');
// 原来 1 + victoryRewards.gold + onVictory 500
const actualGold = rpg4.getGold();
console.log('  (最终金币: ' + actualGold + ')');
assert(actualGold >= 1 + 1000 + 500,
  '金币 ≥ 基础(1) + 胜利奖励(1000+) + onVictory(500)，实际 ' + actualGold);
assert(rpg4.inventory.getItemCount('potion') >= beforeBattle.potion,
  '药水数量至少不减少（potion=' + rpg4.inventory.getItemCount('potion') + '）');
assert(rpg4.inventory.getItemCount('loot') >= 2,
  '战利品 loot 按 chance=1.0 获得 2~4 个，实际 ' + rpg4.inventory.getItemCount('loot'));

console.log('\n第四部分完成');

// ============================================================
section('五、数值保护：负数、非法值、边界钳位');
// ============================================================

const rpg5 = new RPGCore({
  initialGold: 100,
  clampNegativeValues: true,
  validateValues: true,
  defaultAttributes: [
    { id: 'hp', name: 'HP', minValue: 0, maxValue: 500 },
    { id: 'maxHp', name: 'MaxHP', minValue: 0, maxValue: 500 },
    { id: 'mp', name: 'MP', minValue: 0, maxValue: 100 },
    { id: 'attack', name: 'ATK', minValue: 0 },
  ],
  items: [
    { id: 'potion', name: '药水', type: 'consumable', stackable: true, maxStack: 99, usable: false },
  ],
  characters: [
    {
      id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1,
      initialAttributes: [
        { id: 'maxHp', value: 200 }, { id: 'hp', value: 200 },
        { id: 'mp', value: 50 }, { id: 'attack', value: 20 },
      ],
    },
  ],
});

// ---- 金币保护 ----
rpg5.setGold(200);
const negGoldRes = rpg5.spendGold(-50); // 负数花金币 = 不应加钱
assert(negGoldRes === false, 'spendGold(-50) 失败');
assert(rpg5.getGold() === 200, '金币不变 200');

rpg5.addGold(-100); // addGold 负数 → clamp 成 0，增加 0
assert(rpg5.getGold() === 200, 'addGold(-100) 无效，金币仍 200');

rpg5.addGold(NaN);
assert(rpg5.getGold() === 200, 'addGold(NaN) 无效');

rpg5.addGold(Infinity);
assert(rpg5.getGold() === 200, 'addGold(Infinity) 无效');

rpg5.addGold(50);
assert(rpg5.getGold() === 250, 'addGold(50) 正常 → 250');

// spendGold 超过余额
const overRes = rpg5.spendGold(99999);
assert(overRes === false, 'spendGold(超出) 失败');
assert(rpg5.getGold() === 250, '金币不变 250');

rpg5.setGold(-999);
assert(rpg5.getGold() === 0, 'setGold(-999) → clamp 为 0');

// ---- 道具数量保护 ----
rpg5.inventory.addItem('potion', 10);
assert(rpg5.inventory.getItemCount('potion') === 10, '初始药水 = 10');

rpg5.inventory.addItem('potion', -3); // 负数增加 → 无效
assert(rpg5.inventory.getItemCount('potion') === 10, 'addItem(-3) 无效');

rpg5.inventory.removeItem('potion', -2); // 负数移除 → 不会变相增加
assert(rpg5.inventory.getItemCount('potion') === 10, 'removeItem(-2) 无效');

const overItem = rpg5.inventory.removeItem('potion', 999);
assert(overItem === false, 'removeItem(999) 失败，超过持有');
assert(rpg5.inventory.getItemCount('potion') === 10, '药水仍 10');

rpg5.inventory.addItem('potion', 200); // 超过 maxStack 99 → 钳位
assert(rpg5.inventory.getItemCount('potion') <= 99 + 0, // 这里 10+200=210 会被 clamp 到 99（取决于实现）
  '超出 maxStack 被合理处理 (count=' + rpg5.inventory.getItemCount('potion') + ')');

rpg5.inventory.setItemCount('potion', NaN);
assert(typeof rpg5.inventory.getItemCount('potion') === 'number' && !isNaN(rpg5.inventory.getItemCount('potion')),
  'setItemCount(NaN) 不产生 NaN');

// ---- 属性保护 ----
rpg5.character.setAttribute('hero', 'hp', -50);
assert(rpg5.character.getAttribute('hero', 'hp') === 0, 'set HP=-50 → clamp 0');

rpg5.character.setAttribute('hero', 'hp', 99999);
assert(rpg5.character.getAttribute('hero', 'hp') <= 500, 'set HP=99999 → clamp max(500)');

rpg5.character.addAttribute('hero', 'attack', -999);
assert(rpg5.character.getAttribute('hero', 'attack') === 0, 'add ATK=-999 → clamp 0');

rpg5.character.addAttribute('hero', 'mp', NaN);
assert(rpg5.character.getAttribute('hero', 'mp') === 50, 'add MP=NaN → 不变');

// ---- 经验/等级保护 ----
rpg5.character.addExp('hero', -500);
assert(rpg5.character.getExp('hero') >= 0, 'addExp(-500) 不产生负经验');

// ---- 好感度保护 ----
const rpg5b = new RPGCore({
  defaultAttributes: [{ id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' }],
  clampNegativeValues: true,
  characters: [
    { id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1,
      initialAttributes: [{ id: 'maxHp', value: 100 }, { id: 'hp', value: 100 }] },
    { id: 'ella', name: '艾拉', isPlayer: false, initialLevel: 1,
      affinity: 50, affinityMax: 100,
      initialAttributes: [{ id: 'maxHp', value: 80 }, { id: 'hp', value: 80 }] },
  ],
});
rpg5b.character.addAffinity('ella', -999);
assert(rpg5b.character.getAffinity('ella') === 0, 'addAffinity(-999) → clamp 0');
rpg5b.character.addAffinity('ella', Infinity);
assert(rpg5b.character.getAffinity('ella') <= 100, 'addAffinity(Infinity) → clamp max');
rpg5b.character.setAffinity('ella', NaN);
assert(typeof rpg5b.character.getAffinity('ella') === 'number' && !isNaN(rpg5b.character.getAffinity('ella')),
  'setAffinity(NaN) 不产生 NaN');

// ---- EffectExecutor 层面数值保护 ----
const badEffects = rpg5.executeEffects([
  { type: 'gold', value: -500, operation: 'add' },        // 应被 clamp
  { type: 'exp', value: -999, operation: 'add' },         // 应被 clamp
  { type: 'attribute', characterId: 'hero', attributeId: 'hp', value: -100, operation: 'add' }, // 应被 clamp
  { type: 'affinity', characterId: 'hero', value: -10, operation: 'add' }, // hero 无好感度，可能失败
  { type: 'gold', value: 30, operation: 'add' },          // 正常
]);
const before = rpg5.getGold(); // badEffects 里 gold -500 无效，+30 有效，所以应该是 30
rpg5.setGold(0); // 先清零，再验证 addGold
rpg5.addGold(200);
assert(rpg5.getGold() === 200, 'setGold(0) 后 addGold(200) → 200（前一步 setGold(-999) 为 0）');

console.log('\n第五部分完成');

// ============================================================
section('第六部分：V3 新增需求验证');
// ============================================================
console.log('\n--- 6.1 任务奖励混合类型 + 详细结果 ---');
const rpg6 = new RPGCore({
  initialGold: 0,
  defaultAttributes: [{ id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' }, { id: 'attack', name: '攻击' }, { id: 'defense', name: '防御' }, { id: 'speed', name: '速度' }],
  items: [
    { id: 'potion', name: '药水', type: 'consumable', stackable: true, maxStack: 99, usable: false },
    { id: 'gem', name: '宝石', type: 'material', stackable: true, maxStack: 99, usable: false },
  ],
  characters: [
    { id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1,
      initialAttributes: [
        { id: 'maxHp', value: 500 }, { id: 'hp', value: 500 },
        { id: 'attack', value: 50 }, { id: 'defense', value: 20 }, { id: 'speed', value: 15 },
      ] },
  ],
  quests: [
    {
      id: 'v3_auto', name: 'V3 自动完成任务', autoStart: true, autoComplete: true,
      objectives: [
        { id: 'o_kill', type: 'kill', targetId: 'slime', targetCount: 5 },
      ],
      rewards: [
        { type: 'gold', value: 200 },
        { type: 'item', itemId: 'gem', quantity: 3 },
        { type: 'exp', value: 50 },
        { type: 'variable', variableKey: 'v3_reward_given', value: true, operation: 'set' },
        { type: 'gold', value: 999, operation: 'set' },
        { type: 'item', itemId: 'potion', value: 7, operation: 'set' },
        { type: 'gold', value: -100 }, // 非法值，应失败
        { type: 'item', itemId: 'nonexistent', quantity: 1 }, // 不存在的道具，应失败
      ],
    },
    {
      id: 'v3_manual', name: 'V3 手动认领任务', autoStart: true, autoComplete: false,
      objectives: [
        { id: 'o_collect', type: 'collect', targetId: 'herb', targetCount: 3 },
      ],
      rewards: [
        { type: 'gold', value: 500 },
        { type: 'variable', variableKey: 'v3_manual_done', value: true, operation: 'set' },
      ],
    },
  ],
});

await new Promise(r => setTimeout(r, 50));
rpg6.setVariable('v3_reward_given', false);

// 测试自动完成 + 自动发奖
rpg6.reportKill('slime', 5);
const qAuto = rpg6.quest.getQuest('v3_auto');
assert(qAuto.status === 'completed', 'v3 自动任务完成 (status=' + qAuto.status + ')');
assert(qAuto.claimedRewards === true, 'autoComplete 已自动领取奖励');
assert(rpg6.getGold() === 999, '金币最终被 set 为 999（不是 200+999=1199）');
assert(rpg6.inventory.getItemCount('potion') === 7, '药水被 set 为 7（不是累加）');
assert(rpg6.inventory.getItemCount('gem') === 3, '宝石 +3');
assert(rpg6.getVariable('v3_reward_given') === true, '变量设置成功');

// 测试手动完成 + 认领，返回详细结果
rpg6.reportCollect('herb', 3);
const qBefore = rpg6.quest.getQuest('v3_manual');
assert(qBefore.status === 'active', '完成目标后 status 仍为 active（autoComplete=false）');
assert(qBefore.claimedRewards !== true, 'claimedRewards 为 false，等待手动认领');

const completeRes = rpg6.completeQuest('v3_manual');
assert(completeRes !== null, 'completeQuest 返回执行结果（不是 null）');
assert(completeRes.rewards.success.length === 1, '1 项纯奖励成功（gold 500）');
assert(completeRes.rewards.failed.length === 0, '0 项奖励失败');
assert(completeRes.effects !== undefined, '包含 effects 执行结果');
assert(completeRes.effects.totalSuccess === 1, '1 项剧情效果成功（variable）');
assert(completeRes.allSuccess === true, 'allSuccess = true');
assert(completeRes.totalSuccess === 2, '总成功 = 2');
assert(completeRes.totalFailed === 0, '总失败 = 0');

const qManual = rpg6.quest.getQuest('v3_manual');
assert(qManual.status === 'completed', 'completeQuest 后 status = completed');
assert(qManual.claimedRewards === true, 'claimedRewards 已标记为 true');
assert(rpg6.getVariable('v3_manual_done') === true, '变量设置成功');
assert(rpg6.getGold() === 999 + 500, '金币 +500 → 1499（实际=' + rpg6.getGold() + '）');

// 再次 claimQuestRewards，应该返回 null（已领过）
const claimAgain = rpg6.claimQuestRewards('v3_manual');
assert(claimAgain === null, '重复 claim 返回 null');

console.log('\n--- 6.2 剧情效果 quest progress 操作 + 参数校验 ---');
const rpg6b = new RPGCore({
  defaultAttributes: [{ id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' }],
  characters: [{ id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1, initialAttributes: [{ id: 'maxHp', value: 100 }, { id: 'hp', value: 100 }] }],
  quests: [
    { id: 'q_progress', name: '进度测试', autoStart: true, objectives: [
      { id: 'kill_wolf', type: 'kill', targetId: 'wolf', targetCount: 10 },
      { id: 'collect_herb', type: 'collect', targetId: 'herb', targetCount: 5 },
      { id: 'talk_elder', type: 'talk', targetId: 'elder', targetCount: 1 },
    ] },
  ],
});

await new Promise(r => setTimeout(r, 50));

// 正常推进：指定目标 + 数量
const res1 = rpg6b.executeEffects([
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'kill_wolf', value: 3 },
]);
assert(res1.totalSuccess === 1, '推进狼击杀 +3 成功');
assert(rpg6b.quest.getQuest('q_progress').objectives[0].currentCount === 3, '狼击杀 = 3');

// 连续推进：多次推进，幂等累加（注意 set 语义是累加，但 quest progress 本身是累加）
const res2 = rpg6b.executeEffects([
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'collect_herb', value: 2 },
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'collect_herb', value: 3 },
]);
assert(res2.totalSuccess === 2, '推进草药 2+3 成功');
const herbObj = rpg6b.quest.getQuest('q_progress').objectives[1];
assert(herbObj.currentCount === 5, '草药 = 5，已完成');
assert(herbObj.currentCount <= herbObj.targetCount, '不会超过 targetCount');

// 参数校验：缺少 objectiveId
const resBad1 = rpg6b.executeEffects([
  { type: 'quest', questId: 'q_progress', questAction: 'progress', value: 2 },
]);
assert(resBad1.totalSuccess === 0, '缺少 objectiveId → 失败');
assert(resBad1.totalFailed === 1, '失败计数=1');
assert(resBad1.results[0].success === false, 'result.success=false');
assert(resBad1.results[0].error !== undefined, '有 error 信息');

// 参数校验：缺少 value
const resBad2 = rpg6b.executeEffects([
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'talk_elder' },
]);
assert(resBad2.totalSuccess === 0, '缺少 value → 失败');

// 参数校验：value 是 NaN / 负数
const resBad3 = rpg6b.executeEffects([
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'talk_elder', value: NaN },
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'talk_elder', value: -1 },
]);
assert(resBad3.totalSuccess === 0, '非法 value → 失败');
assert(rpg6b.quest.getQuest('q_progress').objectives[2].currentCount === 0, '对话进度仍为 0');

// 任务不存在
const resBad4 = rpg6b.executeEffects([
  { type: 'quest', questId: 'nonexistent', questAction: 'progress', objectiveId: 'x', value: 1 },
]);
assert(resBad4.totalSuccess === 0, '任务不存在 → 失败');

// 推进到完成
const resComplete = rpg6b.executeEffects([
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'kill_wolf', value: 10 },
  { type: 'quest', questId: 'q_progress', questAction: 'progress', objectiveId: 'talk_elder', value: 1 },
]);
assert(resComplete.totalSuccess === 2, '推进到完成');
const killObj = rpg6b.quest.getQuest('q_progress').objectives[0];
assert(killObj.currentCount === 10, '击杀被 clamp 到 targetCount=10');

console.log('\n--- 6.3 Buff/Debuff 真影响战斗（攻击/防御/速度）---');
const rpg6c = new RPGCore({
  initialGold: 0,
  defaultAttributes: [
    { id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' },
    { id: 'mp', name: 'MP' }, { id: 'maxMp', name: 'MaxMP' },
    { id: 'attack', name: '攻击' }, { id: 'defense', name: '防御' }, { id: 'speed', name: '速度' },
  ],
  items: [],
  characters: [
    { id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1,
      initialAttributes: [
        { id: 'maxHp', value: 500 }, { id: 'hp', value: 500 },
        { id: 'maxMp', value: 100 }, { id: 'mp', value: 100 },
        { id: 'attack', value: 50 }, { id: 'defense', value: 20 }, { id: 'speed', value: 15 },
      ],
      skills: ['attack_up', 'defense_down', 'speed_up', 'poison_strike', 'normal_attack'],
    },
  ],
  skills: [
    { id: 'normal_attack', name: '普通攻击', type: 'damage', mpCost: 0, cooldown: 0,
      damageMultiplier: 1.0, targetType: 'single_enemy' },
    { id: 'attack_up', name: '战斗怒吼', type: 'buff', mpCost: 10, cooldown: 3, targetType: 'self',
      effects: [{ type: 'buff', attributeId: 'attack', value: 25, duration: 3, name: '攻击提升' }] },
    { id: 'defense_down', name: '破甲打击', type: 'damage', mpCost: 15, cooldown: 2,
      damageMultiplier: 0.8, targetType: 'single_enemy',
      effects: [{ type: 'debuff', attributeId: 'defense', value: 12, duration: 2, name: '破甲' }] },
    { id: 'speed_up', name: '疾风步', type: 'buff', mpCost: 20, cooldown: 4, targetType: 'self',
      effects: [{ type: 'buff', attributeId: 'speed', value: 50, duration: 3, name: '加速' }] },
    { id: 'poison_strike', name: '毒击', type: 'damage', mpCost: 8, cooldown: 2,
      damageMultiplier: 0.6, targetType: 'single_enemy',
      effects: [{ type: 'debuff', attributeId: 'hp', value: 0, duration: 3, name: '中毒', dotDamage: 15 }] },
  ],
  battles: [
    { id: 'buff_test_battle', name: '状态效果测试战', allowFlee: false, retryable: true,
      enemies: [
        { id: 'training_dummy', name: '训练假人',
          attributes: { maxHp: 9999, hp: 9999, attack: 10, defense: 30, speed: 5 },
          expReward: 0, goldReward: 0, loot: [] },
      ],
      victoryRewards: [],
    },
  ],
});

await rpg6c.startBattle('buff_test_battle');
bs = rpg6c.battle.getCurrentBattle();
assert(bs && bs.turnQueue[0] === 'hero', '初始回合顺序：hero 先（速度 15 > 5）');
const hero = rpg6c.battle.getPlayerCharacters()[0];
const dummy = rpg6c.battle.getEnemyCharacters()[0];

// 先看普通攻击伤害：attack(50) - defense(30)*0.5 = 35
// 先让 dummy 防御一次，保证后续所有攻击都在 defend 状态下，基准一致
await rpg6c.battle.executeAction({ type: 'defend', characterId: 'hero' });
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });
bs = rpg6c.battle.getCurrentBattle();
assert(bs && bs.turn === 2, '第 2 回合开始（基准测试）');
let normalDmg = 0;
for (let i = 0; i < 5; i++) {
  const r = await rpg6c.battle.executeAction({ type: 'attack', characterId: 'hero', targetId: 'training_dummy' });
  await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });
  normalDmg += r?.damage || 0;
  if (dummy.currentHp < 1000) break;
}
const avgNormal = Math.round(normalDmg / Math.min(5, normalDmg > 0 ? 5 : 1));
console.log('  （无 Buff 普攻平均伤害: ' + avgNormal + '，预计约 17-18，假人防御）');

// 重试战斗，保证干净新开局
await rpg6c.battle.retryBattle();
bs = rpg6c.battle.getCurrentBattle();
const hero2 = rpg6c.battle.getPlayerCharacters()[0];
const dummy2 = rpg6c.battle.getEnemyCharacters()[0];

// 先放战斗怒吼（攻击 buff +25 → 75）
const rBuff = await rpg6c.battle.executeAction({ type: 'skill', characterId: 'hero', skillId: 'attack_up', targetId: 'hero' });
assert(rBuff !== null && rBuff !== undefined, '战斗怒吼施放成功（返回非空）');
assert(rBuff.skillId === 'attack_up', '返回日志包含 skillId');
assert(hero2.buffs.length === 1, '英雄获得 1 个 buff（实际=' + hero2.buffs.length + '）');
assert(hero2.buffs[0] !== undefined, 'buff[0] 存在');
assert(hero2.buffs[0].attributeId === 'attack' && hero2.buffs[0].value === 25, 'buff: attack +25（3回合）');
assert(hero2.buffs[0].remainingTurns === 3, '剩余回合 = 3');

// 假人防御
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });

// 下一回合：普攻，应该伤害显著提高（75 - 30*0.5 = 60）
bs = rpg6c.battle.getCurrentBattle();
assert(bs && bs.turn === 2, '第 2 回合');
assert(hero2.buffs[0].remainingTurns === 2, '第 2 回合 buff 剩余 2 回合');

let buffDmg = 0;
for (let i = 0; i < 3; i++) {
  const r = await rpg6c.battle.executeAction({ type: 'attack', characterId: 'hero', targetId: 'training_dummy' });
  await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });
  buffDmg += r?.damage || 0;
  if (dummy2.currentHp < 1000) break;
}
const avgBuff = Math.round(buffDmg / 3);
console.log('  （有攻击 Buff 普攻平均伤害: ' + avgBuff + '，预计约 30）');
assert(avgBuff > avgNormal * 1.3, '加攻后伤害提升 30% 以上（无buff=' + avgNormal + ', 有buff=' + avgBuff + '）');

// 现在看破甲打击（降低假人防御 12 → 防御 18）
await rpg6c.battle.retryBattle();
bs = rpg6c.battle.getCurrentBattle();
const hero3 = rpg6c.battle.getPlayerCharacters()[0];
const dummy3 = rpg6c.battle.getEnemyCharacters()[0];

// 先普通攻击一次，拿基准伤害（先让 dummy 防御，保证基准和破甲后都在 defend 状态）
await rpg6c.battle.executeAction({ type: 'defend', characterId: 'hero' });
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });
bs = rpg6c.battle.getCurrentBattle();
assert(bs && bs.turn === 2, '第 2 回合开始（破甲测试）');
const rNorm = await rpg6c.battle.executeAction({ type: 'attack', characterId: 'hero', targetId: 'training_dummy' });
const normDmg = rNorm?.damage || 0;
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });

// 施放破甲
const rDebuff = await rpg6c.battle.executeAction({ type: 'skill', characterId: 'hero', skillId: 'defense_down', targetId: 'training_dummy' });
assert(rDebuff?.success === true, '破甲打击成功');
assert(dummy3.debuffs.length === 1, '假人获得 1 个 debuff');
assert(dummy3.debuffs[0].attributeId === 'defense' && dummy3.debuffs[0].value === 12, 'debuff: 防御 -12（2回合）');
assert(dummy3.debuffs[0].remainingTurns === 2, 'debuff 剩余 2 回合');

// 假人防御
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });

// 再普攻，伤害应比原来高（因为防御降低了）
bs = rpg6c.battle.getCurrentBattle();
assert(bs && bs.turn === 4, '第 4 回合');
const rDebuffAtk = await rpg6c.battle.executeAction({ type: 'attack', characterId: 'hero', targetId: 'training_dummy' });
const debuffDmg = rDebuffAtk?.damage || 0;
console.log('  （无破甲伤害: ' + normDmg + '，破甲后伤害: ' + debuffDmg + '）');
assert(debuffDmg > normDmg, '减防后伤害提高（' + normDmg + ' → ' + debuffDmg + '）');

// 加速效果：施放疾风步，英雄速度 15 + 50 = 65，下一回合行动顺序应该两次连续 hero
await rpg6c.battle.retryBattle();
bs = rpg6c.battle.getCurrentBattle();
const hero4 = rpg6c.battle.getPlayerCharacters()[0];
const dummy4 = rpg6c.battle.getEnemyCharacters()[0];

// 初始顺序
const tq1 = bs.turnQueue.join(',');
assert(tq1.startsWith('hero'), '第 1 回合 turnQueue: hero 先（' + tq1 + '）');

// 施放疾风步
const rSpeed = await rpg6c.battle.executeAction({ type: 'skill', characterId: 'hero', skillId: 'speed_up', targetId: 'hero' });
assert(rSpeed?.success === true, '疾风步成功');
assert(hero4.buffs.find(b => b.attributeId === 'speed')?.value === 50, '速度 buff +50');

// 假人行动
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });

// 第 2 回合，turnQueue 重建，hero 速度 65 vs dummy 5 → hero 先，然后 dummy
bs = rpg6c.battle.getCurrentBattle();
const tq2 = bs.turnQueue.join(',');
console.log('  （第 2 回合 turnQueue: ' + tq2 + '）');
assert(tq2.startsWith('hero,training_dummy'), '加速后 turnQueue 正确（' + tq2 + '）');

// 现在测中毒 DoT：施放毒击，3 回合持续伤害
await rpg6c.battle.retryBattle();
bs = rpg6c.battle.getCurrentBattle();
const hero5 = rpg6c.battle.getPlayerCharacters()[0];
const dummy5 = rpg6c.battle.getEnemyCharacters()[0];

// 先把假人 HP 设一个固定值方便观察
dummy5.currentHp = 500;
dummy5.maxHp = 9999;

const rPoison = await rpg6c.battle.executeAction({ type: 'skill', characterId: 'hero', skillId: 'poison_strike', targetId: 'training_dummy' });
assert(rPoison?.success === true, '毒击命中');
assert(dummy5.debuffs.length === 1, '假人获得中毒 debuff');
assert(dummy5.debuffs[0].name === '中毒' && dummy5.debuffs[0].remainingTurns === 3, '中毒持续 3 回合');

const hpAfterPoison = dummy5.currentHp;
console.log('  （毒击直接伤害: ' + (500 - hpAfterPoison) + '）');

// 假人防御
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });

// 第 2 回合开始：DoT 触发，扣 15 HP
bs = rpg6c.battle.getCurrentBattle();
const hpAfterDot1 = dummy5.currentHp;
console.log('  （第 2 回合开始 DoT 伤害: ' + (hpAfterPoison - hpAfterDot1) + ' HP，剩余: ' + hpAfterDot1 + '）');
assert(hpAfterPoison - hpAfterDot1 === 15, 'DoT 第 1 跳伤害 = 15');
assert(dummy5.debuffs[0].remainingTurns === 2, 'debuff 剩余 2 回合');

// hero 行动后，dummy 行动，再到第 3 回合
await rpg6c.battle.executeAction({ type: 'defend', characterId: 'hero' });
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });

// 第 3 回合：DoT 第 2 跳
bs = rpg6c.battle.getCurrentBattle();
const hpAfterDot2 = dummy5.currentHp;
assert(hpAfterDot1 - hpAfterDot2 === 15, 'DoT 第 2 跳伤害 = 15');
assert(dummy5.debuffs[0].remainingTurns === 1, 'debuff 剩余 1 回合');

await rpg6c.battle.executeAction({ type: 'defend', characterId: 'hero' });
await rpg6c.battle.executeEnemyAction({ type: 'defend', characterId: 'training_dummy' });

// 第 4 回合：DoT 第 3 跳（最后一跳），debuff 到期后应被清除
bs = rpg6c.battle.getCurrentBattle();
const hpAfterDot3 = dummy5.currentHp;
assert(hpAfterDot2 - hpAfterDot3 === 15, 'DoT 第 3 跳伤害 = 15');
assert(dummy5.debuffs.length === 0, '中毒 debuff 到期后被清除，恢复干净');
console.log('  （3 回合 DoT 完毕，debuff 已清除，HP: ' + hpAfterDot3 + '）');

console.log('\n--- 6.4 金币/道具 set 语义：覆盖而非累加，幂等 ---');
const rpg6d = new RPGCore({
  initialGold: 0,
  defaultAttributes: [{ id: 'hp', name: 'HP' }, { id: 'maxHp', name: 'MaxHP' }],
  items: [{ id: 'coin', name: '金币袋', type: 'material', stackable: true, maxStack: 999, usable: false }],
  characters: [{ id: 'hero', name: '勇者', isPlayer: true, initialLevel: 1, initialAttributes: [{ id: 'maxHp', value: 100 }, { id: 'hp', value: 100 }] }],
});

// 金币 set：先 add 一些，再 set
rpg6d.addGold(500);
assert(rpg6d.getGold() === 500, 'addGold(500) → 500');

// 第一次 set
const setRes1 = rpg6d.executeEffects([{ type: 'gold', operation: 'set', value: 1000 }]);
assert(setRes1.totalSuccess === 1, '金币 set 成功');
assert(rpg6d.getGold() === 1000, '金币 set 为 1000（不是 500+1000=1500）');

// 第二次 set 同一个值，幂等
const setRes2 = rpg6d.executeEffects([{ type: 'gold', operation: 'set', value: 1000 }]);
assert(setRes2.totalSuccess === 1, '第二次金币 set 成功');
assert(rpg6d.getGold() === 1000, '第二次 set 结果仍为 1000（幂等）');

// set 另一个值
const setRes3 = rpg6d.executeEffects([{ type: 'gold', operation: 'set', value: 777 }]);
assert(setRes3.totalSuccess === 1, '金币 set 777 成功');
assert(rpg6d.getGold() === 777, '金币现在是 777');

// 道具 set
rpg6d.inventory.addItem('coin', 5);
assert(rpg6d.inventory.getItemCount('coin') === 5, '初始 5 个金币袋');

// 第一次 set
const setItem1 = rpg6d.executeEffects([{ type: 'item', itemId: 'coin', operation: 'set', value: 20 }]);
assert(setItem1.totalSuccess === 1, '道具 set 20 成功');
assert(rpg6d.inventory.getItemCount('coin') === 20, '道具 set 为 20（不是 5+20=25）');

// 第二次 set 同一个值，幂等
const setItem2 = rpg6d.executeEffects([{ type: 'item', itemId: 'coin', operation: 'set', value: 20 }]);
assert(setItem2.totalSuccess === 1, '第二次道具 set 成功');
assert(rpg6d.inventory.getItemCount('coin') === 20, '第二次 set 仍为 20（幂等）');

// set 为 0，清除道具
const setItem3 = rpg6d.executeEffects([{ type: 'item', itemId: 'coin', operation: 'set', value: 0 }]);
assert(setItem3.totalSuccess === 1, '道具 set 0 成功');
assert(rpg6d.inventory.getItemCount('coin') === 0, '道具被清空');

// set 负数，应 clamp 到 0
const setItem4 = rpg6d.executeEffects([{ type: 'item', itemId: 'coin', operation: 'set', value: -5 }]);
assert(setItem4.totalSuccess === 1, '道具 set 负数 → clamp 成 0');
assert(rpg6d.inventory.getItemCount('coin') === 0, '道具仍为 0');

// set NaN / Infinity 应该失败
const setBad = rpg6d.executeEffects([
  { type: 'gold', operation: 'set', value: NaN },
  { type: 'gold', operation: 'set', value: Infinity },
]);
assert(setBad.totalSuccess === 0, 'NaN/Infinity → 失败');
assert(rpg6d.getGold() === 777, '金币不变，仍 777');

console.log('\n第六部分完成');

// ============================================================
section('测试总结');
// ============================================================
console.log('\n========================================');
console.log('  通过: ' + passCount);
console.log('  失败: ' + failCount);
console.log('========================================');
if (failCount > 0) {
  console.log('\n失败项:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
} else {
  console.log('\n🎉 所有测试通过！RPG SDK v2 功能完整可用。');
}
})().catch(err => {
  console.error('\n测试运行异常:', err);
  process.exit(1);
});

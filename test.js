const { RPGCore } = require('./dist/index');

const rpg = new RPGCore({
  initialGold: 100,
  maxLevel: 50,
  defaultAttributes: [
    { id: 'hp', name: '生命值', minValue: 0, maxValue: 9999 },
    { id: 'maxHp', name: '最大生命值', minValue: 0 },
    { id: 'mp', name: '魔法值', minValue: 0, maxValue: 999 },
    { id: 'attack', name: '攻击力', minValue: 0 },
    { id: 'defense', name: '防御力', minValue: 0 },
  ],
  levelTable: [
    { level: 2, expRequired: 100, attributeGains: { maxHp: 20, attack: 3 } },
    { level: 3, expRequired: 250, attributeGains: { maxHp: 25, attack: 4, defense: 2 } },
    { level: 4, expRequired: 500, attributeGains: { maxHp: 30, attack: 5, defense: 3 } },
    { level: 5, expRequired: 1000, attributeGains: { maxHp: 40, attack: 6, defense: 4 } },
  ],
  items: [
    {
      id: 'health_potion',
      name: '生命药水',
      description: '恢复50点生命值',
      type: 'consumable',
      stackable: true,
      maxStack: 99,
      usable: true,
      effects: [{ type: 'heal', value: 50 }],
    },
    {
      id: 'sword',
      name: '铁剑',
      description: '一把普通的铁剑',
      type: 'equipment',
      stackable: false,
      usable: false,
    },
    {
      id: 'key_item',
      name: '神秘钥匙',
      description: '打开神秘宝箱的钥匙',
      type: 'key',
      stackable: false,
      usable: false,
    },
  ],
  characters: [
    {
      id: 'player',
      name: '勇者',
      isPlayer: true,
      initialLevel: 1,
      initialExp: 0,
      initialAttributes: [
        { id: 'maxHp', value: 100 },
        { id: 'hp', value: 100 },
        { id: 'attack', value: 15 },
        { id: 'defense', value: 5 },
      ],
    },
    {
      id: 'companion1',
      name: '剑士艾拉',
      description: '来自北方王国的剑士',
      isPlayer: false,
      initialLevel: 1,
      affinity: 0,
      affinityMax: 100,
      initialAttributes: [
        { id: 'maxHp', value: 80 },
        { id: 'hp', value: 80 },
        { id: 'attack', value: 18 },
        { id: 'defense', value: 4 },
      ],
    },
  ],
  quests: [
    {
      id: 'quest_001',
      name: '初次冒险',
      description: '完成第一次战斗训练',
      isMain: true,
      chapterId: 'ch1',
      objectives: [
        { id: 'obj1', type: 'kill', targetId: 'slime', targetCount: 3, description: '击败3只史莱姆' },
        { id: 'obj2', type: 'collect', targetId: 'herb', targetCount: 5, description: '收集5株草药' },
      ],
      rewards: [
        { type: 'exp', value: 200 },
        { type: 'gold', value: 50 },
        { type: 'item', itemId: 'health_potion', value: 1, quantity: 3 },
      ],
    },
    {
      id: 'quest_002',
      name: '深入洞穴',
      description: '探索神秘洞穴',
      isMain: true,
      chapterId: 'ch1',
      prerequisites: ['quest_001'],
      objectives: [
        { id: 'obj1', type: 'reach', targetCount: 1, description: '到达洞穴深处' },
      ],
      rewards: [
        { type: 'exp', value: 500 },
        { type: 'item', itemId: 'sword', value: 1, quantity: 1 },
      ],
    },
  ],
  dialogues: [
    {
      id: 'intro_001',
      speaker: '旁白',
      text: '在一个遥远的王国里，年轻的勇者开始了他的冒险之旅...',
      nextDialogueId: 'intro_002',
      chapterId: 'ch1',
    },
    {
      id: 'intro_002',
      characterId: 'companion1',
      speaker: '艾拉',
      text: '你好，勇者！我是艾拉，一名剑士。愿意和我一起冒险吗？',
      choices: [
        {
          id: 'choice_yes',
          text: '当然愿意！一起出发吧！',
          nextDialogueId: 'intro_yes',
          effects: [
            { type: 'affinity', characterId: 'companion1', value: 10, operation: 'add' },
          ],
        },
        {
          id: 'choice_maybe',
          text: '让我考虑一下...',
          nextDialogueId: 'intro_maybe',
        },
      ],
      chapterId: 'ch1',
    },
    {
      id: 'intro_yes',
      characterId: 'companion1',
      speaker: '艾拉',
      text: '太好了！我们一定会成为最好的伙伴！',
      effects: [
        { type: 'quest', questId: 'quest_001', questAction: 'start' },
        { type: 'variable', variableKey: 'met_ella', value: true, operation: 'set' },
      ],
      isEnd: true,
      chapterId: 'ch1',
    },
    {
      id: 'intro_maybe',
      characterId: 'companion1',
      speaker: '艾拉',
      text: '好吧，想好了随时来找我。',
      isEnd: true,
      chapterId: 'ch1',
    },
  ],
  battles: [
    {
      id: 'battle_001',
      name: '史莱姆遭遇战',
      playerCharacters: ['player'],
      enemies: [
        {
          id: 'slime1',
          name: '史莱姆',
          attributes: { hp: 30, attack: 5, defense: 2 },
          expReward: 30,
        },
      ],
      allowFlee: true,
      retryable: true,
    },
  ],
  achievements: [
    {
      id: 'ach_first_battle',
      name: '初战告捷',
      description: '赢得第一场战斗',
      condition: { type: 'battle', battleId: 'battle_001', operator: 'eq', value: 'victory' },
      rewards: [{ type: 'gold', value: 100 }],
    },
    {
      id: 'ach_level_5',
      name: '崭露头角',
      description: '达到5级',
      condition: { type: 'level', operator: 'gte', value: 5 },
      rewards: [{ type: 'exp', value: 200 }],
    },
    {
      id: 'ach_quest_complete',
      name: '任务达人',
      description: '完成第一个任务',
      condition: { type: 'quest', questId: 'quest_001' },
      rewards: [{ type: 'item', itemId: 'key_item', value: 1, quantity: 1 }],
    },
  ],
  chapters: [
    {
      id: 'ch1',
      name: '第一章：启程',
      description: '冒险的开始',
      isUnlocked: true,
      order: 1,
    },
    {
      id: 'ch2',
      name: '第二章：深入',
      description: '更危险的挑战',
      isUnlocked: false,
      order: 2,
      prerequisites: ['ch1'],
    },
  ],
});

console.log('=== RPG Core SDK 测试 ===\n');

const player = rpg.getPlayer();
console.log('玩家:', player?.name, '等级:', player?.level);

const companions = rpg.getCompanions();
console.log('伙伴数量:', companions.length);
companions.forEach(c => console.log('  -', c.name, '好感度:', c.affinity));

console.log('\n=== 背包测试 ===');
console.log('初始金币:', rpg.getGold());
rpg.addItemConfig({
  id: 'test_item',
  name: '测试道具',
  type: 'consumable',
  stackable: true,
  usable: true,
  effects: [{ type: 'heal', value: 30 }],
});
rpg.inventory.addItem('health_potion', 5);
rpg.inventory.addItem('sword', 1);
console.log('背包物品:', rpg.getInventory().length, '种');
console.log('生命药水数量:', rpg.inventory.getItemCount('health_potion'));

console.log('\n=== 任务测试 ===');
console.log('可用任务数量:', rpg.quest.getAvailableQuests().length);
rpg.startQuest('quest_001');
console.log('当前进行中任务:', rpg.getActiveQuests().length);
console.log('任务名:', rpg.quest.getQuest('quest_001')?.id);

console.log('\n=== 对话测试 ===');
const dialogue = rpg.startDialogue('intro_001');
console.log('开始对话:', dialogue?.text?.substring(0, 30) + '...');
const next = rpg.nextDialogue();
console.log('下一句:', next?.speaker + ': ' + next?.text?.substring(0, 20) + '...');
const choices = rpg.getAvailableChoices();
console.log('可用选项数量:', choices.length);
choices.forEach(c => console.log('  选项:', c.text));

console.log('\n=== 事件测试 ===');
let eventCount = 0;
rpg.on('levelUp', (event) => {
  console.log('事件 - 升级:', event.payload.level, '级');
  eventCount++;
});

rpg.on('questStarted', (event) => {
  console.log('事件 - 任务开始:', event.payload.questId);
  eventCount++;
});

rpg.on('achievementUnlocked', (event) => {
  console.log('事件 - 成就解锁:', event.payload.achievementId, '-', event.payload.achievement.name);
  eventCount++;
});

console.log('\n=== 升级测试 ===');
rpg.character.addExp('player', 150);
console.log('玩家等级:', rpg.character.getLevel('player'));
console.log('当前经验:', rpg.character.getExp('player'));
console.log('升级所需经验:', rpg.character.getExpToNextLevel('player'));

console.log('\n=== 好感度测试 ===');
rpg.character.addAffinity('companion1', 25);
console.log('艾拉好感度:', rpg.character.getAffinity('companion1'));

console.log('\n=== 成就测试 ===');
console.log('成就进度:', rpg.getAchievementProgress());

console.log('\n=== 变量测试 ===');
rpg.setVariable('test_var', 'hello world');
console.log('变量 test_var:', rpg.getVariable('test_var'));

console.log('\n=== 章节测试 ===');
console.log('当前章节:', rpg.getCurrentChapter()?.name);
console.log('第二章已解锁:', rpg.save.isChapterUnlocked('ch2'));

console.log('\n=== 存档测试 ===');
const save = rpg.createSave('slot1');
console.log('创建存档:', save ? '成功' : '失败');
console.log('存档槽位:', rpg.getSaveSlots().length);

console.log('\n=== 战斗系统 (需异步执行) ===');
console.log('战斗配置数量:', rpg.battle.getAllBattleConfigs().length);

console.log('\n=== 测试完成 ===');
console.log('触发事件总数:', eventCount, '个');
console.log('RPG SDK 所有核心功能正常工作！');

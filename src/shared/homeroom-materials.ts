export const HOMEROOM_CHECKIN_DEFS = {
  morning: { key: 'morning', name: '晨检出勤打卡', shortName: '晨检', desc: '早读/晨检考勤确认' },
  teach: { key: 'teach', name: '教研备课打卡', shortName: '备课', desc: '学科备课与教研复盘' },
  meeting: { key: 'meeting', name: '班会德育打卡', shortName: '班会', desc: '主题班会与德育活动（自动计入月度统计）' },
  talk: { key: 'talk', name: '学生谈心打卡', shortName: '谈心', desc: '重点学生谈心与心理关怀' },
} as const;

export type HomeroomCheckinType = keyof typeof HOMEROOM_CHECKIN_DEFS;

export const HOMEROOM_TASK_CATEGORIES = [
  '学科教学',
  '班级晨检',
  '安全落实',
  '家校沟通',
  '资料上报',
  '学生谈心',
  '卫生纪律',
  '班级管理',
] as const;
export type HomeroomTaskCategory = (typeof HOMEROOM_TASK_CATEGORIES)[number];

export const HOMEROOM_TASK_PRIORITIES = ['紧急必办', '常规工作', '延后跟进'] as const;
export type HomeroomTaskPriority = (typeof HOMEROOM_TASK_PRIORITIES)[number];

export const HOMEROOM_TASK_TEMPLATES: ReadonlyArray<{
  label: string;
  title: string;
  category: HomeroomTaskCategory;
  priority?: HomeroomTaskPriority;
}> = [
  { label: '晨检查考勤', title: '晨检查看考勤并登记请假情况', category: '班级晨检' },
  { label: '批改作业', title: '批改作业并登记缺交名单', category: '学科教学' },
  { label: '整理安全回执', title: '整理回收安全教育告家长书回执', category: '安全落实', priority: '紧急必办' },
  { label: '筹备班会', title: '筹备本周主题班会课件与流程', category: '班级管理' },
  { label: '约谈学生', title: '约谈重点关注学生了解近期状态', category: '学生谈心' },
  { label: '联系家长', title: '电话联系家长沟通近期学习与表现', category: '家校沟通' },
];

export const HOMEROOM_COMM_TYPES = [
  '即时电话',
  '一对一单独面谈',
  '3-5人小组家长会',
  '全体家长会',
] as const;
export type HomeroomCommType = (typeof HOMEROOM_COMM_TYPES)[number];

export const HOMEROOM_COMM_STATUSES = ['待跟进', '已办结'] as const;
export type HomeroomCommStatus = (typeof HOMEROOM_COMM_STATUSES)[number];

export const HOMEROOM_MEMO_TAGS = [
  '教学资料',
  '安全回执',
  '行政通知',
  '特殊学生档案',
  '紧急事项',
  '其他',
] as const;
export type HomeroomMemoTag = (typeof HOMEROOM_MEMO_TAGS)[number];

export const HOMEROOM_CHECK_KINDS = {
  attendance: {
    key: 'attendance',
    label: '晨检考勤',
    defaultTitle: '晨检出勤点名',
    anomalyLabel: '缺勤/请假',
    seatBadge: '缺勤',
    normalLabel: '出勤',
  },
  homework: {
    key: 'homework',
    label: '作业收交',
    defaultTitle: '今日作业登记',
    anomalyLabel: '未交作业',
    seatBadge: '未交作业',
    normalLabel: '已交',
  },
  receipt: {
    key: 'receipt',
    label: '安全回执',
    defaultTitle: '安全教育回执回收',
    anomalyLabel: '未交回执',
    seatBadge: '未交回执',
    normalLabel: '已交',
  },
  discipline: {
    key: 'discipline',
    label: '违纪登记',
    defaultTitle: '课堂/日常违纪记录',
    anomalyLabel: '违纪记录',
    seatBadge: '违纪',
    normalLabel: '正常',
  },
} as const;

export type HomeroomCheckKind = keyof typeof HOMEROOM_CHECK_KINDS;

export interface MoralSafetyThemeContent {
  key: string;
  topics: string[];
  flow: string;
  script: string;
  letters: string[];
}

export type MaterialPartKey = 'topics' | 'flow' | 'script' | 'letters';

export const MATERIAL_PART_LABELS: Record<MaterialPartKey, string> = {
  topics: '① 主题班会参考（5 条）',
  flow: '② 主题班会流程结构（4 段式）',
  script: '③ 班级家长会宣讲短脚本',
  letters: '④ 告家长书 / 宣传短句（3 条）',
};

export const MORAL_SAFETY_THEMES: ReadonlyArray<MoralSafetyThemeContent> = [
  {
    key: '防溺水',
    topics: [
      '1. 珍爱生命，谨防溺水——水边的安全课',
      '2. 远离危险水域，掌握自救互救技能',
      '3. "六不"原则记心间，安全一夏伴我行',
      '4. 同伴落水怎么办？智慧救援不盲目',
      '5. 从溺水案例看生命教育：每个生命只有一次',
    ],
    flow:
      '第一段·导入（5分钟）：播放防溺水警示短片或讲述真实案例，引发学生对溺水危险的直观感受。\n' +
      '第二段·认知（15分钟）：讲解"六不"原则（不私自下水游泳、不擅自与他人结伴游泳、不在无家长带领下游泳、不到无安全设施水域游泳、不到不熟悉水域游泳、不盲目下水施救），结合校园周边危险水域地图讨论。\n' +
      '第三段·演练（15分钟）：模拟同伴落水情景，练习"呼救—找漂浮物—报警"的智慧救援流程，纠正"手拉手施救"等错误做法。\n' +
      '第四段·总结（5分钟）：学生宣誓"珍爱生命、远离危险水域"，布置回家向家长宣讲任务，发放并回收防溺水告家长书回执。',
    script:
      '各位家长好！天气转热，溺水事故进入高发期。恳请各位家长务必履行监护责任：孩子外出做到"四知"——知去向、知同伴、知归时、知内容；教育孩子严守"六不"原则，尤其放学后、周末、节假日是溺水高发时段，请加强看护。孩子想游泳请带去正规场馆，切莫让孩子靠近河塘、水库等危险水域。生命至上，安全第一，感谢配合！',
    letters: [
      '【告家长书】尊敬的家长：随着气温升高，溺水风险显著上升。请配合学校做到：①教育孩子不私自下水、不到危险水域玩耍；②掌握孩子外出"四知"；③学习基本自救知识。让我们家校携手，共同守护孩子生命安全。',
      '【宣传短句】防溺水"六不"要记牢：不私自下水、不擅自结伴、不在无监护下游泳、不到无安全设施水域、不到不熟悉水域、不盲目施救。安全一夏，快乐成长！',
      '【宣传短句】水边一时凉，溺水一世殇。莫让悲剧重演，请家长紧盯孩子放学后与周末去向，远离野外水域！',
    ],
  },
  {
    key: '校园防欺凌',
    topics: [
      '1. 拒绝冷漠，勇敢说"不"——向校园欺凌亮剑',
      '2. 认识欺凌：语言、肢体、关系与网络欺凌',
      '3. 从旁观者到保护者：每个人都可以是光',
      '4. 换位思考课：被欺凌者的内心世界',
      '5. 求助不是软弱：倾诉渠道与心理支持',
    ],
    flow:
      '第一段·导入（5分钟）：情景剧表演"课间的小插曲"，呈现言语嘲讽场景，提问"如果你在场会怎么做"。\n' +
      '第二段·认知（15分钟）：讲解欺凌的四类形式（肢体、语言、关系孤立、网络欺凌）与危害，明确"玩笑"与"欺凌"的边界；观看反欺凌公益短片。\n' +
      '第三段·讨论（15分钟）：分组讨论"遇到欺凌怎么办"与"旁观者可以做什么"，归纳"保持冷静—及时求助—保留证据—寻求老师家长帮助"应对步骤。\n' +
      '第四段·总结（5分钟）：全班共读反欺凌倡议书，设立班级"心语信箱"匿名求助渠道，强调同学间友善互助。',
    script:
      '各位家长好！校园欺凌的伤害可能影响孩子一生。恳请家长：①多关注孩子情绪与身体异常，如突然厌学、身上伤痕、物品丢失等，可能是遭受欺凌的信号；②教育孩子不欺负他人，也不做冷漠的旁观者；③发现苗头第一时间与老师联系，切勿私下冲动处理。让我们共同营造友善、安全的成长环境！',
    letters: [
      '【告家长书】尊敬的家长：为预防校园欺凌，请家长关注孩子日常表现与情绪变化，教育孩子尊重他人、友善待人；若发现孩子可能被欺凌或欺凌他人，请及时与班主任沟通，学校将依规严肃处理并保护每一位学生。',
      '【宣传短句】不做欺凌者，不做受气包，更不做冷漠的旁观者。勇敢说"不"，老师永远是你最坚实的后盾！',
      '【宣传短句】玩笑有边界，尊重无价。拒绝语言暴力，从好好说话开始。',
    ],
  },
  {
    key: '交通安全',
    topics: [
      '1. 平安上学路——行路与乘车安全规范',
      '2. 一盔一带，安全常在',
      '3. 认识大货车盲区：远离"死亡弯月"',
      '4. 骑自行车与电动车的年龄规定和安全守则',
      '5. 从交通事故案例学规则意识',
    ],
    flow:
      '第一段·导入（5分钟）：展示学生上下学路线图，请学生指出路上的危险点（路口、斑马线、施工路段）。\n' +
      '第二段·认知（15分钟）：讲解步行、骑车、乘车安全规范：走人行道、不闯红灯、未满12周岁不骑自行车上路、未满16周岁不骑电动车、乘坐电动车须佩戴头盔、乘车系好安全带。\n' +
      '第三段·演练（15分钟）：模拟路口通行情景，练习"一停二看三通过"；演示正确佩戴安全头盔的方法。\n' +
      '第四段·总结（5分钟）：齐读交通安全口诀，发放交通安全告家长书，提醒家长以身作则、接送守规。',
    script:
      '各位家长好！交通安全无小事。恳请家长：①接送孩子即停即走，不在校门口违停堵塞；②骑电动车接送务必大人小孩都戴好头盔，不逆行、不闯红灯、不超员；③教育孩子过马路走斑马线、不低头看手机；④未满12周岁不让孩子骑自行车上路、未满16周岁不骑电动车。言传身教，为孩子树立遵守交规的好榜样！',
    letters: [
      '【告家长书】尊敬的家长：上下学途中交通安全请您重点关照——督促孩子遵守交规，步行走人行道，过马路"一停二看三通过"；骑行电动车"一盔一带"，不违规载人；不乘坐超员、无资质车辆。',
      '【宣传短句】一盔一带，安全常在。头盔不是给交警看的，是给生命用的！',
      '【宣传短句】马路不是游乐场，追逐打闹要不得。红灯停、绿灯行，安全出行每一天。',
    ],
  },
  {
    key: '考前心理疏导',
    topics: [
      '1. 和紧张做朋友——考试焦虑的科学认识',
      '2. 呼吸放松与积极自我对话训练',
      '3. 合理归因：一次考试不等于人生答卷',
      '4. 睡眠与运动：考前的身体能量管理',
      '5. 读懂"考不好"背后的情绪信号',
    ],
    flow:
      '第一段·导入（5分钟）：焦虑自评小测试（举手调查"考前睡不好/手心出汗/大脑空白"情况），让学生知道紧张是正常现象。\n' +
      '第二段·认知（10分钟）：讲解"适度紧张提升表现"的耶克斯—多德森规律（用生活化语言），纠正"紧张=完蛋"的错误认知。\n' +
      '第三段·练习（20分钟）：现场演练腹式呼吸放松法与"478呼吸法"；练习把消极自我对话（"我肯定考砸"）改写为积极语句（"我已认真复习，尽力就好"）。\n' +
      '第四段·总结（5分钟）：给出考前一周作息建议（规律睡眠、适量运动、不熬夜刷题），鼓励学生写下"写给考前自己的一句话"贴在文具盒里。',
    script:
      '各位家长好！考试临近，孩子的心理状态与复习同等重要。恳请家长：①不刻意施加压力，避免"考不好就完了"之类话语；②保障孩子规律作息与适度运动；③多倾听少说教，接纳孩子的紧张情绪；④如发现孩子失眠严重、情绪持续低落，请及时与班主任或心理老师联系。平常心是最好的助考状态，家校一起为孩子保驾护航！',
    letters: [
      '【告家长书】尊敬的家长：考试周临近，请家长为孩子营造平和的家庭氛围——规律作息、均衡饮食、不打疲劳战；关注情绪多于关注分数，一句"尽力就好"胜过千句叮嘱。',
      '【宣传短句】考试考的是知识，更是心态。深呼吸，告诉自己：我准备好了！',
      '【宣传短句】紧张说明你在乎，说明你认真对待过。带着它一起上场，就是勇气。',
    ],
  },
  {
    key: '文明礼仪教育',
    topics: [
      '1. 礼仪始于细节——课间、餐厅、集会场合的行为规范',
      '2. 会说话的分数：礼貌用语的日常使用',
      '3. 尊师重道与同学交往的分寸感',
      '4. 网络文明：指尖上的礼仪',
      '5. 从"谢谢"开始：感恩教育主题班会',
    ],
    flow:
      '第一段·导入（5分钟）：播放校园不文明行为抓拍（打码处理）与文明行为对比图，学生找差异。\n' +
      '第二段·认知（15分钟）：梳理校园四大场合礼仪清单——课堂（发言先举手）、课间（轻声慢步）、餐厅（有序排队、光盘行动）、集会（安静有序）；示范礼貌用语"请、您好、谢谢、对不起、没关系"的运用场景。\n' +
      '第三段·演练（15分钟）：情景模拟"借文具""撞到别人""接受帮助"等场景，请学生上台表演规范做法。\n' +
      '第四段·总结（5分钟）：启动"文明之星"周评活动，全班共同制定班级文明公约并签名张贴。',
    script:
      '各位家长好！文明礼仪是孩子的终身名片。学校正在开展文明礼仪养成教育，恳请家长配合：①日常生活中以身作则，使用礼貌用语；②引导孩子待人有分寸、懂得感恩；③关注孩子网络言行，不刷屏骂战、不传播不良信息。家校同频，孩子才能把"文明"内化为习惯。感谢支持！',
    letters: [
      '【告家长书】尊敬的家长：本月学校开展"文明礼仪养成月"活动，请家长配合督促孩子在家庭与社会场合同样讲文明、懂礼貌——见人问好、排队守序、餐桌上光盘、网络上守规矩。',
      '【宣传短句】你让出的每一步，都是文明的样子；你轻声的每一句，都是修养的声音。',
      '【宣传短句】礼多人不怪，谦让显风度。文明用语十个字：请、您、谢谢、对不起、没关系。',
    ],
  },
];

export function getMoralSafetyTheme(key: string): MoralSafetyThemeContent {
  return MORAL_SAFETY_THEMES.find((t) => t.key === key) || MORAL_SAFETY_THEMES[0];
}

export function formatMaterialPartBody(
  theme: MoralSafetyThemeContent,
  part: MaterialPartKey,
): string {
  if (part === 'topics') return theme.topics.join('\n');
  if (part === 'flow') return theme.flow;
  if (part === 'script') return theme.script;
  return theme.letters.join('\n---\n');
}

export function formatMaterialSavedText(
  theme: MoralSafetyThemeContent,
  part: MaterialPartKey,
): string {
  const shortTitle: Record<MaterialPartKey, string> = {
    topics: '主题班会参考',
    flow: '班会流程结构',
    script: '家长会宣讲脚本',
    letters: '告家长书/宣传短句',
  };
  return `【${theme.key}·${shortTitle[part]}】\n${formatMaterialPartBody(theme, part)}`;
}

// Local timezone YYYY-MM-DD & YYYY-MM helpers shared across main & renderer
export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function localTodayStr(now: Date = new Date()): string {
  return formatLocalDate(now);
}

export function localCurrentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function localTimeHHMM(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

export function weekDateRange(baseIsoDate?: string): { start: string; end: string } {
  const m = baseIsoDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseIsoDate.trim()) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  const day = d.getDay() || 7; // Monday = 1 ... Sunday = 7
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 1);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return { start: formatLocalDate(mon), end: formatLocalDate(sun) };
}

export function timeGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 6) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

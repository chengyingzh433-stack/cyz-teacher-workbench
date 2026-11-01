// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from '../core/state.js';
import { classContext, examContext, studentContext } from './context.js';
import { examById, latestExam, prevExam, stuById } from '../core/queries.js';

/* ---------- 模板 ---------- */
var TPL_CATS = [
  ['rec', '推荐'],
  ['teach', '教学备课'],
  ['manage', '班级管理'],
  ['home', '家校沟通'],
  ['grow', '学生成长']
];

var TPLS = [
  {
    id: 'lesson',
    cat: 'teach',
    rec: 1,
    color: '#2f7ff0',
    ico: '教',
    title: '备课教案',
    desc: '输入课题，生成教学目标、重难点、教学过程、板书和分层作业',
    fields: [
      [
        'subject',
        'text',
        '学科',
        function () {
          return S.settings.teacher.subject;
        }
      ],
      [
        'grade',
        'text',
        '年级',
        function () {
          return S.settings.grade;
        }
      ],
      ['topic', 'text', '课题', '', '如：分式的加减（第 1 课时）', 1],
      ['hours', 'select', '课时', ['1 课时（45 分钟）', '2 课时', '复习课']],
      ['extra', 'textarea', '学情或特别要求', '', '选填：比如班里计算基础偏弱，需要多一些练习']
    ],
    build: function (v) {
      return {
        title: v.topic + ' · 教案',
        show:
          '帮我写一份教案：' +
          v.grade +
          v.subject +
          '《' +
          v.topic +
          '》，' +
          v.hours +
          (v.extra ? '\n要求：' + v.extra : ''),
        prompt:
          '请为' +
          S.settings.stage +
          v.grade +
          v.subject +
          '《' +
          v.topic +
          '》写一份完整教案（' +
          v.hours +
          '）。\n结构：一、教学目标（核心素养导向）；二、教学重难点；三、教学准备；四、教学过程（导入、新授、练习、小结、作业，每个环节写清时间、教师活动、学生活动和设计意图，用表格呈现）；五、板书设计；六、分层作业（基础、提高、拓展）；七、课后反思提示。' +
          (v.extra ? '\n学情与要求：' + v.extra : '')
      };
    }
  },
  {
    id: 'ppt',
    cat: 'teach',
    color: '#2f7ff0',
    ico: '课',
    title: '课件大纲',
    desc: '按页列出课件结构、每页要点、互动设计和配图建议',
    fields: [
      [
        'subject',
        'text',
        '学科',
        function () {
          return S.settings.teacher.subject;
        }
      ],
      ['topic', 'text', '课题', '', '如：光的反射', 1],
      ['pages', 'select', '页数', ['12 页左右', '8 页左右', '16 页左右', '20 页左右']]
    ],
    build: function (v) {
      return {
        title: v.topic + ' · 课件大纲',
        show: '帮我设计《' + v.topic + '》的课件大纲，' + v.pages,
        prompt:
          '请为' +
          S.settings.stage +
          v.subject +
          '《' +
          v.topic +
          '》设计课件大纲，' +
          v.pages +
          '。每页写：页标题、要点（不超过 4 条）、互动或提问设计、配图建议。最后给出 3 条讲课节奏提醒。'
      };
    }
  },
  {
    id: 'homework',
    cat: 'teach',
    color: '#2f7ff0',
    ico: '练',
    title: '分层作业',
    desc: '基础、提高、拓展三层作业，附参考答案和讲评要点',
    fields: [
      [
        'subject',
        'text',
        '学科',
        function () {
          return S.settings.teacher.subject;
        }
      ],
      ['topic', 'text', '知识点', '', '如：一元一次方程的应用', 1],
      ['count', 'select', '每层题量', ['3 题', '5 题', '2 题']]
    ],
    build: function (v) {
      return {
        title: v.topic + ' · 分层作业',
        show: '帮我出《' + v.topic + '》的分层作业，每层 ' + v.count,
        prompt:
          '请为' +
          S.settings.stage +
          S.settings.grade +
          v.subject +
          '「' +
          v.topic +
          '」设计分层作业：基础层、提高层、拓展层各 ' +
          v.count +
          '，题目贴近生活、难度梯度清晰。每层后面给出参考答案和简短讲评要点，最后说明每层适合哪类同学。'
      };
    }
  },
  {
    id: 'meeting',
    cat: 'manage',
    rec: 1,
    color: '#14b0a6',
    ico: '班',
    title: '班会课方案',
    desc: '主题班会的目标、流程、互动环节和总结，可结合班级情况',
    fields: [
      ['theme', 'text', '班会主题', '', '如：期中考试后的反思与调整', 1],
      ['dur', 'select', '时长', ['40 分钟', '45 分钟', '20 分钟']],
      ['form', 'select', '形式', ['讨论交流', '情景游戏', '演讲分享', '视频引导']],
      ['useClass', 'check', '参考本班情况（成绩、点评等，已脱敏）', true]
    ],
    build: function (v) {
      return {
        title: v.theme + ' · 班会方案',
        show: '帮我设计一节主题班会：' + v.theme + '（' + v.dur + '，' + v.form + '）',
        prompt:
          '请设计一节主题班会课方案。主题：' +
          v.theme +
          '；时长：' +
          v.dur +
          '；形式以' +
          v.form +
          '为主。\n内容：活动目标、课前准备（含学生分工）、活动流程（每个环节写时间、做法和主持词要点）、互动环节设计、班主任总结发言（300 字左右）、课后延伸。',
        ctx: v.useClass ? [classContext()] : []
      };
    }
  },
  {
    id: 'activity',
    cat: 'manage',
    color: '#14b0a6',
    ico: '策',
    title: '活动策划',
    desc: '班级活动策划书，含分工、流程、预算与安全预案',
    fields: [
      ['name', 'text', '活动名称', '', '如：秋季班级趣味运动会', 1],
      ['when', 'text', '时间地点', '', '如：11 月 15 日下午，学校操场'],
      [
        'people',
        'text',
        '参与人数',
        function () {
          return '全班 ' + S.students.length + ' 人';
        }
      ],
      ['budget', 'text', '预算', '', '选填']
    ],
    build: function (v) {
      return {
        title: v.name + ' · 策划书',
        show: '帮我写一份活动策划：' + v.name + (v.when ? '（' + v.when + '）' : ''),
        prompt:
          '请为「' +
          v.name +
          '」写一份班级活动策划书。时间地点：' +
          (v.when || '待定') +
          '；参与：' +
          v.people +
          '；预算：' +
          (v.budget || '尽量节省') +
          '。\n包括：活动目的、活动内容与流程（时间表）、人员分工（可以安排班干部）、物资与预算清单、安全预案、宣传与总结方式。',
        ctx: [classContext()]
      };
    }
  },
  {
    id: 'summary',
    cat: 'manage',
    color: '#14b0a6',
    ico: '总',
    title: '工作总结 / 计划',
    desc: '根据本学期班级数据，写班主任工作总结或下学期计划',
    fields: [
      ['kind', 'select', '类型', ['学期工作总结', '月度工作总结', '下学期工作计划']],
      ['focus', 'textarea', '想重点写的工作', '', '选填：比如这学期重点抓了作业习惯和家校沟通']
    ],
    build: function (v) {
      return {
        title: S.settings.className + ' · ' + v.kind,
        show: '帮我写一份' + v.kind + (v.focus ? '，重点：' + v.focus : ''),
        prompt:
          '请根据下面的班级数据写一份班主任' +
          v.kind +
          '，1500 字左右。结构：班级基本情况、主要工作与成效（班风学风、学业、德育与活动、家校沟通、安全）、存在的问题、下一步措施。数据要引用得具体，但不要罗列学生全名排名。' +
          (v.focus ? '\n老师希望重点写：' + v.focus : ''),
        ctx: [classContext()].concat(
          latestExam() ? [examContext(latestExam(), prevExam(latestExam()))] : []
        )
      };
    }
  },
  {
    id: 'notice',
    cat: 'home',
    rec: 1,
    color: '#f2a71b',
    ico: '通',
    title: '家长群通知',
    desc: '放假、活动、缴费等通知，清楚礼貌，要点不遗漏',
    fields: [
      ['matter', 'textarea', '通知事项', '', '如：周五下午秋游，需要带午餐和水，回执周四前交', 1],
      ['when', 'text', '时间', ''],
      ['need', 'textarea', '需要家长配合的事', '', '选填']
    ],
    build: function (v) {
      return {
        title: '家长群通知',
        show: '帮我写一条家长群通知：' + v.matter,
        prompt:
          '请写一条发在家长微信群里的班级通知。事项：' +
          v.matter +
          '；时间：' +
          (v.when || '见事项') +
          '；需要家长配合：' +
          (v.need || '无') +
          '。\n要求：开头称呼「各位家长」，分点写清时间、地点、要求，语气礼貌简洁，300 字以内，结尾请家长收到回复。再额外给一个 100 字以内的精简版。'
      };
    }
  },
  {
    id: 'parent',
    cat: 'home',
    rec: 1,
    color: '#f2a71b',
    ico: '谈',
    title: '家长沟通话术',
    desc: '针对某位同学的情况，写给家长的微信消息或通话提纲',
    fields: [
      ['student', 'student', '学生', '', '', 1],
      [
        'reason',
        'select',
        '沟通事由',
        ['成绩波动', '作业问题', '课堂表现', '行为习惯', '表扬进步', '情绪与身体', '其他']
      ],
      ['detail', 'textarea', '具体情况', '', '选填：比如最近三次数学作业没交，上课容易走神'],
      ['channel', 'select', '沟通方式', ['微信消息', '电话沟通提纲', '面谈提纲']]
    ],
    build: function (v) {
      var s = stuById(v.student);
      return {
        title: s.name + ' · 家长沟通',
        show:
          '帮我给' +
          s.name +
          '的家长写' +
          v.channel +
          '，事由：' +
          v.reason +
          (v.detail ? '（' + v.detail + '）' : ''),
        prompt:
          '请帮我准备与这位同学家长的沟通内容，形式：' +
          v.channel +
          '；事由：' +
          v.reason +
          '。' +
          (v.detail ? '具体情况：' + v.detail + '。' : '') +
          '\n要求：先肯定孩子的优点，再具体说明情况和事实，提出 2–3 条家校可以一起做的具体办法，语气尊重、不指责家长。微信消息控制在 250 字以内；提纲要分点并预判家长可能的回应。',
        ctx: [studentContext(s)],
        sid: s.id
      };
    }
  },
  {
    id: 'pmeeting',
    cat: 'home',
    color: '#f2a71b',
    ico: '会',
    title: '家长会发言稿',
    desc: '结合最近一次考试数据，写班主任家长会发言',
    fields: [
      ['exam', 'exam', '结合哪次考试'],
      ['mins', 'select', '发言时长', ['15 分钟', '10 分钟', '20 分钟']],
      ['focus', 'textarea', '想强调的事', '', '选填：比如手机管理、作息、期末复习安排']
    ],
    build: function (v) {
      var ex = examById(v.exam);
      return {
        title: '家长会发言稿',
        show:
          '帮我写家长会发言稿（' +
          v.mins +
          '）' +
          (ex ? '，结合' + ex.name : '') +
          (v.focus ? '，重点：' + v.focus : ''),
        prompt:
          '请写一份班主任家长会发言稿，时长约' +
          v.mins +
          '（按每分钟 200 字估算）。结构：问候与感谢、班级近况、考试情况分析（整体与各科，只说群体数据，不点名批评）、表扬进步（可以点名表扬）、存在的问题、家校配合建议（具体可执行）、结束语。' +
          (v.focus ? '\n重点强调：' + v.focus : ''),
        ctx: [classContext()].concat(ex ? [examContext(ex, prevExam(ex))] : [])
      };
    }
  },
  {
    id: 'comments',
    cat: 'grow',
    rec: 1,
    color: '#e5483b',
    ico: '评',
    title: '期末评语（批量）',
    desc: '读取每位同学的档案、成绩和点评，逐个生成个性化评语',
    batch: true,
    fields: [
      ['students', 'students', '选择学生'],
      ['style', 'select', '风格', ['温暖鼓励', '客观中肯', '文艺诗意']],
      ['len', 'select', '字数', ['120 字左右', '80 字左右', '180 字左右']],
      ['person', 'select', '人称', ['第二人称「你」', '第三人称「该生」']]
    ]
  },
  {
    id: 'report',
    cat: 'grow',
    rec: 1,
    color: '#e5483b',
    ico: '析',
    title: '成绩分析报告',
    desc: '班级整体、各科表现、进退步分析和下一步教学建议',
    fields: [
      ['exam', 'exam', '分析哪次考试'],
      ['cmp', 'exam0', '对比考试']
    ],
    build: function (v) {
      var ex = examById(v.exam),
        cx = v.cmp ? examById(v.cmp) : null;
      return {
        title: ex.name + ' · 成绩分析',
        show: '帮我写「' + ex.name + '」的成绩分析报告' + (cx ? '，对比' + cx.name : ''),
        prompt:
          '请根据考试数据写一份班级成绩分析报告。结构：一、总体情况（用表格列出关键指标）；二、各科分析（优势与薄弱）；三、学生层面（进步、退步、学困生，给出关注建议）；四、原因分析（可能的原因，标注需要老师核实）；五、下一步措施（班主任与各科老师分别做什么）。',
        ctx: [examContext(ex, cx)]
      };
    }
  },
  {
    id: 'talk',
    cat: 'grow',
    color: '#e5483b',
    ico: '心',
    title: '谈心谈话提纲',
    desc: '为一次个别谈话做准备：开场、倾听、引导与约定',
    fields: [
      ['student', 'student', '学生', '', '', 1],
      ['topic', 'textarea', '谈话话题', '', '如：最近和同学闹矛盾，情绪低落']
    ],
    build: function (v) {
      var s = stuById(v.student);
      return {
        title: s.name + ' · 谈话提纲',
        show: '帮我准备和' + s.name + '的谈心谈话' + (v.topic ? '：' + v.topic : ''),
        prompt:
          '请帮我准备一次与这位同学的个别谈心谈话。话题：' +
          (v.topic || '近期状态') +
          '。\n给出：谈话目标、合适的时间地点、开场白（2 种）、倾听与提问清单（开放式问题）、可能的情况与应对、最后的小约定和后续跟进方式。语气要像一位信任孩子的老师。',
        ctx: [studentContext(s)],
        sid: s.id
      };
    }
  },
  {
    id: 'birthday',
    cat: 'grow',
    color: '#e5483b',
    ico: '生',
    title: '生日祝福',
    desc: '给过生日的同学写一段专属祝福，可以发在班级群或写在贺卡上',
    fields: [
      ['student', 'student', '学生', '', '', 1],
      ['style', 'select', '风格', ['温暖', '幽默', '诗意']]
    ],
    build: function (v) {
      var s = stuById(v.student);
      return {
        title: s.name + ' · 生日祝福',
        show: '帮我给' + s.name + '写一段生日祝福（' + v.style + '）',
        prompt:
          '今天是这位同学的生日，请以班主任的口吻写 3 段不同的生日祝福（' +
          v.style +
          '风格），每段 60 字以内，结合 TA 的特点，不要提成绩排名。',
        ctx: [studentContext(s)],
        sid: s.id
      };
    }
  },
  {
    id: 'comment1',
    cat: 'hidden',
    color: '#e5483b',
    ico: '评',
    title: '个人评语',
    desc: '',
    fields: [
      ['student', 'student', '学生', '', '', 1],
      ['style', 'select', '风格', ['温暖鼓励', '客观中肯', '文艺诗意']],
      ['len', 'select', '字数', ['120 字左右', '80 字左右', '180 字左右']],
      ['person', 'select', '人称', ['第二人称「你」', '第三人称「该生」']]
    ],
    build: function (v) {
      var s = stuById(v.student);
      return {
        title: s.name + ' · 评语',
        show: '帮我给' + s.name + '写一段期末评语（' + v.style + '，' + v.len + '）',
        prompt: commentPrompt(v),
        ctx: [studentContext(s)],
        sid: s.id,
        saveAs: 'comment'
      };
    }
  },
  {
    id: 'parent-batch',
    cat: 'hidden',
    color: '#f2a71b',
    ico: '谈',
    title: '退步同学家长沟通',
    desc: '',
    batch: true,
    fields: [
      ['exam', 'exam', '考试'],
      ['cmp', 'exam0', '和哪次考试比'],
      ['channel', 'select', '沟通方式', ['微信消息', '电话沟通提纲']]
    ]
  }
];

function tplById(id) {
  for (var i = 0; i < TPLS.length; i++) if (TPLS[i].id === id) return TPLS[i];
  return null;
}

function commentPrompt(v) {
  return (
    '请为这位同学写一段期末评语。风格：' +
    v.style +
    '；字数：' +
    v.len +
    '；人称：' +
    v.person +
    '。\n要求：从档案、成绩、点评和成长记录里找 1–2 个具体细节来写，先肯定优点，再用委婉、可操作的方式提出 1 条期望；不要出现排名和分数，不要套话；只输出评语正文，不要标题和其他说明。'
  );
}

export { TPLS, TPL_CATS, commentPrompt, tplById };

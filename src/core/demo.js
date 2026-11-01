// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { ART } from '../art/scene.js';
import { defaultState } from './schema.js';
import { clamp, pad2, todayStr } from './utils.js';

/* ---------- 示例数据 ---------- */
function demoState() {
  var R = ART.rng(20261029);
  function pick(a) {
    return a[Math.floor(R() * a.length)];
  }
  function gauss() {
    var u = 1 - R(),
      v = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  var s = defaultState();
  s.demo = true;
  var st = s.settings;
  st.school = '星河实验中学';
  st.className = '初二（3）班';
  st.stage = '初中';
  st.grade = '初二';
  st.term = '2026—2027 学年 第一学期';
  st.termStart = '2026-08-31';
  st.teacher = { name: '李老师', gender: 'F', subject: '数学' };
  st.subjects = [
    { name: '语文', full: 120 },
    { name: '数学', full: 120 },
    { name: '英语', full: 120 },
    { name: '物理', full: 100 },
    { name: '道法', full: 100 },
    { name: '历史', full: 100 },
    { name: '生物', full: 100 }
  ];
  st.onboarded = true;

  var SUR =
    '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶'.split(
      ''
    );
  var BOY =
    '浩然 宇轩 子墨 博文 俊熙 泽宇 天佑 皓轩 睿泽 铭轩 嘉豪 思成 宇航 俊杰 明远 景行 晨阳 一帆 明哲 浩宇 子轩 梓睿 煜城 奕辰 嘉树 君浩'.split(
      ' '
    );
  var GIRL =
    '子涵 雨桐 可欣 一诺 梓萱 欣怡 语嫣 诗涵 雨萱 若曦 佳怡 雅琪 沐晴 安然 嘉懿 静怡 欣妍 雨彤 诗雨 若彤 晨曦 欣然 思琪 语桐'.split(
      ' '
    );
  var used = {};
  function mkName(g) {
    for (var i = 0; i < 50; i++) {
      var n = pick(SUR) + pick(g === 'M' ? BOY : GIRL);
      if (!used[n]) {
        used[n] = 1;
        return n;
      }
    }
    return pick(SUR) + pick(BOY);
  }
  var genders = [];
  for (var i = 0; i < 24; i++) genders.push('M');
  for (var j = 0; j < 22; j++) genders.push('F');
  genders.sort(function () {
    return R() - 0.5;
  });
  var DADS = '建国 志强 海涛 晓东 立新 伟 军 磊 勇 斌 浩 鹏'.split(' ');
  var MOMS = '丽 静 敏 燕 芳 娟 霞 婷 红梅 晓燕 秀英 慧'.split(' ');
  var JOBS = [
    '工程师',
    '个体经营',
    '教师',
    '医生',
    '公务员',
    '销售',
    '工人',
    '司机',
    '会计',
    '自由职业',
    '务农',
    '企业职员'
  ];
  var PERS = [
    '开朗大方，乐于助人',
    '内向安静，做事认真细致',
    '活泼好动，集体荣誉感强',
    '有主见，组织能力强',
    '心思细腻，比较敏感',
    '幽默风趣，人缘好',
    '踏实稳重，责任心强',
    '好胜心强，不服输'
  ];
  var HEALTH = [
    '',
    '',
    '',
    '',
    '轻度近视，已配眼镜',
    '对花生过敏',
    '有哮喘史，体育课需注意',
    '',
    ''
  ];
  var seatsAll = [];
  for (var r = 0; r < 6; r++) for (var c = 0; c < 8; c++) seatsAll.push(r + '-' + c);
  seatsAll = seatsAll.filter(function (k) {
    return k !== '5-6' && k !== '5-7';
  });
  seatsAll.sort(function () {
    return R() - 0.5;
  });
  var today = new Date();
  var students = [];
  genders.forEach(function (g, i) {
    var name = mkName(g);
    var sur = name.charAt(0);
    var by = R() < 0.72 ? 2012 : 2013;
    var bm = by === 2012 ? 9 + Math.floor(R() * 4) : 1 + Math.floor(R() * 8);
    var bd = 1 + Math.floor(R() * 28);
    var a = gauss();
    var fam = R() < 0.74 ? '双亲家庭' : pick(['单亲家庭', '隔代抚养', '父母在外务工', '重组家庭']);
    var parents = [];
    if (fam !== '隔代抚养' && fam !== '父母在外务工') {
      if (fam !== '单亲家庭' || R() < 0.3)
        parents.push({
          name: sur + pick(DADS),
          rel: '父亲',
          phone: '1380000' + pad2(Math.floor(R() * 100)) + pad2(Math.floor(R() * 100)),
          job: pick(JOBS)
        });
      parents.push({
        name: pick(SUR) + pick(MOMS),
        rel: '母亲',
        phone: '1390000' + pad2(Math.floor(R() * 100)) + pad2(Math.floor(R() * 100)),
        job: pick(JOBS)
      });
    } else {
      var gp = pick([
        ['奶奶', '祖母'],
        ['爷爷', '祖父'],
        ['外婆', '外祖母']
      ]);
      parents.push({
        name: (gp[0] === '外婆' ? pick(SUR) : sur) + gp[0],
        rel: gp[1],
        phone: '1370000' + pad2(Math.floor(R() * 100)) + pad2(Math.floor(R() * 100)),
        job: '退休'
      });
      if (fam === '父母在外务工')
        parents.push({
          name: sur + pick(DADS),
          rel: '父亲',
          phone: '1380000' + pad2(Math.floor(R() * 100)) + pad2(Math.floor(R() * 100)),
          job: '在外务工'
        });
    }
    var tags = [];
    if (fam === '父母在外务工') tags.push('留守');
    if (fam === '单亲家庭') tags.push('单亲');
    if (R() < 0.2) tags.push('住校');
    if (R() < 0.15) tags.push(pick(['体育特长', '文艺特长']));
    if (a < -1.1) tags.push('重点关注');
    var famNote = {
      双亲家庭: pick([
        '父母都很重视学习，每周会主动沟通一次',
        '家庭氛围好，周末常带孩子参加户外活动',
        '父母工作较忙，平时主要是妈妈辅导作业',
        '二孩家庭，有一个上小学的妹妹',
        '家长配合度高，家长群里回复及时'
      ]),
      单亲家庭: '跟随妈妈生活，妈妈工作时间长，孩子比较独立',
      隔代抚养: '父母在外地工作，由奶奶照顾，作业主要靠自觉',
      父母在外务工: '父母在外省务工，春节回家，平时跟爷爷奶奶生活',
      重组家庭: '重组家庭，与继父关系还在磨合，需要多关心情绪'
    }[fam];
    var study =
      a > 0.9
        ? pick([
            '学习主动，思维活跃，作业质量高',
            '成绩稳定在前列，数学和物理是强项',
            '自主学习能力强，可以带动小组同学'
          ])
        : a > -0.4
          ? pick([
              '基础扎实，偶有粗心，需要加强错题整理',
              '上课认真但不太敢举手发言',
              '文科较好，理科计算容易失分',
              '学习态度端正，成绩有上升空间'
            ])
          : pick([
              '学习习惯还在养成，上课容易走神，需多鼓励',
              '基础比较薄弱，英语单词积累不够',
              '作业偶尔拖欠，需要家校配合督促'
            ]);
    var s1 = {
      id: 'stu' + (100 + i),
      name: name,
      gender: g,
      no: '2503' + pad2(i + 1),
      seat: seatsAll[i] || null,
      group: 0,
      birthday: by + '-' + pad2(bm) + '-' + pad2(bd),
      role: '',
      tags: tags,
      boarding: tags.indexOf('住校') >= 0,
      parents: parents,
      family: fam,
      familyNote: famNote,
      study: study,
      strengths: '',
      personality: pick(PERS),
      health: pick(HEALTH),
      note: '',
      comments: [],
      _a: a,
      _t: gauss() * 0.025
    };
    if (s1.seat) s1.group = Math.floor(+s1.seat.split('-')[1] / 2);
    students.push(s1);
  });
  // 学号按姓名排序重排更真实
  students
    .slice()
    .sort(function (x, y) {
      return x.name.localeCompare(y.name, 'zh');
    })
    .forEach(function (x, i) {
      x.no = '2503' + pad2(i + 1);
    });
  // 今天生日 + 本周生日
  students[3].birthday = '2012-' + pad2(today.getMonth() + 1) + '-' + pad2(today.getDate());
  var d2 = new Date(today.getTime() + 3 * 86400000);
  students[11].birthday = '2013-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate());
  // 班干部
  var byA = students.slice().sort(function (x, y) {
    return y._a - x._a;
  });
  var roleList = [
    '班长',
    '学习委员',
    '副班长',
    '数学课代表',
    '语文课代表',
    '英语课代表',
    '物理课代表',
    '纪律委员',
    '体育委员',
    '文艺委员',
    '劳动委员'
  ];
  roleList.forEach(function (rl, k) {
    var cand = byA[(k * 2) % byA.length];
    if (!cand.role) cand.role = rl;
  });
  students.forEach(function (x) {
    if (x.role === '体育委员' && x.tags.indexOf('体育特长') < 0) x.tags.push('体育特长');
  });
  // 考试
  var examDefs = [
    {
      name: '初一期中',
      date: '2026-04-24',
      type: '期中',
      subs: ['语文', '数学', '英语', '生物', '道法', '历史']
    },
    {
      name: '初一期末',
      date: '2026-06-30',
      type: '期末',
      subs: ['语文', '数学', '英语', '生物', '道法', '历史']
    },
    {
      name: '九月月考',
      date: '2026-09-26',
      type: '月考',
      subs: ['语文', '数学', '英语', '物理', '道法', '历史']
    },
    {
      name: '期中考试',
      date: '2026-10-23',
      type: '期中',
      subs: ['语文', '数学', '英语', '物理', '道法', '历史']
    }
  ];
  var subStrength = {};
  students.forEach(function (x) {
    subStrength[x.id] = {};
    st.subjects.forEach(function (sb) {
      subStrength[x.id][sb.name] = gauss();
    });
  });
  var subBase = {
    语文: 0.79,
    数学: 0.74,
    英语: 0.75,
    物理: 0.72,
    道法: 0.82,
    历史: 0.8,
    生物: 0.8
  };
  s.exams = examDefs.map(function (ed, ei) {
    var subs = ed.subs.map(function (nm) {
      var f = st.subjects.filter(function (q) {
        return q.name === nm;
      })[0];
      return { name: nm, full: f ? f.full : 100 };
    });
    var scores = {};
    students.forEach(function (x) {
      var row = {};
      subs.forEach(function (sb) {
        var p =
          subBase[sb.name] +
          0.105 * x._a +
          0.045 * subStrength[x.id][sb.name] +
          x._t * (ei - 1.5) +
          0.035 * gauss();
        p = clamp(p, 0.28, 0.985);
        var v = Math.round(p * sb.full * 2) / 2;
        row[sb.name] = v;
      });
      scores[x.id] = row;
    });
    return {
      id: 'ex' + (ei + 1),
      name: ed.name,
      date: ed.date,
      type: ed.type,
      subjects: subs,
      scores: scores
    };
  });
  // 一名学生期中缺考英语
  s.exams[3].scores[students[20].id]['英语'] = null;
  students.forEach(function (x) {
    delete x._a;
    delete x._t;
  });
  s.students = students;
  // 考勤
  var tday = todayStr();
  s.attendance[tday] = {};
  s.attendance[tday][students[7].id] = 'leave';
  s.attendance[tday][students[30].id] = 'late';
  for (var dd = 1; dd < 20; dd++) {
    var dt = new Date(today.getTime() - dd * 86400000);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    var key = todayStr(dt),
      rec = {};
    if (R() < 0.6) rec[pick(students).id] = pick(['leave', 'late', 'leave', 'absent']);
    if (R() < 0.3) rec[pick(students).id] = 'late';
    s.attendance[key] = rec;
  }
  // 点评积分
  var reasons = st.reasons;
  for (var pi = 0; pi < 120; pi++) {
    var who = pick(students);
    var rs =
      R() < 0.78
        ? pick(
            reasons.filter(function (q) {
              return q.d > 0;
            })
          )
        : pick(
            reasons.filter(function (q) {
              return q.d < 0;
            })
          );
    s.points.push({
      id: 'p' + pi,
      sid: who.id,
      d: rs.d,
      r: rs.t,
      t: today.getTime() - Math.floor(R() * 24) * 86400000 - Math.floor(R() * 8) * 3600000
    });
  }
  s.points.sort(function (a, b) {
    return b.t - a.t;
  });
  // 成长记录
  var recs = [
    [5, '谈话', '期中英语缺考，了解情况为发烧请假，已安排补考'],
    [0, '表扬', '主动帮助同学讲解数学错题，在班会上提出表扬'],
    [9, '家访', '家访：奶奶反映晚上玩手机时间偏长，约定每天 9 点交手机'],
    [2, '获奖', '校运会 400 米第二名'],
    [14, '谈话', '最近上课注意力不集中，谈话后表示愿意调整作息'],
    [21, '提醒', '连续两次作业未按时提交，已与家长电话沟通'],
    [6, '获奖', '区作文比赛二等奖'],
    [17, '表扬', '主动承担黑板报设计，排版和配色很用心'],
    [12, '谈话', '情绪低落，自述和同桌闹矛盾，已调解'],
    [25, '家访', '电话家访：妈妈希望多关注孩子的数学']
  ];
  recs.forEach(function (rc, k) {
    s.records.push({
      id: 'r' + k,
      sid: students[(k * 7 + 3) % students.length].id,
      type: rc[1],
      text: rc[2],
      date: todayStr(new Date(today.getTime() - rc[0] * 86400000))
    });
  });
  s.todos = [
    { id: 't1', text: '周五前收齐秋游安全回执', done: false },
    { id: 't2', text: '准备周一班会课：期中考试总结', done: false },
    { id: 't3', text: '联系 3 位成绩下滑学生的家长', done: false },
    { id: 't4', text: '提交十月班级安全教育记录', done: true }
  ];
  st.boardLeft = '1 语文  2 数学\n3 英语  4 物理\n5 体育  6 道法\n7 历史  8 自习';
  var duty = students
    .filter(function (x) {
      return x.seat;
    })
    .slice(0, 4)
    .map(function (x) {
      return x.name;
    });
  st.boardRight =
    '值日：' + duty.slice(0, 2).join(' ') + '\n作业：数学练习册 P32–33\n英语：背诵 Unit 4 课文';
  return s;
}

export { demoState };

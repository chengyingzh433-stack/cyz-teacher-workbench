import { avatar, teacherAvatar, crop, characterSprite } from './sprites.js';
import { characterOf, teacherCharacter } from '../core/characters.js';
// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE

/* =========================================================
   ART · 像素教室场景与角色
   SVG 负责布局、状态与交互，PNG 图集提供用户指定的美术资产
   ========================================================= */
var ART = (function () {
  var INK = '#171717';
  var GROUPS = [
    { name: '第一组', color: '#e5483b' },
    { name: '第二组', color: '#2f7ff0' },
    { name: '第三组', color: '#f2b01e' },
    { name: '第四组', color: '#14b0a6' },
    { name: '第五组', color: '#7a5af5' },
    { name: '第六组', color: '#3ea35c' }
  ];

  function escx(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function hash(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function groupColor(i) {
    return GROUPS[((i % GROUPS.length) + GROUPS.length) % GROUPS.length].color;
  }

  /* ---------- 布局 ---------- */
  /* extra：根据屏幕宽高比加宽教室两侧（放图书角、生物角等），避免左右大片留白 */
  function layout(rows, pairs, extra, options = {}) {
    const cols = options.cols || pairs * 2;
    pairs = Math.ceil(cols / 2);
    var L = { rows: rows, pairs: pairs, cols: cols };
    extra = Math.max(0, Math.round(extra || 0));
    L.DW = 100;
    L.DD = 44;
    L.DF = 10;
    L.LEG = 18;
    L.PAIR = L.DW * 2;
    L.AISLE = 58;
    L.SIDE = 146;
    L.WT = 16;
    var ae = pairs > 1 ? Math.min(56, Math.floor(extra * 0.07)) : 0;
    L.AISLE += ae;
    extra -= ae * (pairs - 1);
    var half = Math.min(320, Math.floor(extra / 2)); // 两侧各最多加宽 320，再宽就留一点边距
    L.SIDEL = L.SIDE + half;
    L.SIDER = L.SIDE + half;
    L.FRONT = 214; // 前墙立面高度
    L.PLAT = 92; // 讲台地台进深
    L.ROW = 118; // 行距
    L.gridW = cols * L.DW + (pairs - 1) * L.AISLE;
    L.W = L.gridW + L.SIDEL + L.SIDER + 2 * L.WT;
    L.gx0 = L.WT + L.SIDEL;
    L.gx1 = L.gx0 + L.gridW;
    L.FRONT = L.W * 0.21;
    L.PLAT = L.W * 0.14;
    L.row0 = L.FRONT + L.PLAT + 24;
    L.BACK = 96;
    L.H = L.row0 + rows * L.ROW + L.BACK + L.WT;
    if (options.studentsOnly) {
      L.gx0 = 16;
      L.gx1 = L.gx0 + L.gridW;
      L.row0 = 28;
      L.W = L.gridW + 32;
      L.H = L.row0 + rows * L.ROW + 16;
    }
    L.seatX = function (c) {
      var p = Math.floor(c / 2),
        s = c % 2;
      return L.gx0 + p * (L.PAIR + L.AISLE) + s * L.DW;
    };
    L.seatY = function (r) {
      return L.row0 + r * L.ROW;
    };
    L.headX = function (c) {
      return L.seatX(c) + L.DW / 2;
    };
    L.headY = function (r) {
      return L.seatY(r) + 38;
    };
    return L;
  }

  function textAt(x, y, value, size = 14, fill = '#263e39', extra = '') {
    return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escx(String(value ?? ''))}</text>`;
  }
  function panel(x, y, w, h, fill, stroke = '#594b38') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  }
  function room(L) {
    const front = (L.W * 350) / 1024;
    const side = L.W * 0.125;
    // Nine-slice style composition: unchanged front wall, repeated floor, cropped side walls.
    return (
      `<defs><clipPath id="pixel-room-top" clipPathUnits="objectBoundingBox"><polygon points=".176,0 .835,0 1,.82 1,1 0,1 0,.82"/></clipPath><pattern id="pixel-floor" width="160" height="160" patternUnits="userSpaceOnUse">${crop('room', [355, 355, 170, 170], 0, 0, 160, 160, '', 'none', false)}</pattern></defs>` +
      panel(0, 0, L.W, L.H, '#d8d1ba', '#6e7368') +
      `<rect x="0" y="${front - 20}" width="${L.W}" height="${L.H - front + 20}" fill="url(#pixel-floor)"/>` +
      '<g clip-path="url(#pixel-room-top)">' +
      crop('room', [0, 0, 1024, 350], 0, 0, L.W, front, 'room-front', 'xMidYMid meet', false) +
      '</g>' +
      crop(
        'room',
        [0, 310, 118, 420],
        0,
        front,
        side,
        L.H - front,
        'room-side',
        'xMinYMin slice',
        false
      ) +
      crop(
        'room',
        [912, 310, 112, 420],
        L.W - side,
        front,
        side,
        L.H - front,
        'room-side',
        'xMaxYMin slice',
        false
      ) +
      `<path d="M${side} ${front}V${L.H - 14}H${L.W - side}V${front}" fill="none" stroke="#697b74" stroke-width="3" opacity=".7"/>`
    );
  }
  function boards(L, b) {
    const scale = L.W / 1024;
    let out = `<g transform="scale(${scale})" class="pixel-boards">`;
    out += panel(287, 80, 130, 91, '#283e36', '#22332b');
    out += panel(427, 85, 177, 75, '#4278aa', '#6397c2');
    out += panel(614, 80, 137, 91, '#283e36', '#22332b');
    out += textAt(294, 95, b.leftTitle || '今日课程', 10, '#f1e9d3');
    (b.leftLines || []).slice(0, 4).forEach((line, i) => {
      out += textAt(294, 112 + i * 13, line, 8.5, '#efeada');
    });
    out += textAt(622, 95, b.rightTitle || '今日事项', 10, '#f1e9d3');
    (b.rightLines || []).slice(0, 4).forEach((line, i) => {
      out += textAt(622, 112 + i * 13, line, 8, '#efeada');
    });
    out += textAt(515, 101, b.screenTop || '', 8.3, '#edf5fa', 'text-anchor="middle"');
    if (b.days !== null && b.days !== undefined) {
      out += textAt(
        515,
        117,
        '距' + (b.countLabel || '考试'),
        9,
        '#edf5fa',
        'text-anchor="middle"'
      );
      out += textAt(
        515,
        142,
        b.days + ' 天',
        23,
        '#fff5d1',
        'text-anchor="middle" font-weight="700"'
      );
    }
    out += textAt(515, 154, b.screenBottom || '', 8, '#edf5fa', 'text-anchor="middle"');
    // Keep the real clock hooks expected by tickClock(). Cover the painted hands.
    out += `<g class="clock" data-cx="515" data-cy="37"><circle cx="515" cy="37" r="22" fill="#eee9d9" stroke="#4c565b" stroke-width="2"/>`;
    for (let i = 0; i < 12; i++)
      out += `<path d="M515 17v3" stroke="#596568" transform="rotate(${i * 30} 515 37)"/>`;
    out +=
      '<path class="clock-h" d="M515 37V25" stroke="#374c4c" stroke-width="2.5"/><path class="clock-m" d="M515 37V20" stroke="#374c4c" stroke-width="1.5"/><circle cx="515" cy="37" r="2" fill="#a95f4e"/></g>';
    // Reuse the noticeboards, retaining the score-board click target and birthday information.
    out += `<g class="pixel-stars" data-sact="pt-board" role="button" aria-label="本周之星，查看积分榜">${panel(201, 94, 69, 80, '#f2ecd7', '#8c936b')}${textAt(206, 107, '本周之星', 8, '#4f604b')}`;
    const stars = b.stars || [];
    stars.slice(0, 3).forEach((s, i) => {
      out += textAt(206, 124 + i * 15, s.name + ' ' + s.pts, 6.5);
    });
    if (!stars.length) out += textAt(206, 127, '本周还没有点评', 6.5);
    out += '</g>';
    out +=
      panel(774, 94, 70, 80, '#f2ecd7', '#8c936b') + textAt(779, 107, '本月寿星', 8, '#4f604b');
    (b.bdays || []).slice(0, 4).forEach((s, i) => {
      out += textAt(779, 122 + i * 12, s.name + ' ' + s.date, 6.2);
    });
    if (!(b.bdays || []).length) out += textAt(779, 127, '本月暂无生日', 6.5);
    return out + '</g>';
  }
  function podium(L, teacher) {
    const scale = L.W / 1024,
      c = teacherCharacter(teacher);
    return (
      `<g class="teacher" data-character="${c.id}" transform="scale(${scale})" role="button" aria-label="教师资料">` +
      '<rect class="teacher-hit" x="460" y="140" width="110" height="190" fill="transparent"/>' +
      characterSprite(c, 'front', 467, 140, 88, 118, 'teacher-character') +
      // The original reference's lectern is placed in front of the character's lower body.
      crop('room', [441, 210, 145, 135], 441, 210, 145, 135, '', 'xMidYMid meet', false) +
      panel(461, 311, 105, 18, '#eee6ce', '#8f805f') +
      textAt(513, 323, teacher.label || '班主任', 8.2, '#4e493d', 'text-anchor="middle"') +
      '</g>'
    );
  }
  function scene(data) {
    const L = layout(data.rows, data.pairs, data.extra, data);
    let out = `<svg class="scene-svg pixel-classroom" viewBox="0 0 ${L.W} ${L.H}" width="${L.W}" height="${L.H}" xmlns="http://www.w3.org/2000/svg">`;
    if (!data.studentsOnly)
      out += room(L) + boards(L, data.board || {}) + podium(L, data.teacher || {});
    const deskBox = [445, 185, 655, 790],
      deskWidth = 96,
      deskHeight = (deskWidth * 790) / 655;
    for (let row = 0; row < data.rows; row++) {
      out += '<g class="row">';
      for (let col = 0; col < L.cols; col++) {
        const key = row + '-' + col,
          student = data.seats[key],
          view = (student && data.views?.[student.id]) || {};
        const x = L.seatX(col),
          y = L.seatY(row),
          cx = L.headX(col),
          cy = L.headY(row);
        const c = student && characterOf(student);
        out += `<g class="seat ${student ? 'has' : 'empty'} ${view.cls || ''}" data-seat="${key}"${student ? ` data-sid="${escx(student.id)}" data-character="${c.id}"` : ''} role="button" aria-label="${student ? escx(student.name) : '空座位'}，第${row + 1}排第${col + 1}座">`;
        out += `<rect class="hit" x="${x}" y="${y - 20}" width="${L.DW}" height="${L.ROW}" rx="8"/>`;
        out += `<ellipse cx="${cx}" cy="${y + 108}" rx="42" ry="10" fill="#243d35" opacity=".13"/>`;
        out += '<g class="desk-g">' + crop('desk', deskBox, x + 2, y, deskWidth, deskHeight);
        if (view.tint)
          out += `<rect class="tint" x="${x + 6}" y="${y + 4}" width="76" height="35" rx="2" fill="${view.tint}" opacity=".6"/>`;
        out += '</g>';
        if (student) {
          out +=
            `<g class="stu" transform="translate(${cx},${cy})"><g class="stu-in"><g class="head">` +
            `<svg x="-38" y="-20" width="76" height="69" viewBox="0 0 76 69" overflow="hidden">` +
            characterSprite(c, 'back', 0, 0, 76, 86, 'sprite-back') +
            characterSprite(c, 'front', 0, 0, 76, 86, 'sprite-front') +
            '</svg></g><text class="zz" x="24" y="-15" font-size="15" fill="#687b77">z</text></g></g>';
          // Redraw the chair back over the torso to seat the supplied standing silhouette.
          out += crop(
            'desk',
            [580, 540, 300, 190],
            x + 2 + ((580 - 445) * deskWidth) / 655,
            y + ((540 - 185) * deskWidth) / 655,
            (300 * deskWidth) / 655,
            (190 * deskWidth) / 655,
            'chair-foreground'
          );
        } else {
          out += `<g class="add">${panel(cx - 14, y + 48, 28, 28, '#fff9e9', '#6b806d')}${textAt(cx, y + 68, '+', 23, '#4f6b59', 'text-anchor="middle"')}</g>`;
        }
        const label = student ? student.name : '空位';
        const group = student ? view.color || groupColor(student.group || 0) : '#9ba491';
        out += `<g class="nameplate">${panel(x + 3, y - 17, 94, 19, '#fff9e9', '#a5987a')}<rect x="${x + 3}" y="${y - 17}" width="4" height="19" fill="${group}"/>${textAt(cx, y - 3, label, 12.5, '#293b35', 'class="lbl" text-anchor="middle"')}</g>`;
        if (view.badge) {
          const width = Math.max(27, view.badge.length * 8 + 12);
          out += `<g class="badge ${view.badgeTone || ''}" transform="translate(${x + L.DW - width},${y - 35})"><rect class="badge-bg" width="${width}" height="18" rx="5"/>${textAt(width / 2, 13, view.badge, 11, '#fff', 'class="badge-tx" text-anchor="middle"')}</g>`;
        }
        if (view.chip)
          out += `<g class="chip ${view.chipTone || ''}" transform="translate(${cx},${y + 58})"><rect class="chip-bg" x="-19" y="-10" width="38" height="20" rx="7"/>${textAt(0, 4, view.chip, 11, '#374e41', 'class="chip-tx" text-anchor="middle"')}</g>`;
        if (data.seatNos)
          out += textAt(x + 8, y + 112, row + 1 + '-' + (col + 1), 10, '#354c43', 'class="seatno"');
        out += '</g>';
      }
      out += '</g>';
    }
    // Subjects used to be written on a decorative homework rack. Keep that information visible.
    if (!data.studentsOnly)
      out += textAt(
        L.W / 2,
        L.H - 28,
        '作业收纳 · ' + (data.subjects || []).join(' / '),
        12,
        '#465c52',
        'text-anchor="middle"'
      );
    out += '<g class="fx-layer"></g></svg>';
    return { svg: out, L };
  }
  return { INK, GROUPS, groupColor, layout, scene, avatar, teacherAvatar, hash, rng };
})();
export { ART };

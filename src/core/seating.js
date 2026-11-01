// Seat dimensions use actual columns; legacy backups still use pairs of desks.
export const SEAT_LIMITS = { rows: 12, cols: 16 };
export function columnCount(settings) {
  return Number.isInteger(settings.cols) && settings.cols > 0 ? settings.cols : settings.pairs * 2;
}
export function seatKeys(rows, cols) {
  return Array.from({ length: rows * cols }, (_, i) => Math.floor(i / cols) + '-' + (i % cols));
}
export function resizeSeating(state, rows, cols) {
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > SEAT_LIMITS.rows ||
    !Number.isInteger(cols) ||
    cols < 1 ||
    cols > SEAT_LIMITS.cols
  )
    throw new Error('请输入 1–12 行、1–16 列的整数');
  const keys = seatKeys(rows, cols),
    valid = new Set(keys),
    occupied = new Set(),
    waiting = [];
  for (const student of state.students) {
    if (valid.has(student.seat) && !occupied.has(student.seat)) occupied.add(student.seat);
    else {
      student.seat = null;
      waiting.push(student);
    }
  }
  const available = keys.filter((key) => !occupied.has(key));
  waiting.forEach((student, i) => {
    student.seat = available[i] || null;
  });
  state.settings.rows = rows;
  state.settings.cols = cols;
  state.settings.pairs = Math.ceil(cols / 2);
  for (const student of state.students)
    if (student.seat) student.group = Math.floor(+student.seat.split('-')[1] / 2);
  return state.students.filter((student) => !student.seat).length;
}
export function pairedSeats(rows, cols, pairs) {
  const full = [],
    single = [],
    assignments = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c += 2)
      if (c + 1 < cols) full.push([r + '-' + c, r + '-' + (c + 1)]);
      else single.push(r + '-' + c);
  const remaining = [];
  for (const pair of pairs) {
    const desk = full.shift();
    if (desk)
      pair.forEach((student, i) => {
        if (student) assignments.push([student, desk[i]]);
      });
    else remaining.push(...pair.filter(Boolean));
  }
  remaining.forEach((student, i) => {
    if (single[i]) assignments.push([student, single[i]]);
  });
  return assignments;
}

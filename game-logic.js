export const BATTLE_ANIMALS = [
  { id: 'cat', emoji: '🐱', name: '量子小貓' },
  { id: 'dog', emoji: '🐶', name: '電光小狗' },
  { id: 'rabbit', emoji: '🐰', name: '星際小兔' },
  { id: 'bear', emoji: '🐻', name: '鋼甲小熊' },
  { id: 'fox', emoji: '🦊', name: '霓虹狐狸' },
  { id: 'panda', emoji: '🐼', name: '脈衝熊貓' },
  { id: 'penguin', emoji: '🐧', name: '冰晶企鵝' },
  { id: 'frog', emoji: '🐸', name: '電磁青蛙' },
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nonZeroDifference() {
  let d = 0;
  while (d === 0) d = randomInt(-10, 10);
  return d;
}

function term(a1, d, n) {
  return a1 + (n - 1) * d;
}

export function generateNthTermQuestion() {
  const a1 = randomInt(-20, 30);
  const d = nonZeroDifference();
  const n = randomInt(5, 20);
  return {
    type: 'nth-term',
    label: '找第 n 項',
    prompt: `已知等差數列的第一項 a₁ = ${a1}，公差 d = ${d}，求第 ${n} 項 a${n}。`,
    answer: term(a1, d, n),
    meta: { a1, d, n },
  };
}

export function generateDifferenceQuestion() {
  const a1 = randomInt(-20, 30);
  const d = nonZeroDifference();
  const m = randomInt(1, 8);
  const n = randomInt(m + 1, Math.min(m + 8, 16));
  const am = term(a1, d, m);
  const an = term(a1, d, n);
  return {
    type: 'difference',
    label: '求公差',
    prompt: `已知等差數列中 a${m} = ${am}，a${n} = ${an}，求公差 d。`,
    answer: d,
    meta: { a1, d, m, n, am, an },
  };
}

export function generateMissingTermQuestion() {
  const a1 = randomInt(-20, 30);
  const d = nonZeroDifference();
  const m = randomInt(1, 6);
  const n = randomInt(m + 2, Math.min(m + 8, 14));
  let targetN = randomInt(1, 18);
  while (targetN === m || targetN === n) targetN = randomInt(1, 18);
  const am = term(a1, d, m);
  const an = term(a1, d, n);
  return {
    type: 'missing-term',
    label: '由兩項求另一項',
    prompt: `已知等差數列中 a${m} = ${am}，a${n} = ${an}，求 a${targetN}。`,
    answer: term(a1, d, targetN),
    meta: { a1, d, m, n, targetN, am, an },
  };
}

export function generateArithmeticMeanQuestion() {
  const middle = randomInt(-20, 30);
  const step = nonZeroDifference();
  const left = middle - step;
  const right = middle + step;
  const mode = Math.random() < 0.5 ? 'symbol' : 'insert';
  return {
    type: 'arithmetic-mean',
    label: '計算等差中項',
    prompt: mode === 'symbol'
      ? `若 ${left}，x，${right} 成等差數列，求 x。`
      : `在 ${left} 與 ${right} 之間插入一個整數，使三個數成等差數列，求此整數。`,
    answer: middle,
    meta: { left, right, middle, step },
  };
}

const GENERATORS = [
  generateNthTermQuestion,
  generateDifferenceQuestion,
  generateMissingTermQuestion,
  generateArithmeticMeanQuestion,
];

export function generateQuestion(previousPrompt = '') {
  let q = GENERATORS[randomInt(0, GENERATORS.length - 1)]();
  for (let i = 0; i < 8 && q.prompt === previousPrompt; i += 1) {
    q = GENERATORS[randomInt(0, GENERATORS.length - 1)]();
  }
  return q;
}

export function generateChoices(answer) {
  const values = new Set([answer]);
  const radius = Math.max(4, Math.min(20, Math.abs(answer) > 20 ? 12 : 8));
  while (values.size < 4) {
    let candidate = answer + randomInt(-radius, radius);
    if (candidate === answer) {
      candidate += randomInt(1, 3) * (Math.random() < 0.5 ? -1 : 1);
    }
    if (Number.isInteger(candidate)) values.add(candidate);
  }
  const choices = [...values];
  for (let i = choices.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

function hashString(input) {
  let hash = 2166136261;
  for (const ch of String(input)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickBattleAnimals(seed) {
  const base = hashString(seed);
  const first = base % BATTLE_ANIMALS.length;
  const offset = 1 + ((base >>> 8) % (BATTLE_ANIMALS.length - 1));
  const second = (first + offset) % BATTLE_ANIMALS.length;
  return [BATTLE_ANIMALS[first], BATTLE_ANIMALS[second]];
}

export function opponentSeatFor(currentSeat) {
  return currentSeat === 1 ? 2 : 1;
}

export function makeBattleViewModel(state, currentSeat) {
  const seat1 = {
    seat: 1,
    name: state.player1_name || '玩家 1',
    hp: state.player1_hp ?? 7,
    score: state.player1_score ?? 0,
  };
  const seat2 = {
    seat: 2,
    name: state.player2_name || '玩家 2',
    hp: state.player2_hp ?? 7,
    score: state.player2_score ?? 0,
  };
  return currentSeat === 2
    ? { self: seat2, opponent: seat1 }
    : { self: seat1, opponent: seat2 };
}

export function presenceHasOpponent(presenceState, currentSeat) {
  const opponentSeat = opponentSeatFor(currentSeat);
  return Object.values(presenceState || {})
    .flatMap((entries) => Array.isArray(entries) ? entries : [])
    .some((entry) => Number(entry?.seat) === opponentSeat);
}

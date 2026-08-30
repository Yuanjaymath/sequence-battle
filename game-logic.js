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
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function nonZeroDifference() { let d=0; while(d===0)d=randomInt(-10,10); return d; }
function term(a1,d,n){return a1+(n-1)*d;}
export function generateNthTermQuestion(){const a1=randomInt(-20,30),d=nonZeroDifference(),n=randomInt(5,20);return{type:'nth-term',label:'找第 n 項',prompt:`已知等差數列的第一項 a₁ = ${a1}，公差 d = ${d}，求第 ${n} 項 a${n}。`,answer:term(a1,d,n),meta:{a1,d,n}}}
export function generateDifferenceQuestion(){const a1=randomInt(-20,30),d=nonZeroDifference(),m=randomInt(1,8),n=randomInt(m+1,Math.min(m+8,16)),am=term(a1,d,m),an=term(a1,d,n);return{type:'difference',label:'求公差',prompt:`已知等差數列中 a${m} = ${am}，a${n} = ${an}，求公差 d。`,answer:d,meta:{a1,d,m,n,am,an}}}
export function generateMissingTermQuestion(){const a1=randomInt(-20,30),d=nonZeroDifference(),m=randomInt(1,6),n=randomInt(m+2,Math.min(m+8,14));let targetN=randomInt(1,18);while(targetN===m||targetN===n)targetN=randomInt(1,18);const am=term(a1,d,m),an=term(a1,d,n),answer=term(a1,d,targetN);return{type:'missing-term',label:'由兩項求另一項',prompt:`已知等差數列中 a${m} = ${am}，a${n} = ${an}，求 a${targetN}。`,answer,meta:{a1,d,m,n,targetN,am,an}}}
export function generateArithmeticMeanQuestion(){const middle=randomInt(-20,30),step=nonZeroDifference(),left=middle-step,right=middle+step,mode=Math.random()<0.5?'symbol':'insert';return{type:'arithmetic-mean',label:'計算等差中項',prompt:mode==='symbol'?`若 ${left}，x，${right} 成等差數列，求 x。`:`在 ${left} 與 ${right} 之間插入一個整數，使三個數成等差數列，求此整數。`,answer:middle,meta:{left,right,middle,step}}}
const GENERATORS=[generateNthTermQuestion,generateDifferenceQuestion,generateMissingTermQuestion,generateArithmeticMeanQuestion];
export function generateQuestion(previousPrompt=''){let q=GENERATORS[randomInt(0,GENERATORS.length-1)]();for(let i=0;i<8&&q.prompt===previousPrompt;i++)q=GENERATORS[randomInt(0,GENERATORS.length-1)]();if(typeof document!=='undefined')queueMicrotask(()=>renderMultipleChoiceUi(q));return q;}
function hashString(input){let hash=2166136261;for(const ch of String(input)){hash^=ch.codePointAt(0);hash=Math.imul(hash,16777619)}return hash>>>0;}
export function pickBattleAnimals(seed){const base=hashString(seed),first=base%BATTLE_ANIMALS.length,offset=1+((base>>>8)%(BATTLE_ANIMALS.length-1)),second=(first+offset)%BATTLE_ANIMALS.length;return[BATTLE_ANIMALS[first],BATTLE_ANIMALS[second]];}

export function generateChoices(answer) {
  const values = new Set([answer]);
  let radius = Math.max(4, Math.min(20, Math.abs(answer) > 20 ? 12 : 8));
  while (values.size < 4) {
    let candidate = answer + randomInt(-radius, radius);
    if (candidate === answer) candidate += randomInt(1, 3) * (Math.random() < 0.5 ? -1 : 1);
    if (Number.isInteger(candidate)) values.add(candidate);
  }
  const choices = [...values];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

function ensureChoiceStyles() {
  if (document.getElementById('sequence-choice-styles')) return;
  const style = document.createElement('style');
  style.id = 'sequence-choice-styles';
  style.textContent = `
    .designer-credit{position:fixed;top:12px;right:12px;z-index:100;padding:7px 11px;border:1px solid rgba(83,221,255,.35);border-radius:999px;background:rgba(6,23,52,.84);color:#dffaff;font-size:.8rem;font-weight:850;letter-spacing:.03em;backdrop-filter:blur(8px);box-shadow:0 0 18px rgba(83,221,255,.12)}
    .choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}
    .choice-btn{min-height:60px;padding:12px 14px;border:1px solid rgba(83,221,255,.36);border-radius:14px;background:linear-gradient(180deg,rgba(19,52,91,.9),rgba(8,29,59,.96));color:white;font-size:1.08rem;font-weight:900;text-align:left;cursor:pointer;touch-action:manipulation}
    .choice-btn:active{transform:scale(.99)} .choice-btn:disabled{opacity:.5;cursor:wait}
    .choice-letter{display:inline-grid;place-items:center;width:30px;height:30px;margin-right:8px;border-radius:9px;background:rgba(83,221,255,.14);color:#9feaff;font-weight:950}
    @media(max-width:520px){.choice-grid{grid-template-columns:1fr}.designer-credit{top:8px;right:8px;font-size:.7rem;padding:6px 9px}}
  `;
  document.head.appendChild(style);
}

function installPersistentCredit() {
  ensureChoiceStyles();
  const title = document.getElementById('login-title');
  if (title) title.textContent = '輸入名字進入遊戲大廳';
  if (!document.querySelector('.designer-credit')) {
    const credit = document.createElement('div');
    credit.className = 'designer-credit';
    credit.textContent = '東興鍾元杰設計';
    credit.setAttribute('aria-label', '設計者');
    document.body.appendChild(credit);
  }
}

function getOrCreateChoiceGrid(answerForm) {
  let grid = document.getElementById('choice-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'choice-grid';
    grid.className = 'choice-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', '答案選項');
    answerForm.insertAdjacentElement('afterend', grid);
  }
  return grid;
}

function renderMultipleChoiceUi(question) {
  const answerForm = document.getElementById('answer-form');
  const answerInput = document.getElementById('answer-input');
  if (!answerForm || !answerInput) return;
  installPersistentCredit();
  answerForm.style.display = 'none';
  const grid = getOrCreateChoiceGrid(answerForm);
  grid.textContent = '';
  const letters = ['A','B','C','D'];
  const choices = generateChoices(question.answer);
  choices.forEach((value,index)=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='choice-btn';
    const badge=document.createElement('span');
    badge.className='choice-letter';
    badge.textContent=letters[index];
    button.append(badge, document.createTextNode(String(value)));
    button.addEventListener('click',()=>{
      grid.querySelectorAll('.choice-btn').forEach(btn=>btn.disabled=true);
      answerInput.value=String(value);
      answerForm.requestSubmit();
    });
    grid.appendChild(button);
  });
}

function installChoiceRecoveryObservers() {
  const feedback = document.getElementById('battle-feedback');
  if (feedback && !feedback.dataset.choiceObserver) {
    feedback.dataset.choiceObserver = '1';
    new MutationObserver(()=>{
      if (feedback.textContent.includes('答案送出失敗')) {
        document.querySelectorAll('.choice-btn').forEach(btn=>btn.disabled=false);
      }
    }).observe(feedback,{childList:true,characterData:true,subtree:true});
  }
  const result = document.getElementById('battle-result');
  if (result && !result.dataset.choiceObserver) {
    result.dataset.choiceObserver = '1';
    new MutationObserver(()=>{
      if (result.classList.contains('show')) document.querySelectorAll('.choice-btn').forEach(btn=>btn.disabled=true);
    }).observe(result,{attributes:true,attributeFilter:['class']});
  }
}

if (typeof document !== 'undefined') {
  queueMicrotask(()=>{
    installPersistentCredit();
    installChoiceRecoveryObservers();
  });
}

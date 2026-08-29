/*
 * LIENS TASK のロジックテスト
 *
 *   node test.mjs
 *
 * index.html から <script> を抜き出し、ブラウザAPIの薄いスタブを与えて実行する。
 * ビルドも依存も増やさないための割り切り。画面の見た目はテストしない。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const stubs = `
const localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=v;} };
const _els = {};
function _mk(id){ return { id, innerHTML:'', textContent:'', value:'', dataset:{}, hidden:false,
  classList:{toggle(){},add(){},remove(){}}, style:{}, addEventListener(){}, focus(){}, onclick:null }; }
const document = {
  getElementById(id){ if(!_els[id]) _els[id] = _mk(id); return _els[id]; },
  querySelectorAll: () => [], addEventListener(){}, createElement: () => ({click(){},onchange:null}),
  hidden:false
};
const location = { hash:'', pathname:'/', search:'', origin:'http://x' };
const history = { replaceState(){} };
const navigator = { clipboard:{ writeText:async()=>{} } };
const window = { matchMedia:()=>({matches:true}), addEventListener(){} };
function fetch(){ throw new Error('no net'); }
`;

const body = src.replace(/^\s*'use strict';/m, '').replace(/\nboot\(\);\s*$/, '\n');

const A = new Function(stubs + body + `
  return { parseInput, parseDue, score, urgency, merge, buildToday, addTask, D, S,
           TODAY, addDays, dayDiff, isRot, byScore, renderAll, renderProjects, NOPROJ, NEWPROJ,
           projStats, findOrCreateProject, projById, projByName, migrate, whoName,
           commitInline, openInline, closeInline, loadMemo, saveMemo, mergeMemo,
           weekKeyOf, weekDays, shiftWeek, shiftMonth, doneOn, doneBetween,
           getLog, logId, sheetRows, renderWeekSheet, renderMonthSheet, sheetNav,
           parseYMD, fmt,
           freeMinutes, todayOrder, lengthLabel, hhmm, calEventBody, calOn,
           setView:(w,m,mode)=>{ if(w)viewWeek=w; if(m)viewMonth=m; if(mode)sheetMode=mode; },
           view:()=>({week:viewWeek, month:viewMonth, mode:sheetMode}),
           inline:()=>inlineAdd, el:(id)=>document.getElementById(id),
           setD:(v)=>{D=v;}, getD:()=>D };
`)();

// 表示名は設定から入れる（ソースには実名を書かない）
A.S.names = { me:'オレ', mate:'相方' };
A.S.me = 'me';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return; }
  fail++;
  console.log('✗ ' + name + '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want));
};

/* ============ 入力の解析 ============ */
let p = A.parseInput('名刺を作り直す');
eq('素の入力', [p.title, p.star, p.due, p.project, p.size], ['名刺を作り直す', false, null, null, null]);

p = A.parseInput('見積りを送る #A社 @相方 !今日 30分 *');
eq('フル記法', [p.title, p.project, p.who, p.due, p.size, p.star],
   ['見積りを送る', 'A社', 'mate', A.addDays(0), 30, true]);

p = A.parseInput('見積りを送る ＃A社 ＠相方 ！明日 1h ★');
eq('全角記号', [p.project, p.who, p.due, p.star], ['A社', 'mate', A.addDays(1), true]);

eq('設定した表示名で @ が引ける', A.parseInput('x @オレ').who, 'me');
eq('@自分 も通る', A.parseInput('x @自分').who, 'me');

// 担当は「1人目/2人目」の固定スロット。端末が変わっても同じ人を指す
A.S.me = 'mate';
eq('相手の端末でも @1人目の名前 は1人目', A.parseInput('x @オレ').who, 'me');
eq('相手の端末では @自分 が2人目になる', A.parseInput('x @自分').who, 'mate');
eq('相手の端末では既定の担当も2人目', A.parseInput('x').who, 'mate');
A.S.me = 'me';

eq('+N日', A.parseInput('資料 !+3').due, A.addDays(3));
eq('M/D', A.parseInput('印刷 !8/30').due, new Date().getFullYear() + '-08-30');
eq('1時間 → 60分', A.parseInput('打合せ 1時間').size, 60);

p = A.parseInput('電話する !ほげ');
eq('解釈できない締切は本文に残る', [p.title, p.due], ['電話する !ほげ', null]);

p = A.parseInput('メール @たろう');
eq('知らない担当は本文に残る', [p.title, p.who], ['メール @たろう', 'me']);

eq('中身のない入力は title 空', A.parseInput('!今日').title, '');

{
  const nm = '日月火水木金土'[new Date().getDay()];
  eq('今日の曜日を指定 → 今日', A.parseDue(nm), A.addDays(0));
  eq('曜日+「曜日」表記', A.parseDue(nm + '曜日'), A.addDays(0));
}

/* ============ スコア ============ */
{
  const mk = o => Object.assign({ star:false, due:null, size:null,
    touchedAt:new Date().toISOString(), status:'active' }, o);
  eq('期限なし・★なし', A.score(mk({})), 0);
  eq('★のみ', A.score(mk({star:true})), 50);
  eq('今日締切', A.score(mk({due:A.addDays(0)})), 50);
  eq('期限切れ', A.score(mk({due:A.addDays(-2)})), 60);
  eq('★＋期限切れ', A.score(mk({star:true, due:A.addDays(-2)})), 110);
  eq('重いタスクは減点', A.score(mk({star:true, size:120})), 40);
  const old = new Date(Date.now() - 20*86400000).toISOString();
  eq('停滞ボーナス', A.score(mk({touchedAt:old})), 10);
  eq('★＋期限切れ > ★のみ',
     A.score(mk({star:true, due:A.addDays(-1)})) > A.score(mk({star:true})), true);
}

/* ============ 今日をつくる ============ */
const NOW = () => new Date().toISOString();
const task = (id, o) => Object.assign({ id, title:id, who:'me', projectId:null, due:null,
  star:false, size:null, status:'active', todayOn:null,
  createdAt:NOW(), updatedAt:NOW(), touchedAt:NOW(), doneAt:null }, o);

{
  // ★あり・期限なしは、放っておくと永久に上がってこない。1枠はそこから取る
  A.S.todayLimit = 3;
  A.setD({ tasks:[
    task('urgent1', {due:A.addDays(0)}),
    task('urgent2', {due:A.addDays(0)}),
    task('urgent3', {due:A.addDays(0)}),
    task('growth',  {star:true})
  ], projects:[], deleted:{} });
  A.buildToday();
  const picked = A.getD().tasks.filter(x => x.todayOn === A.TODAY()).map(x => x.id);
  eq('3枠のうち1枠は「★あり・締切が遠い」から取る', picked.includes('growth'), true);
  eq('積んだのは上限どおり3件', picked.length, 3);
}

{
  A.setD({ tasks:[
    task('already1', {todayOn:A.TODAY()}),
    task('already2', {todayOn:A.TODAY()}),
    task('overdue',  {due:A.addDays(-3)}),
    task('growth',   {star:true})
  ], projects:[], deleted:{} });
  A.buildToday();
  const added = A.getD().tasks.filter(x => x.todayOn === A.TODAY()).map(x => x.id);
  eq('残り1枠は最高スコア（期限切れ60 > ★50）', added.includes('overdue'), true);
  eq('上限を超えて積まない', added.length, 3);
}

/* ============ 案件（親）とタスク（子） ============ */
function seed(){
  A.setD({ tasks:[], projects:[], logs:[], notes:[], deleted:{} });
  A.S.showWho = 'all'; A.S.showStarOnly = false; A.S.showProject = null;
  A.S.groupBy = 'due'; A.S.showDoneProj = false; A.S.me = 'me'; A.S.todayLimit = 3;
  A.closeInline();
}
const count = h => h.match(/<span>(\d+) 件<\/span>/)[1];

{
  seed();
  A.addTask('提案書を作る #A社 *');
  A.addTask('印刷する #A社 !明日');
  A.addTask('サイト修正 #B社');
  A.addTask('銀行に行く');

  const d = A.getD();
  eq('#で案件が自動でできる', d.projects.map(x => x.name).sort(), ['A社','B社']);
  eq('同じ#は同じ案件にまとまる',
     d.tasks.filter(t => t.projectId === A.projByName('A社').id).length, 2);
  eq('#なしのタスクは案件に紐づかない', d.tasks.find(t => t.title === '銀行に行く').projectId, null);
  eq('案件には色がつく', /^hsl\(/.test(A.projByName('A社').color), true);

  const s = A.projStats(A.projByName('A社'));
  eq('案件の集計', [s.total, s.done, s.open, s.star], [2, 0, 2, 1]);
  // ★=50 は「明日」=35 より強い
  eq('次の一手は最高スコアのタスク', s.next.title, '提案書を作る');
}

{
  seed();
  A.addTask('提案書 #A社 *');
  A.addTask('印刷 #A社 !明日');
  let h = A.renderProjects();
  eq('案件タブに案件名が出る', h.includes('A社'), true);
  eq('次の一手が出る', h.includes('提案書'), true);
  eq('進捗が 0 / 2', h.includes('0 / 2'), true);
  eq('閉じているうちは子タスクを出さない', h.includes('data-act="done"'), false);

  const t = A.getD().tasks.find(x => x.title === '提案書');
  t.status = 'done'; t.doneAt = NOW();
  h = A.renderProjects();
  eq('完了ぶんが進捗に乗る', h.includes('1 / 2'), true);
  eq('次の一手が繰り上がる', h.includes('印刷'), true);
}

{
  seed();
  const p2 = A.findOrCreateProject('止まってる案件');
  let h = A.renderProjects();
  eq('タスクゼロの案件は「次の一手がない」と出る', h.includes('次の一手がない'), true);
  eq('止まっている件数を数える', h.includes('止まっている 1件'), true);

  p2.status = 'hold';
  h = A.renderProjects();
  eq('保留は状態チップが出る', h.includes('保留'), true);
  eq('保留は「次の一手がない」を出さない', h.includes('次の一手がない'), false);
  eq('保留は止まっている数に入れない', h.includes('止まっている'), false);

  p2.status = 'done';
  eq('完了案件は既定で隠れる', A.renderProjects().includes('止まってる案件'), false);
  eq('完了があると「完了も見る」が出る', A.renderProjects().includes('data-f="pdone"'), true);
  A.S.showDoneProj = true;
  eq('「完了も見る」で出てくる', A.renderProjects().includes('止まってる案件'), true);
  A.S.showDoneProj = false;
}

{
  seed();
  A.addTask('a #A社'); A.addTask('b #A社'); A.addTask('c #B社'); A.addTask('d');
  const pid = A.projByName('A社').id;

  let h = A.renderAll();
  eq('ぜんぶ: 既定は締切でまとめる', /期限なし \(4\)/.test(h), true);

  // 一覧から開かずに今日へ入れられる
  eq('ぜんぶ: 全行に「今日に入れる」が付く', (h.match(/data-act="on"/g) || []).length, 4);
  eq('ぜんぶ: ボタンは常に見えている（hover待ちではない）', h.includes('class="todaybtn"'), true);
  const one = A.getD().tasks[0];
  one.todayOn = A.TODAY();
  h = A.renderAll();
  eq('今日に入っている行は入った状態で出る', h.includes('todaybtn on'), true);
  eq('その行は押すと外れる', (h.match(/data-act="on"/g) || []).length, 3);
  one.todayOn = null;

  // ★の基準がその場で分かる
  eq('★に基準の説明が付く', A.renderAll().includes('★ 重要 — ' + A.S.starCriteria), true);

  h = A.renderAll();
  eq('ぜんぶ: 案件のチップが出る', h.includes('data-f="proj:'+pid+'"'), true);
  eq('ぜんぶ: 未分類のチップが出る', h.includes('data-f="proj:'+A.NOPROJ+'"'), true);

  A.S.groupBy = 'project';
  h = A.renderAll();
  eq('案件が見出しになる', /A社 \(2\)/.test(h) && /B社 \(1\)/.test(h) && /未分類 \(1\)/.test(h), true);
  eq('束ねているときは行のタグを出さない', h.includes('class="tag"'), false);
  eq('未分類は最後', h.indexOf('未分類 (1)') > h.indexOf('B社 (1)'), true);

  A.S.groupBy = 'due'; A.S.showProject = pid;
  eq('案件で絞り込める', count(A.renderAll()), '2');
  A.S.showProject = A.NOPROJ;
  eq('未分類で絞り込める', count(A.renderAll()), '1');

  A.S.showProject = 'p_なくなったやつ';
  const h2 = A.renderAll();
  eq('消えた案件の絞り込みは自動で解除', A.S.showProject, null);
  eq('解除後は全件', count(h2), '4');
  A.S.groupBy = 'due';
}

/* ============ その場で案件・タスクを作る ============ */
{
  seed();
  let h = A.renderProjects();
  eq('案件を作るボタンが出ている', h.includes('data-pnew'), true);
  eq('最初は入力を出さない', h.includes('data-inl='), false);

  A.openInline(A.NEWPROJ);
  eq('押すと案件名の入力が出る', A.renderProjects().includes('data-inl="'+A.NEWPROJ+'"'), true);

  A.el('inl').value = 'C社サイト';
  A.el('inl').dataset.inl = A.NEWPROJ;
  A.commitInline();
  eq('案件ができる', A.getD().projects.map(x => x.name), ['C社サイト']);
  const pid = A.projByName('C社サイト').id;
  eq('作った案件の入力に切り替わる（続けてタスクを打てる）', A.inline(), pid);
  eq('作った案件は開いた状態になる', A.renderProjects().includes('data-inl="'+pid+'"'), true);

  A.el('inl').value = '見積りを送る !明日 30分';
  A.el('inl').dataset.inl = pid;
  A.commitInline();
  const t = A.getD().tasks[0];
  eq('タスクがその案件の子になる', t.projectId, pid);
  eq('その場の入力でも記法が効く', [t.due, t.size], [A.addDays(1), 30]);
  eq('入れたあとも入力は開いたまま', A.inline(), pid);

  A.el('inl').value = '';
  A.commitInline();
  eq('空で確定すると入力が閉じる', A.inline(), null);

  A.openInline(pid);
  A.el('inl').value = 'べつの仕事 #D社';
  A.el('inl').dataset.inl = pid;
  A.commitInline();
  eq('明示した#が優先される', A.projById(A.getD().tasks[0].projectId).name, 'D社');
  A.closeInline();
}

/* ============ 旧形式からの移行 ============ */
{
  seed();
  A.setD({ tasks:[
    { id:'t1', title:'旧タスク', who:'kido', project:'A社', due:null, star:false, size:null,
      status:'active', todayOn:null, createdAt:NOW(), updatedAt:NOW(), touchedAt:NOW(), doneAt:null },
    { id:'t2', title:'相方のタスク', who:'saba', project:null, due:null, star:false, size:null,
      status:'active', todayOn:null, createdAt:NOW(), updatedAt:NOW(), touchedAt:NOW(), doneAt:null }
  ], projects:[], deleted:{} });
  A.S.me = 'kido';                 // 旧バージョンの設定が残っている状態
  A.migrate();
  const d = A.getD();
  eq('旧形式から案件レコードができる', d.projects.map(x => x.name), ['A社']);
  eq('タスクは projectId を持つ', d.tasks[0].projectId, d.projects[0].id);
  eq('古い project キーは消える', 'project' in d.tasks[0], false);
  eq('自分だった担当は me になる', d.tasks[0].who, 'me');
  eq('もう1人だった担当は mate になる', d.tasks[1].who, 'mate');
  eq('設定の自分も移る', A.S.me, 'me');
  A.S.me = 'me';
}

/* ============ マージ（2人で同時に触っても消えない） ============ */
{
  const T = (id, ts, extra) => Object.assign({ id, title:id, updatedAt:ts }, extra||{});
  const box = (tasks, projects, deleted) => ({ tasks, projects:projects||[], deleted:deleted||{} });

  eq('別々の追加は両方残る',
     A.merge(box([T('a','2026-08-01T00:00:00Z')]), box([T('b','2026-08-01T00:00:00Z')]))
      .tasks.map(t => t.id).sort(), ['a','b']);

  eq('同じものは新しい方が勝つ',
     A.merge(box([T('a','2026-08-02T00:00:00Z',{title:'新'})]),
             box([T('a','2026-08-01T00:00:00Z',{title:'旧'})])).tasks[0].title, '新');

  eq('相手が新しければ相手が勝つ',
     A.merge(box([T('a','2026-08-01T00:00:00Z',{title:'旧'})]),
             box([T('a','2026-08-03T00:00:00Z',{title:'新'})])).tasks[0].title, '新');

  const recent = new Date(Date.now()-86400000).toISOString();
  eq('削除は古い編集に勝つ（消える）',
     A.merge(box([T('a','2026-08-01T00:00:00Z')]), box([], [], {a:recent})).tasks.length, 0);

  const future = new Date(Date.now()+1000).toISOString();
  eq('削除のあとの編集は復活する',
     A.merge(box([T('a',future)]), box([], [], {a:recent})).tasks.map(t => t.id), ['a']);

  const oldTomb = new Date(Date.now()-40*86400000).toISOString();
  eq('30日より古い墓標は捨てる',
     Object.keys(A.merge(box([], [], {z:oldTomb}), box([])).deleted), []);

  eq('相手が空でもこちらの追加は消えない',
     A.merge(box([T('a','2026-08-01T00:00:00Z')]), box([])).tasks.map(t => t.id), ['a']);

  const P = (id, ts, name) => ({ id, name, color:'hsl(1 1% 1%)', status:'active', updatedAt:ts });
  eq('案件も新しい方が勝つ',
     A.merge(box([], [P('p1','2026-08-02T00:00:00Z','新名')]),
             box([], [P('p1','2026-08-01T00:00:00Z','旧名')])).projects[0].name, '新名');

  eq('別々の案件は両方残る',
     A.merge(box([], [P('p1','2026-08-01T00:00:00Z','A')]),
             box([], [P('p2','2026-08-01T00:00:00Z','B')]))
      .projects.map(x => x.name).sort(), ['A','B']);

  const r = A.merge(
    box([T('t1','2026-08-01T00:00:00Z',{projectId:'p1'})], [P('p1','2026-08-01T00:00:00Z','X')]),
    box([], [], { p1: recent }));
  eq('案件を消しても子タスクは道連れにしない', r.tasks.length, 1);
  eq('親を失ったタスクは未分類になる', r.tasks[0].projectId, null);

  eq('projects が無い相手とも合流できる',
     A.merge({ tasks:[], deleted:{} }, { tasks:[], deleted:{} }).projects, []);
}

/* ============ 腐敗判定 ============ */
{
  const old = new Date(Date.now() - 30*86400000).toISOString();
  eq('30日放置は薄くなる', A.isRot({status:'active', todayOn:null, touchedAt:old}), true);
  eq('今日に積んであれば薄くならない', A.isRot({status:'active', todayOn:A.TODAY(), touchedAt:old}), false);
  eq('完了済みは対象外', A.isRot({status:'done', todayOn:null, touchedAt:old}), false);
  eq('最近さわったものは対象外', A.isRot({status:'active', todayOn:null, touchedAt:NOW()}), false);
}

/* ============ 週報シート ============ */
{
  // 週の区切り（既定は水曜はじまり）
  const wk = A.weekKeyOf(A.TODAY());
  eq('既定の週はじまりは水曜', A.parseYMD(wk).getDay(), 3);
  A.S.weekStart = 1;
  eq('設定を変えれば月曜はじまりになる', A.parseYMD(A.weekKeyOf(A.TODAY())).getDay(), 1);
  A.S.weekStart = 0;
  eq('日曜はじまりにもできる', A.parseYMD(A.weekKeyOf(A.TODAY())).getDay(), 0);
  A.S.weekStart = 3;
  const days = A.weekDays(wk);
  eq('週は7日', days.length, 7);
  eq('週の初日は週キーそのもの', days[0], wk);
  eq('週内のどの日から引いても同じ週になる',
     days.every(d => A.weekKeyOf(d) === wk), true);
  const d0 = A.parseYMD(wk);
  eq('次の週は7日後', A.shiftWeek(wk, 1),
     A.fmt(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 7)));
  eq('前の週に戻れる', A.shiftWeek(A.shiftWeek(wk, 1), -1), wk);
  eq('月をまたいで進める', A.shiftMonth('2026-12', 1), '2027-01');
  eq('月をまたいで戻れる', A.shiftMonth('2026-01', -1), '2025-12');
}

{
  seed();
  const wk = A.weekKeyOf(A.TODAY());
  const days = A.weekDays(wk);
  A.setView(wk, A.TODAY().slice(0,7), 'week');

  A.addTask('提案書を出す #A社');
  A.addTask('印刷する #A社');
  A.addTask('経費を入力 #B社');
  const pA = A.projByName('A社').id;

  // 月曜と水曜に1件ずつ完了させる
  const d = A.getD();
  const t1 = d.tasks.find(t => t.title === '提案書を出す');
  const t2 = d.tasks.find(t => t.title === '印刷する');
  t1.status = 'done'; t1.doneAt = days[0] + 'T04:00:00.000Z';
  t2.status = 'done'; t2.doneAt = days[2] + 'T04:00:00.000Z';

  eq('その日その案件で完了したものを拾う', A.doneOn(days[0], pA).map(t => t.title), ['提案書を出す']);
  eq('違う日は拾わない', A.doneOn(days[1], pA).length, 0);
  eq('違う案件は拾わない', A.doneOn(days[0], A.projByName('B社').id).length, 0);
  eq('週の合計を数える', A.doneBetween(days[0], days[6], pA).length, 2);

  let h = A.renderWeekSheet();
  eq('案件が行になる', h.includes('A社') && h.includes('B社'), true);
  eq('完了したタスクがセルに自動で入る', h.includes('提案書を出す') && h.includes('印刷する'), true);
  eq('7日ぶんの列が出る', (h.match(/data-cell="day"/g) || []).length, 7 * 2);
  eq('列は日付だけ（やること・メモの欄は無い）',
     h.includes('今週やること') || h.includes('>メモ<'), false);
  eq('完了カウントは出さない', h.includes('完了 '), false);
  eq('ふりかえり欄は無い', h.includes('data-note='), false);
  eq('土日に色を付けない', h.includes('wknd'), false);
  eq('今日の列にはっきり印が付く', h.includes('class="today">今日 '), true);
  eq('今日のセルにも印が付く', (h.match(/istoday/g) || []).length, 2);

  // 案件の目標
  eq('目標が無いときは足すボタンが出る', h.includes('＋ 目標'), true);
  A.projByName('A社').goal = '9月までに月5万';
  h = A.renderWeekSheet();
  eq('目標が案件の下に出る', h.includes('9月までに月5万'), true);
  eq('目標はその場で編集できる', h.includes('data-cell="goal"'), true);

  // 手で「やったこと」を足す
  A.getLog(wk, pA, true).manual.push({ id:'m_x', d: days[1], t:'電話で確認した' });
  eq('手で足した記録も同じセルに並ぶ', A.renderWeekSheet().includes('電話で確認した'), true);
}

{
  // 案件に紐づかないタスクの行
  seed();
  const wk = A.weekKeyOf(A.TODAY());
  A.setView(wk, A.TODAY().slice(0,7), 'week');
  A.addTask('銀行に行く');
  eq('案件なしの行が出る', A.renderWeekSheet().includes('案件なし'), true);
}

{
  // 週報は「その週に存在していた案件」だけを出す
  seed();
  const wk = A.weekKeyOf(A.TODAY());
  A.setView(wk, A.TODAY().slice(0,7), 'week');
  A.addTask('着手 #新案件');
  const p = A.projByName('新案件');

  eq('週の途中で作った案件はその週から出る', A.renderWeekSheet().includes('新案件'), true);
  A.setView(A.shiftWeek(wk, -1));
  eq('作る前の週には出ない', A.renderWeekSheet().includes('新案件'), false);

  A.setView(wk);
  p.status = 'done'; p.closedAt = A.TODAY() + 'T09:00:00.000Z';
  let h = A.renderWeekSheet();
  eq('終わらせた週にはまだ残る', h.includes('新案件'), true);
  eq('終わった案件には印が付く', h.includes('終了'), true);

  A.setView(A.shiftWeek(wk, 1));
  eq('翌週からは消える', A.renderWeekSheet().includes('新案件'), false);

  A.setView(wk);
  p.status = 'active'; p.closedAt = null;
  A.setView(A.shiftWeek(wk, 1));
  eq('完了を戻せば翌週にも出る', A.renderWeekSheet().includes('新案件'), true);
  A.setView(wk);
}

{
  // 記録のIDは週と案件から決まる → 2人が同時に書いてもマージできる
  eq('記録のIDは決め打ち', A.logId('2026-08-24', 'p_1'), 'l_2026-08-24_p_1');
  eq('案件なしのIDも決まる', A.logId('2026-08-24', null), 'l_2026-08-24_none');

  const L = (id, ts, plan) => ({ id, week:'2026-08-24', projectId:'p_1', plan,
    note:'', manual:[], updatedAt:ts });
  const r = A.merge(
    { tasks:[], projects:[], logs:[L('l_a','2026-08-25T00:00:00Z','新')], notes:[], deleted:{} },
    { tasks:[], projects:[], logs:[L('l_a','2026-08-24T00:00:00Z','旧')], notes:[], deleted:{} });
  eq('週の記録も新しい方が勝つ', r.logs[0].plan, '新');

  const N = (id, ts, text) => ({ id, kind:'week', key:'2026-08-24', text, updatedAt:ts });
  const r2 = A.merge(
    { tasks:[], projects:[], logs:[], notes:[N('n_1','2026-08-24T00:00:00Z','古い')], deleted:{} },
    { tasks:[], projects:[], logs:[], notes:[N('n_1','2026-08-26T00:00:00Z','新しい')], deleted:{} });
  eq('ふりかえりも新しい方が勝つ', r2.notes[0].text, '新しい');

  const r3 = A.merge({ tasks:[], deleted:{} }, { tasks:[], deleted:{} });
  eq('logs / notes が無い相手とも合流できる', [r3.logs, r3.notes], [[], []]);
}

{
  // 月のまとめ
  seed();
  const wk = A.weekKeyOf(A.TODAY());
  const days = A.weekDays(wk);
  A.setView(wk, days[0].slice(0,7), 'month');

  A.addTask('提案書 #A社');
  const t = A.getD().tasks[0];
  t.status = 'done'; t.doneAt = days[0] + 'T04:00:00.000Z';
  A.getLog(wk, A.projByName('A社').id, true).manual.push({ id:'m_1', d:days[1], t:'手で足した記録' });

  const h = A.renderMonthSheet();
  eq('月表に案件が並ぶ', h.includes('A社'), true);
  eq('この月にやったことに完了ぶんが出る', h.includes('提案書'), true);
  eq('この月にやったことに手書きぶんも出る', h.includes('手で足した記録'), true);
  eq('月にも自由記述の欄は無い', h.includes('data-note='), false);
  eq('月表の週セルからその週へ飛べる', h.includes('data-sn="goto:'), true);

  A.sheetNav('mode-week');
  eq('週表示に戻せる', A.view().mode, 'week');
  A.sheetNav('next');
  eq('次の週へ進める', A.view().week, A.shiftWeek(wk, 1));
  A.sheetNav('now');
  eq('今週に戻れる', A.view().week, A.weekKeyOf(A.TODAY()));
}

/* ============ Googleカレンダー ============ */
{
  // 空き時間（8時〜22時＝840分の枠で数える）
  const at = (h, m) => new Date(2026, 7, 27, h, m || 0).toISOString();
  const ev = (h1, m1, h2, m2, extra) =>
    Object.assign({ start:{ dateTime: at(h1, m1) }, end:{ dateTime: at(h2, m2) } }, extra || {});

  eq('予定が無ければ全部空き', A.freeMinutes([], 8, 22), 840);
  eq('1時間の予定で1時間減る', A.freeMinutes([ev(10,0,11,0)], 8, 22), 780);
  eq('重なった予定は二重に数えない',
     A.freeMinutes([ev(10,0,12,0), ev(11,0,13,0)], 8, 22), 840 - 180);
  eq('離れた予定は足し合わせる',
     A.freeMinutes([ev(9,0,10,0), ev(15,0,16,0)], 8, 22), 840 - 120);
  eq('終日予定は埋まっている扱いにしない',
     A.freeMinutes([{ start:{ date:'2026-08-27' }, end:{ date:'2026-08-27' } }], 8, 22), 840);
  eq('「予定なし」表示のものは数えない',
     A.freeMinutes([ev(10,0,12,0,{ transparency:'transparent' })], 8, 22), 840);
  eq('時間帯の外にはみ出したぶんは切る', A.freeMinutes([ev(6,0,9,0)], 8, 22), 780);
  eq('埋まりきっても負にならない', A.freeMinutes([ev(0,0,23,59)], 8, 22), 0);

  eq('長さの表示', [A.lengthLabel(840), A.lengthLabel(90), A.lengthLabel(45), A.lengthLabel(0)],
     ['14時間', '1時間30分', '45分', '0分']);
  eq('時刻の表示', A.hhmm(at(9, 5)), '09:05');
}

{
  // 時間が決まったものを先に、決まっていないものはスコア順に
  const mk = (id, o) => Object.assign({ id, title:id, who:'me', projectId:null, due:null,
    star:false, size:null, status:'active', todayOn:A.TODAY(), calStart:null,
    createdAt:NOW(), updatedAt:NOW(), touchedAt:NOW(), doneAt:null }, o);
  const t = (h) => new Date(2026, 7, 27, h).toISOString();

  const out = A.todayOrder([
    mk('うしろ'),
    mk('14時', { calStart: t(14) }),
    mk('★あり', { star:true }),
    mk('9時',  { calStart: t(9) })
  ]).map(x => x.id);
  eq('時間の決まったものが先頭に時間順で並ぶ', out.slice(0,2), ['9時','14時']);
  eq('残りはスコア順', out.slice(2), ['★あり','うしろ']);
}

{
  // カレンダーに書く中身
  seed();
  const t = A.addTask('提案書を出す');
  const body = A.calEventBody(t, '2026-08-27');
  eq('終日予定として書く', [body.start, body.end],
     [{ date:'2026-08-27' }, { date:'2026-08-27' }]);
  eq('タスクのIDを目印に入れる', body.extendedProperties.private.liensTask, t.id);
  eq('未完なら題名はそのまま', body.summary, '提案書を出す');
  t.status = 'done';
  eq('完了したら題名に印が付く', A.calEventBody(t, '2026-08-27').summary, '✅ 提案書を出す');

  A.S.gcalId = '';
  eq('クライアントIDが無ければ機能は出さない', A.calOn(), false);
  A.S.gcalId = 'xxx.apps.googleusercontent.com';
  eq('入っていれば有効', A.calOn(), true);
  A.S.gcalId = '';
}

/* ============ メモ ============ */
{
  A.saveMemo('電話メモ：折り返し 15時');
  eq('メモは保存して読み戻せる', A.loadMemo(), '電話メモ：折り返し 15時');

  A.saveMemo('');
  A.mergeMemo('取り込んだ中身');
  eq('空なら取り込んだものがそのまま入る', A.loadMemo(), '取り込んだ中身');

  A.saveMemo('もとの中身');
  A.mergeMemo('もとの中身');
  eq('同じ中身なら二重に足さない', A.loadMemo(), 'もとの中身');

  A.saveMemo('もとの中身');
  A.mergeMemo('別の中身');
  const m = A.loadMemo();
  eq('中身が違うときは上書きせず下に足す',
     m.startsWith('もとの中身') && m.includes('別の中身') && m.includes('---- 取り込み'), true);

  A.saveMemo('消したくない');
  A.mergeMemo('');
  eq('空を取り込んでも消えない', A.loadMemo(), '消したくない');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

/* ============================================================
 * 我家冰箱 · 应用逻辑
 * 纯原生 JS，无框架、无网络请求，数据存 localStorage
 * ============================================================ */
(function () {
  'use strict';

  const { ING, ALIAS, RECIPES, MEALS } = window.W2E;

  /* ------------------------------------------------------------
   * 1. 基础工具
   * ---------------------------------------------------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => dateKey(new Date());
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const fmtDate = k => { const d = parseKey(k); return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`; };
  const shortDay = k => {
    const t = todayKey();
    if (k === t) return '今天';
    if (k === addDays(t, 1)) return '明天';
    if (k === addDays(t, 2)) return '后天';
    return WEEK[parseKey(k).getDay()];
  };

  const norm = n => { const s = String(n || '').trim(); return ALIAS[s] || s; };
  // 用户自己加的食材存在 S.custom 里，优先于内置表之外单独兜一层
  const customOf = n => (S && S.custom ? S.custom.find(c => c.name === norm(n)) : null);
  const metaOf = n => {
    const k = norm(n), m = ING[k];
    if (m) return m;
    const c = customOf(k);
    if (c) return {
      icon: c.icon || '🥣',
      cat: c.group === '调料' ? '调料' : (c.group === '零食' ? '零食' : '食材'),
      unit: c.unit || '份', days: c.days || 14
    };
    return { icon: '🥣', cat: '食材', unit: '份', days: 14 };
  };
  // 有些食材没有合适的 emoji（或本机字体不支持），用单个汉字作图块
  const txtCls = m => /[\u4e00-\u9fa5]/.test((typeof m === 'string' ? m : m.icon) || '') ? 'txt-ico' : '';
  // 自己录的菜谱存在 S.recipes 里，和内置菜谱一起参与推荐 / 匹配 / 详情
  const myRecipes = () => (S && Array.isArray(S.recipes) ? S.recipes : []);
  const allRecipes = () => myRecipes().concat(RECIPES);
  const dishById = id => myRecipes().find(r => r.id === id) || RECIPES.find(r => r.id === id);

  /* ------------------------------------------------------------
   * 2. 存储
   * ---------------------------------------------------------- */
  const KEY = 'w2e.state.v1';
  let S = null;

  function seedItems() {
    const t = todayKey();
    const mk = (name, cat, qty, unit, days) => {
      const m = metaOf(name);
      const cond = (cat || m.cat) === '调料' || m.cat === '调料';
      const froze = /饺|馄饨|汤圆|虾|鱼|排骨|鸡腿|鸡翅|五花|牛|羊|培根/.test(name);
      return {
        id: uid(), name: norm(name), cat: cat || m.cat, qty, unit: unit || m.unit,
        expire: days == null ? null : addDays(t, days),
        zone: cond ? '调料' : (froze ? '冷冻' : '冷藏'), addedAt: t
      };
    };
    return [
      mk('鸡蛋', '食材', 6, '个', 12), mk('番茄', '食材', 3, '个', 4), mk('土豆', '食材', 2, '个', 12),
      mk('青椒', '食材', 2, '个', 5), mk('小葱', '调料', 3, '根', 3), mk('大蒜', '调料', 8, '瓣', 20),
      mk('姜', '调料', 2, '块', 25), mk('五花肉', '食材', 300, 'g', 2), mk('鸡腿肉', '食材', 300, 'g', 1),
      mk('香菇', '食材', 4, '朵', 3), mk('生菜', '食材', 1, '颗', 2), mk('剩饭', '剩菜', 1, '碗', 1),
      mk('生抽', '调料', 1, '瓶'), mk('老抽', '调料', 1, '瓶'), mk('蚝油', '调料', 1, '瓶'),
      mk('料酒', '调料', 1, '瓶'), mk('盐', '调料', 1, '袋'), mk('糖', '调料', 1, '袋'),
      mk('食用油', '调料', 1, '瓶'), mk('醋', '调料', 1, '瓶'), mk('淀粉', '调料', 1, '袋'),
      mk('豆瓣酱', '调料', 1, '勺'), mk('干辣椒', '调料', 10, '个')
    ];
  }

  function fresh() {
    return {
      v: 1,
      items: seedItems(),
      custom: [],
      recipes: [],
      plans: {},
      shop: [],
      checked: {},
      prefs: { people: 2, avoid: [], doorOpen: false },
      stats: { cooked: 0 },
      created: Date.now()
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const s = JSON.parse(raw);
      s.items = Array.isArray(s.items) ? s.items : [];
      s.custom = Array.isArray(s.custom) ? s.custom.filter(c => c && c.name) : [];
      // 自己录的菜谱：至少要有名字和食材，缺字段的老数据补默认值
      s.recipes = Array.isArray(s.recipes) ? s.recipes.filter(r => r && r.name && Array.isArray(r.ing))
        .map(r => Object.assign({ icon: '🍳', cat: '家常菜', time: 20, level: '新手', tags: [], steps: [], mine: true }, r)) : [];
      s.plans = s.plans || {};
      s.shop = s.shop || [];
      s.checked = s.checked || {};
      s.prefs = Object.assign({ people: 2, avoid: [], doorOpen: false }, s.prefs || {});
      // 开门状态不跨会话：每次打开都从「关着门」开始，哪怕上次关页面时是开着的
      s.prefs.doorOpen = false;
      s.stats = Object.assign({ cooked: 0 }, s.stats || {});
      // 老数据迁移：葱姜蒜这类以前被记成「食材」，改记到调料，不再冒充主料
      const aroma = { 小葱: 1, 大葱: 1, 姜: 1, 大蒜: 1 };
      s.items.forEach(it => {
        if (aroma[it.name] && it.cat !== '调料') it.cat = '调料';
        const m = ING[it.name];
        if (m && m.cat === '调料' && it.cat !== '调料') it.cat = '调料';
        // 调料独立成区，不再占冷藏 / 冷冻的格位
        if ((m && m.cat === '调料') || it.cat === '调料') it.zone = '调料';
        // v0.9 之前零食是独立货架：老数据里的零食层位按名字重新落到冷藏 / 冷冻
        if (it.zone === '零食') it.zone = null;
        // 老数据没有层位：肉 / 海鲜 / 速冻 / 冰品默认进冷冻室
        if (!it.zone) it.zone = FROZEN_HINT.test(it.name) ? '冷冻' : '冷藏';
      });
      return s;
    } catch (e) { return fresh(); }
  }

  // 落盘时把「门开着」抹掉：这一状态只活在当前这次会话里
  const snapshot = () => JSON.stringify(Object.assign({}, S, { prefs: Object.assign({}, S.prefs, { doorOpen: false }) }));
  const flush = () => { try { localStorage.setItem(KEY, snapshot()); } catch (e) { } };
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, snapshot()); } catch (e) { /* 隐私模式忽略 */ }
    }, 60);
  }

  /* ------------------------------------------------------------
   * 3. 菜谱匹配引擎
   * ---------------------------------------------------------- */
  const AVOID = [
    { k: '辣', label: '不吃辣', test: r => r.tags.some(t => /辣/.test(t)) || r.ing.some(i => /辣椒|豆瓣酱|花椒|辣椒油/.test(i.n)) },
    { k: '香菜', label: '不吃香菜', test: r => r.ing.some(i => i.n === '香菜') },
    { k: '海鲜', label: '不吃海鲜', test: r => r.ing.some(i => /虾|鱼|蟹|贝/.test(i.n)) },
    { k: '牛羊', label: '不吃牛羊', test: r => r.ing.some(i => /牛|羊/.test(i.n)) },
    { k: '猪肉', label: '不吃猪肉', test: r => r.ing.some(i => /猪|五花|排骨|火腿|培根/.test(i.n)) }
  ];

  function invIndex() {
    const m = {};
    S.items.forEach(it => { if (it.qty > 0) m[norm(it.name)] = it; });
    return m;
  }

  function isBlocked(r) {
    const av = S.prefs.avoid || [];
    return AVOID.some(a => av.includes(a.k) && a.test(r));
  }

  /* 食材角色：food=真食材（能撑起一道菜）· aroma=葱姜蒜等辅料 · season=调料
     调料和辅料默认「家里常备」，不算主料、缺了也不算缺菜 —— 否则只有调料也会推荐一堆菜 */
  const AROMA = new Set(['小葱', '大葱', '姜', '大蒜', '香菜', '蒜苗', '蒜苔']);
  function roleOf(n) {
    // 用 metaOf 而不是 ING：用户自己加的调料也该算调料，不能当主料撑着推荐
    const m = metaOf(n);
    if (m.cat === '调料') return 'season';
    // 零食是分类：放进冰箱占格、能算存量，但不能拿来撑一道菜
    if (m.cat === '零食') return 'snack';
    if (AROMA.has(norm(n))) return 'aroma';
    return 'food';
  }
  const ROLE_LABEL = { food: '', aroma: '辅料', season: '调料', snack: '零食' };
  // 冰箱里真正的食材（排除调料/辅料/零食），推荐必须靠它撑起来
  function foodItems() {
    return S.items.filter(it => it.qty > 0 && roleOf(it.name) === 'food');
  }

  function matchRecipe(r, idx) {
    idx = idx || invIndex();
    const have = [], miss = [], condMissing = [];
    let mains = 0;
    r.ing.forEach(i => {
      const n = norm(i.n);
      const role = roleOf(n);
      if (role !== 'food') {
        // 调料 / 辅料：只有在菜谱里被标为必需时才提示，但绝不参与「能不能做」
        if (i.m && !idx[n]) condMissing.push({ n, a: i.a, role });
        return;
      }
      if (!i.m) return;
      mains++;
      (idx[n] ? have : miss).push(Object.assign({}, i, { n }));
    });
    return {
      r, have, miss, mains, condMissing,
      ratio: mains ? have.length / mains : 0,
      // 至少有一道真食材能对上，才算「有据可依」的推荐
      anchored: have.length > 0
    };
  }

  // 临期食材（0~2 天内到期，且未过期）
  function expiringItems(days) {
    const t = todayKey();
    const d = days == null ? 2 : days;
    return S.items.filter(it => {
      if (!it.expire) return false;
      const left = diffDays(t, it.expire);
      return left >= 0 && left <= d;
    });
  }
  function expiredItems() {
    const t = todayKey();
    return S.items.filter(it => it.expire && diffDays(t, it.expire) < 0);
  }

  function scored(idx) {
    idx = idx || invIndex();
    const urg = {};
    expiringItems(3).forEach(it => { urg[norm(it.name)] = 1; });
    return allRecipes().filter(r => !isBlocked(r)).map(r => {
      const m = matchRecipe(r, idx);
      const useUrgent = m.have.filter(i => urg[i.n]).length;
      // 没有真食材兜底的菜（全靠调料/辅料）直接排到最后
      const anchor = m.anchored ? 0 : -99;
      const score = anchor - m.miss.length * 10 + m.ratio * 6 + useUrgent * 4 + (r.time <= 15 ? 1.2 : 0);
      return Object.assign(m, { score, useUrgent });
    }).sort((a, b) => b.score - a.score);
  }

  // 早餐要轻一点：早餐/主食类，或快手清淡的菜
  function mealFit(r, meal) {
    if (meal !== '早餐') return true;
    return r.cat === '早餐' || r.cat === '主食' ||
      (r.time <= 12 && (r.tags.includes('快手') || r.tags.includes('懒人') || r.tags.includes('清淡')));
  }

  // 差一点就能开饭：只差 1 样真食材，且手头已经占了多数
  function nearReady(idx) {
    return scored(idx).filter(m =>
      m.miss.length === 1 && m.have.length >= 1 &&
      (m.mains <= 2 || m.have.length / m.mains >= 0.5)
    );
  }
  function cookable(idx) {
    return scored(idx).filter(m => m.miss.length === 0 && m.mains > 0);
  }
  // 只推「有真食材撑着」的菜：冰箱里一样食材都没有时，这里一定是空的
  function recommended(idx, meal) {
    return scored(idx).filter(m => m.anchored && m.ratio >= 0.34 && (!meal || mealFit(m.r, meal)));
  }

  /* ------------------------------------------------------------
   * 4. 三餐计划
   * ---------------------------------------------------------- */
  function dayPlan(k) { return S.plans[k] || (S.plans[k] = { 早餐: [], 午餐: [], 晚餐: [] }); }
  function mealList(k, m) { const d = S.plans[k]; return (d && d[m]) || []; }

  function addDish(k, m, id) {
    const d = dayPlan(k);
    d[m] = d[m] || [];
    if (d[m].some(x => x.id === id)) return false;
    d[m].push({ id, done: false });
    save();
    return true;
  }
  function removeDish(k, m, id) {
    const d = S.plans[k]; if (!d || !d[m]) return;
    d[m] = d[m].filter(x => x.id !== id);
    save();
  }

  /* ------------------------------------------------------------
   * 5. 买菜单（自动汇总 + 手动添加）
   * ---------------------------------------------------------- */
  function shoppingEntries() {
    const idx = invIndex();
    const map = new Map();
    const add = (name, amount, src, manual) => {
      const n = norm(name);
      if (!n) return;
      let e = map.get(n);
      if (!e) { e = { name: n, amounts: [], srcs: [], manual: false }; map.set(n, e); }
      if (amount && !e.amounts.includes(amount)) e.amounts.push(amount);
      if (src && !e.srcs.includes(src)) e.srcs.push(src);
      if (manual) e.manual = true;
    };
    const t = todayKey();
    Object.keys(S.plans).forEach(k => {
      if (k < t) return;
      MEALS.forEach(m => {
        (S.plans[k][m] || []).forEach(x => {
          if (x.done) return;
          const r = dishById(x.id); if (!r) return;
          // 只把「真食材」的缺口汇总进来，调料/葱姜蒜不占买菜单
          r.ing.filter(i => i.m && roleOf(norm(i.n)) === 'food').forEach(i => {
            const n = norm(i.n);
            if (!idx[n]) add(n, i.a, `${shortDay(k)}${m}`);
          });
        });
      });
    });
    (S.shop || []).forEach(s => add(s.name, s.amount, null, true));
    return Array.from(map.values());
  }

  /* ------------------------------------------------------------
   * 6. 图标
   * ---------------------------------------------------------- */
  const svg = (p, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${extra || ''}>${p}</svg>`;
  const ic = {
    snow: svg('<path d="M12 2v20"/><path d="M4.6 6.8l14.8 10.4"/><path d="M19.4 6.8L4.6 17.2"/><path d="M12 5.4L9.6 3.2M12 5.4l2.4-2.2M12 18.6l-2.4 2.2M12 18.6l2.4 2.2"/>'),
    flame: svg('<path d="M12 22c3.9 0 6.5-2.6 6.5-6 0-4.5-4.5-6.5-4-12-2.8 1.5-4 4-4 6 0 1.2-1 1.8-1.8 1.2-.9-.7-1.2-2-.7-3.4C6.4 9.4 5.5 12 5.5 16c0 3.4 2.6 6 6.5 6z"/>'),
    chart: svg('<path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/>'),
    user: svg('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6"/>'),
    book: svg('<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v18H7.5A2.5 2.5 0 0 0 5 22V4.5z"/><path d="M9 7h7"/>'),
    list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.6-3.6"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    check: svg('<path d="M4.5 12.5l5 5 10-11"/>', ' stroke-width="2.4"'),
    chevron: svg('<path d="M9 6l6 6-6 6"/>'),
    calendar: svg('<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
    trash: svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
    close2: svg('<path d="M5 4h5l2.5 5-3 2a11 11 0 0 0 4 4l2-3 5 2.5v5a2 2 0 0 1-2 2C11 21.5 2.5 13 2.5 6a2 2 0 0 1 2-2z"/>'),
    spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
    arrow: svg('<path d="M5 12h13M13 6l6 6-6 6"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
    door: svg('<rect x="6" y="3" width="12" height="18" rx="3"/><path d="M15 12v3"/>'),
    back: svg('<path d="M15 5l-7 7 7 7"/>')
  };

  /* ------------------------------------------------------------
   * 7. UI 状态
   * ---------------------------------------------------------- */
  const UI = {
    view: 'fridge',
    zone: '冷藏',
    stockZone: '全部',
    stockQ: '',
    catGroup: '全部',
    catQ: '',
    catSel: new Set(),
    catZone: '冷藏',
    catZonePicked: false,   // 用户手动点过「冷藏 / 冷冻」没有：没点过就按食材自己推断
    rack: '调料',
    cf: null,
    cfDel: null,
    edit: null,
    pendingAdd: null,
    cat: '食材',
    q: '',
    manage: false,
    date: todayKey(),
    meal: '午餐',
    pickTab: '推荐',
    pickSel: new Set(),
    pickQ: '',
    libMode: '可做',
    libQ: '',
    libCat: '全部',
    form: { cat: '食材', days: 7, editId: null }
  };

  function toast(msg, warn) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (warn ? ' warn' : '');
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.className = 'toast' + (warn ? ' warn' : ''); }, 1900);
  }

  /* ------------------------------------------------------------
   * 8. 片段渲染
   * ---------------------------------------------------------- */
  function heroHTML() {
    const idx = invIndex();
    const total = S.items.filter(i => i.qty > 0).length;
    const foods = foodItems();
    const near = nearReady(idx);

    // 冰箱里没有真食材（或者只有调料）→ 一律不推荐，先引导把食材记进来
    if (!foods.length) {
      const seasonCount = S.items.filter(i => i.qty > 0 && roleOf(i.name) !== 'food').length;
      if (!total) {
        return `<div class="hero hero-guide" data-act="open-add">
          <div class="hero-thumb">🧊</div>
          <div><div class="hero-kicker">冰箱还是空的</div><h2>先放两样食材</h2>
          <div class="hero-sub">添完我就告诉你现在能做什么</div></div>
          <div class="hero-right"><div class="hero-cta">添加食材 ${ic.chevron}</div></div>
        </div>`;
      }
      return `<div class="hero hero-guide" data-act="open-add">
        <div class="hero-thumb">🧂</div>
        <div><div class="hero-kicker">现在还做不了菜</div><h2>先放两样食材</h2>
        <div class="hero-sub">调料不算数，添完我就知道能做什么</div></div>
        <div class="hero-right"><div class="hero-cta">添加食材 ${ic.chevron}</div>
        <div class="hero-count">现有 ${seasonCount} 样调料</div></div>
      </div>`;
    }

    if (!near.length) {
      const top = recommended(idx)[0] || cookable(idx)[0];
      if (!top) return '';
      const sub = top.miss.length
        ? `还差 ${top.miss.length} 样 · ${top.miss.map(m => m.n).join('、')}`
        : '食材全齐，随时能开火';
      return `<div class="hero" data-act="open-recipe" data-id="${top.r.id}">
        <div class="hero-thumb">${icoV(top.r.icon)}</div>
        <div><div class="hero-kicker">${top.miss.length ? '离你最近的菜' : '今天最该做的'}</div><h2>${esc(top.r.name)}</h2>
        <div class="hero-sub">${sub}</div></div>
        <div class="hero-right"><div class="hero-cta">看做法 ${ic.chevron}</div>
        <div class="hero-count">能做 ${cookable(idx).length} 道</div></div>
      </div>`;
    }
    const best = near[0];
    return `<div class="hero" data-act="open-recipe" data-id="${best.r.id}">
      <div class="hero-thumb">${icoV(best.r.icon)}</div>
      <div>
        <div class="hero-kicker">差一点就能开饭</div>
        <h2>${esc(best.r.name)}</h2>
        <div class="hero-sub">还差 1 样 · ${esc(best.miss[0].n)}，别的都齐了</div>
      </div>
      <div class="hero-right">
        <div class="hero-cta">查看匹配 ${ic.chevron}</div>
        <div class="hero-count">共 ${near.length} 道差一点</div>
      </div>
    </div>`;
  }

  /* ---------------- 冰箱：层位 / 外观 ---------------- */
  const ZONES = ['冷藏', '冷冻'];        // 左右滑切换的两页
  const COND = '调料';                   // 内胆下方那排瓶架，独立于两页
  const SNACK = '零食';                  // 只是一种「分类」，不是层位：零食照样放冷藏或冷冻
  const RACKS = [COND];                  // 冰箱里独立的架子只剩调料区
  const MOVE_ZONES = ['冷藏', '冷冻'];    // 编辑面板里能手动挪去的层位
  const ZONE_TABS = ['全部', ...ZONES, COND];
  // 老数据没记层位时，按名字猜一个（肉/海鲜/速冻/冰品进冷冻）
  const FROZEN_HINT = /饺|馄饨|汤圆|冰淇淋|冰激凌|雪糕|冰棍|冰棒|虾|鱼|排骨|牛|羊|鸡翅|鸡腿|五花|培根|香肠|腊|冻/;

  // 调料一律进调料区，不占冷藏 / 冷冻的格位
  const isCond = name => metaOf(name).cat === '调料';
  // 零食是分类：冰激凌放冷冻、巧克力放冷藏，两者都占冷格
  const isSnack = name => metaOf(name).cat === SNACK;
  const zoneLabel = z => (z === COND ? '调料区' : z + '室');
  function zoneFor(name, want) {
    if (isCond(name)) return COND;
    if (want === '冷藏' || want === '冷冻') return want;
    return FROZEN_HINT.test(name) ? '冷冻' : '冷藏';
  }
  function zoneOf(it) {
    if (isCond(it.name) || it.zone === COND || it.cat === '调料') return COND;
    if (it.zone === '冷藏' || it.zone === '冷冻') return it.zone;
    return FROZEN_HINT.test(it.name) ? '冷冻' : '冷藏';
  }
  function iconOf(it) { return it.icon || metaOf(it.name).icon; }
  // 图标字段有三种形态：emoji / 中文单字 / data:image（手绘像素图、或自定义食材的图）
  const isPic = v => typeof v === 'string' && v.slice(0, 11) === 'data:image/';
  function icoV(v, px) {
    if (isPic(v)) return `<img class="ico-img" src="${v}" alt=""${px ? ` style="width:${px}px;height:${px}px"` : ''}/>`;
    return v == null ? '' : String(v);
  }
  function icoHTML(it, cls) {
    if (it.img) return `<span class="${cls} has-img"><img src="${it.img}" alt=""/></span>`;
    const i0 = iconOf(it);
    const t = isPic(i0) ? '' : (/[\u4e00-\u9fa5]/.test(i0) ? 'txt-ico' : '');
    return `<span class="${cls} ${t}">${icoV(i0)}</span>`;
  }
  const leftDays = it => (it.expire ? diffDays(todayKey(), it.expire) : null);

  /* ---------------- 冰箱：关门外观 ---------------- */
  function fridgeClosedHTML() {
    const items = S.items.filter(i => i.qty > 0);
    const cold = items.filter(i => zoneOf(i) === '冷藏').length;
    const froz = items.filter(i => zoneOf(i) === '冷冻').length;
    const cond = items.filter(i => zoneOf(i) === COND).length;
    const snack = items.filter(i => isSnack(i.name)).length;
    const idx = invIndex();
    const canCook = cookable(idx).length;
    const near = nearReady(idx).length;
    const exp = expiringItems(2).length;
    return `<div class="fr-unit is-closed" data-act="toggle-door" title="点一下开门">
      <div class="fr-door fr-door-top">
        <div class="fr-gloss"></div>
        <div class="fr-logo">我家冰箱</div>
        <div class="fr-handle"></div>
        <div class="fr-tip">轻点开门</div>
        <button class="fr-note note-a" data-act="nav" data-v="stock">
          <i class="pin"></i>
          <span class="n-t">冰箱存货</span>
          <span class="n-v">${items.length}<small>样</small></span>
          <span class="n-s">${exp ? exp + ' 样快到期' : (items.length ? `冷藏 ${cold} · 冷冻 ${froz} · 调料 ${cond}` : '还是空的')}</span>
        </button>
        <button class="fr-note note-b" data-act="nav" data-v="recipes">
          <i class="pin"></i>
          <span class="n-t">能做啥</span>
          <span class="n-v">${canCook}<small>道</small></span>
          <span class="n-s">${near ? '还有 ' + near + ' 道差一点' : '看菜谱'}</span>
        </button>
        <button class="fr-note note-c" data-act="new-recipe" title="把你家的拿手菜录进来">
          <i class="pin"></i>
          <span class="n-t">录入菜谱</span>
          <span class="n-v n-act">＋ 加一道</span>
          <span class="n-s">${myRecipes().length ? `已录 ${myRecipes().length} 道` : '写一道存起来'}</span>
        </button>
      </div>
      <div class="fr-seam"></div>
      <div class="fr-door fr-door-bottom">
        <span class="fr-freeze">冷冻室 · ${froz} 样</span>
        <span class="fr-cond-tag">调料 ${cond} · 零食 ${snack}</span>
        <span class="fr-handle-h"></span>
      </div>
    </div>`;
  }

  /* ---------------- 冰箱：开门内胆 ---------------- */
  // 一屏 4 行 × 5 列 = 20 格，多出来的往下滚
  function cavityHTML(zone) {
    const list = S.items.filter(i => i.qty > 0 && zoneOf(i) === zone);
    const body = list.length
      ? `<div class="fr-grid">${list.map(frItemHTML).join('')}</div>`
      : `<div class="fr-empty"><span>${zone === '冷冻' ? '🧊' : '🥬'}</span>
          <b>${zone}室是空的</b><small>点下面「放入食材」加进来</small></div>`;
    return `<section class="fr-page" data-zone="${zone}">
      <div class="fr-cav-head"><b>${zone}室</b><span>${list.length} 样${list.length > 20 ? ' · 共 ' + Math.ceil(list.length / 5) + ' 行' : ''}</span></div>
      <div class="fr-cav-body">${body}</div>
      <div class="fr-cav-foot"><span class="fr-cav-hint">← 左右滑换区 · 上下滚看更多 →</span></div>
    </section>`;
  }

  function frItemHTML(it) {
    const left = leftDays(it);
    const warn = left != null && left <= 2;
    return `<button class="fr-item ${warn ? 'warn' : ''}" data-act="edit-item" data-id="${it.id}" title="${esc(it.name)}">
      ${icoHTML(it, 'fr-ico')}
      <span class="fr-nm">${esc(it.name)}</span>
      <span class="fr-q">${it.qty}${esc(it.unit || '')}</span>
    </button>`;
  }

  /* 下方架子区：只剩调料区（零食已改成普通分类，跟食材一样占冷格） */
  function condItemHTML(it) {
    const left = leftDays(it);
    const warn = left != null && left <= 2;
    return `<button class="fr-cond-item ${warn ? 'warn' : ''}" data-act="edit-item" data-id="${it.id}" title="${esc(it.name)}">
      ${icoHTML(it, 'fr-cond-ico')}
      <span class="fr-cond-nm">${esc(it.name)}</span>
    </button>`;
  }

  function rackItems(z) { return S.items.filter(i => i.qty > 0 && zoneOf(i) === z); }

  function rackInnerHTML() {
    const list = rackItems(COND);
    return `<div class="fr-cond-head fr-rack-head">
        <b class="rk-title">调料区<i>${list.length}</i></b>
        <span class="rk-live">不占冷格</span>
      </div>
      ${list.length
        ? `<div class="fr-cond-list">${list.map(condItemHTML).join('')}</div>`
        : `<button class="fr-cond-empty" data-act="go-catalog" data-g="${COND}">＋ 放点调料进来</button>`}`;
  }

  function condBarHTML() {
    return `<div class="fr-cond" id="frRack">${rackInnerHTML()}</div>`;
  }

  function paintRack() {
    const el = $('#frRack'); if (el) el.innerHTML = rackInnerHTML();
  }

  function fridgeOpenHTML() {
    const n = z => S.items.filter(i => i.qty > 0 && zoneOf(i) === z).length;
    return `<div class="fr-unit is-open">
      <div class="fr-interior">
        <div class="fr-zonebar">
          ${ZONES.map(z => `<button class="${UI.zone === z ? 'on' : ''}" data-act="fr-zone" data-z="${z}">${z}室<i>${n(z)}</i></button>`).join('')}
        </div>
        <div class="fr-pager" id="frPager">${cavityHTML('冷藏')}${cavityHTML('冷冻')}</div>
        ${condBarHTML()}
      </div>
    </div>`;
  }

  /* ---------------- 存货行（存货页） ---------------- */
  function stockRowHTML(it) {
    const left = leftDays(it);
    let badge;
    if (left == null) badge = `<em>没记保质期</em>`;
    else if (left < 0) badge = `<em class="b-red">过期 ${-left} 天</em>`;
    else if (left <= 2) badge = `<em class="b-amber">${left === 0 ? '今天到期' : left + ' 天后到期'}</em>`;
    else badge = `<em>还有 ${left} 天</em>`;
    return `<button class="st-row" data-act="edit-item" data-id="${it.id}">
      ${icoHTML(it, 'st-ico')}
      <span class="st-main">
        <span class="st-n">${esc(it.name)}${it.cat === '剩菜' ? '<i class="st-tag">剩</i>' : ''}</span>
        <span class="st-m">${badge}<i class="st-zone">${zoneOf(it)}</i></span>
      </span>
      <span class="st-q">${it.qty}${esc(it.unit || '')}</span>
    </button>`;
  }

  /* ---------------- 食材库（放入食材页） ---------------- */
  // 食材库的全集：自己加的排在前面（最近加的靠前），再接内置的 90 种
  function catalogNames() {
    const mine = (S.custom || []).slice().reverse().map(c => c.name);
    const out = [];
    mine.forEach(n => { if (!out.includes(n)) out.push(n); });
    Object.keys(ING).forEach(n => { if (!out.includes(n)) out.push(n); });
    return out;
  }

  function groupOf(n) {
    const c = customOf(n);
    if (c && c.group) return c.group;
    const m = ING[n] || {};
    if (m.cat === '调料') return '调料';
    if (/鱼|虾|蟹|贝|蛤|鱿|海参|紫菜|海带/.test(n)) return '水产';
    if (/肉|鸡|鸭|蛋|排骨|五花|培根|香肠|腊|牛|羊|猪|火腿/.test(n)) return '肉蛋';
    if (/豆腐|豆干|豆皮|腐竹|牛奶|酸奶|芝士|黄油|奶油/.test(n)) return '豆乳';
    if (/米|面|馒|饺|包子|粉丝|粉条|年糕|面包|饼|粥/.test(n)) return '主食';
    if (/薯片|饼干|坚果|瓜子|果冻|巧克力|糖果|辣条|肉干|蜜饯|爆米花|腰果|杏仁|核桃/.test(n)) return SNACK;
    if (m.cat === '剩菜') return '其他';
    return '蔬菜';
  }
  const CAT_GROUPS = ['全部', '蔬菜', '肉蛋', '水产', '主食', '豆乳', '调料', '零食', '其他'];

  function catRowHTML(n) {
    const m = metaOf(n);
    const on = UI.catSel.has(n);
    const has = S.items.some(i => i.name === n && i.qty > 0);
    const mine = !!customOf(n);
    const meta = mine
      ? `<i class="ct-mine">我加的</i> · 大概能放 ${m.days} 天 · <u class="ct-del" data-act="cat-del-custom" data-n="${esc(n)}">删掉</u>`
      : `${groupOf(n)} · 大约能放 ${m.days} 天`;
    return `<div class="ct-row ${on ? 'on' : ''}" data-act="cat-toggle" data-n="${esc(n)}">
      <span class="ct-check ${on ? 'on' : ''}">${ic.check}</span>
      <span class="ct-ico ${/[\u4e00-\u9fa5]/.test(m.icon) ? 'txt-ico' : ''}">${icoV(m.icon)}</span>
      <span class="ct-main">
        <span class="ct-n">${esc(n)}${has ? '<i class="have">冰箱里有</i>' : ''}</span>
        <span class="ct-m">${meta}</span>
      </span>
      <span class="ct-one" data-act="cat-one" data-n="${esc(n)}">单放</span>
    </div>`;
  }

  function dishCardHTML(x, k, m) {
    const r = x.id ? dishById(x.id) : x.r;
    const done = x.done;
    const mm = matchRecipe(r);
    const gap = mm.miss.length;
    return `<div class="dish-card ${done ? 'done' : ''}" data-act="open-recipe" data-id="${r.id}" data-from="${k}|${m}">
      <div class="dish-thumb">${icoV(r.icon)}</div>
      <div class="dish-main">
        <div class="dish-name">${esc(r.name)}</div>
        <div class="dish-meta">
          <span>${ic.clock.replace('<svg', '<svg style="width:12px;height:12px;vertical-align:-2px"')} ${r.time} 分钟</span>
          <span>·</span><span>${r.level}</span>
          ${gap ? `<span class="chip clay">缺 ${gap} 样</span>` : `<span class="chip sage">食材齐</span>`}
        </div>
      </div>
      <div class="dish-acts">
        <button class="done-btn ${done ? 'on' : ''}" data-act="toggle-done" data-id="${r.id}" data-k="${k}" data-m="${m}" title="做完打勾">${ic.check}</button>
      </div>
    </div>`;
  }

  /* ---------------- 视图：冰箱（首页，只放冰箱） ---------------- */
  function viewFridge() {
    const items = S.items.filter(i => i.qty > 0);
    const exp = expiringItems(2).length;
    const canCook = cookable(invIndex()).length;
    const open = !!S.prefs.doorOpen;
    const n = z => items.filter(i => zoneOf(i) === z).length;
    // 零食数在门板那条小字上已经有了，这里不再挤，免得摘要换行
    const sub = items.length
      ? `能做 ${canCook} 道 · 冷藏 ${n('冷藏')} / 冷冻 ${n('冷冻')} / 调料 ${n(COND)}${exp ? ` · <b>${exp} 样临期</b>` : ''}`
      : '还是空的 · 先放两样食材进来';
    return `<div class="fridge-screen">
      <div class="fs-head">
        <div>
          <h1>我家冰箱<em>。</em></h1>
          <div class="sub">${sub}</div>
        </div>
        <button class="icon-btn" data-act="nav" data-v="shop" title="买菜单">${ic.list}</button>
      </div>
      <div class="fs-body">${open ? fridgeOpenHTML() : fridgeClosedHTML()}</div>
      <div class="fs-ops">
        <button class="btn ${open ? 'btn-soft' : 'btn-primary'} op-btn" data-act="toggle-door">${ic.door}<span>${open ? '关上冰箱' : '打开冰箱'}</span></button>
        <button class="btn btn-soft op-btn" data-act="go-catalog">${ic.plus}<span>放入食材</span></button>
      </div>
    </div>`;
  }

  /* ---------------- 视图：冰箱存货 ---------------- */
  function viewStock() {
    const all = S.items.filter(i => i.qty > 0);
    const z = UI.stockZone, q = UI.stockQ.trim();
    const counts = { 全部: all.length, 冷藏: 0, 冷冻: 0, 调料: 0 };
    all.forEach(i => { counts[zoneOf(i)] += 1; });
    let list = all.filter(i => z === '全部' || zoneOf(i) === z);
    if (q) list = list.filter(i => i.name.includes(q));
    list = list.slice().sort((a, b) => {
      const la = a.expire ? diffDays(todayKey(), a.expire) : 9999;
      const lb = b.expire ? diffDays(todayKey(), b.expire) : 9999;
      return la - lb;
    });
    const exp = expiringItems(2).length;
    const em = z === '冷冻' ? '🧊' : z === COND ? '🧂' : '🥬';
    return `<div class="sub-page">
      <div class="sub-head">
        <button class="icon-btn" data-act="nav" data-v="fridge" title="回冰箱">${ic.back}</button>
        <div style="min-width:0;flex:1">
          <h1>冰箱存货<em>。</em></h1>
          <div class="sub">${all.length} 样${exp ? ` · ${exp} 样临期` : ''} · 点一样就能改</div>
        </div>
        <button class="icon-btn" data-act="go-catalog" title="放入食材">${ic.plus}</button>
      </div>
      <div class="pick-tabs">
        ${ZONE_TABS.map(x => `<button class="${z === x ? 'on' : ''}" data-act="stock-zone" data-z="${x}">${x} ${counts[x]}</button>`).join('')}
      </div>
      <label class="search-box">${ic.search}<input id="stockSearch" placeholder="找找冰箱里有什么" value="${esc(UI.stockQ)}" data-input="stock-q"/></label>
      ${list.length
        ? `<div class="st-list">${list.map(stockRowHTML).join('')}</div>`
        : `<div class="empty"><span class="em">${em}</span>
             ${q ? '没找到「' + esc(q) + '」' : (z === '全部' ? '冰箱还是空的' : zoneLabel(z) + '还是空的')}<br>
             <button class="btn btn-primary btn-sm" style="margin-top:12px" data-act="go-catalog">${ic.plus} 放入食材</button></div>`}
    </div>`;
  }

  /* ---------------- 视图：放入食材（食材库） ---------------- */
  function catBarHTML() {
    const n = UI.catSel.size;
    const names = Array.from(UI.catSel);
    const condN = names.filter(isCond).length;
    const snackN = names.filter(isSnack).length;
    return `<div class="cb-zones">
        ${ZONES.map(z => `<button class="${UI.catZonePicked && UI.catZone === z ? 'on' : ''}" data-act="cat-zone" data-z="${z}">${z}</button>`).join('')}
      </div>
      <div class="cb-info">${n ? `已选 <b>${n}</b> 样${condN ? ` · 含调料 ${condN}` : ''}${snackN ? ` · 含零食 ${snackN}` : ''}<em>${esc(names.slice(0, 2).join('、'))}${n > 2 ? ' 等' : ''}</em>` : '点一行选上，或点「单放」<em>不选层位就按食材自动放：调料进调料区、冰品进冷冻</em>'}</div>
      <button class="btn btn-primary cb-go" data-act="cat-add" ${n ? '' : 'disabled'}>放进去</button>`;
  }

  function paintCatBar() {
    const bar = $('.cat-bar'); if (bar) bar.innerHTML = catBarHTML();
  }

  function viewCatalog() {
    const q = UI.catQ.trim();
    const all = catalogNames();
    const mineN = all.filter(n => customOf(n)).length;
    const list = all.filter(n => {
      if (UI.catGroup !== '全部' && groupOf(n) !== UI.catGroup) return false;
      if (q && !n.includes(q)) return false;
      return true;
    });
    return `<div class="cat-screen">
      <div class="sub-head">
        <button class="icon-btn" data-act="go-back" title="返回">${ic.back}</button>
        <div style="min-width:0;flex:1">
          <h1>放入食材<em>。</em></h1>
          <div class="sub">${all.length} 样食材${mineN ? ` · 其中 ${mineN} 样是你加的` : ''} · 可多选，也可单放</div>
        </div>
      </div>
      <label class="search-box">${ic.search}<input id="catSearch" placeholder="搜食材，比如 番茄、五花肉" value="${esc(UI.catQ)}" data-input="cat-q"/></label>
      <div class="pick-tabs" style="margin-top:10px">
        ${CAT_GROUPS.map(g => `<button class="${UI.catGroup === g ? 'on' : ''}" data-act="cat-group" data-g="${g}">${g}</button>`).join('')}
      </div>
      <button class="ct-custom" data-act="cat-custom">
        <span class="cc-plus">${ic.plus}</span>
        <span class="cc-t">自己加一个<em>系统里没有的，加一次以后都能搜到</em></span>
      </button>
      <div class="ct-list">${list.length
        ? list.map(catRowHTML).join('')
        : `<div class="empty"><span class="em">${q ? '🔍' : '🥣'}</span>
             ${q ? `没找到「${esc(q)}」`
          : (UI.catGroup === '全部' ? '食材库还什么都没加' : `「${esc(UI.catGroup)}」这一类还是空的`)}<br>
             <button class="btn btn-primary btn-sm" style="margin-top:12px" data-act="cat-custom"${q ? ` data-name="${esc(q)}"` : ''}>${ic.plus} ${q ? `把「${esc(q)}」加进来` : '自己加一个'}</button>
             ${q ? '<br><span style="font-size:12px">或者换个词再搜搜</span>' : ''}</div>`}</div>
      <div class="cat-bar">${catBarHTML()}</div>
    </div>`;
  }

  /* ---------------- 视图：今天 ---------------- */
  function viewToday() {
    const k = UI.date, m = UI.meal;
    const items = mealList(k, m);
    const isToday = k === todayKey();
    const idx = invIndex();
    const recs = recommended(idx, m).slice(0, 8);
    const hasFood = foodItems().length > 0;

    const dishes = items.map(x => dishCardHTML(x, k, m)).join('');
    const mm = items.map(x => dishById(x.id)).filter(Boolean);
    const gaps = new Set();
    mm.forEach(r => matchRecipe(r, idx).miss.forEach(i => gaps.add(i.n)));

    return `<div class="fade-up">
      <div class="view-head">
        <div><h1>今天<em>。</em></h1><div class="sub">安排三餐，缺什么直接进买菜单</div></div>
        <button class="btn btn-primary btn-sm" data-act="open-pick">${ic.plus} 点菜</button>
      </div>
      <div class="today-top">
        <div class="date-tabs">
          <button class="date-tab ${isToday ? 'on' : ''}" data-act="set-date" data-k="${todayKey()}">今天</button>
          <button class="date-tab ${k === addDays(todayKey(), 1) ? 'on' : ''}" data-act="set-date" data-k="${addDays(todayKey(), 1)}">明天</button>
          <button class="date-pick" data-act="pick-date">选日期 ${ic.chevron}</button>
        </div>
        <div class="spacer"></div>
        <div class="meal-seg">${MEALS.map(x => `<button class="${x === m ? 'on' : ''}" data-act="set-meal" data-m="${x}">${x}</button>`).join('')}</div>
      </div>
      <div class="date-line">${fmtDate(k)} · <em>${m}</em> · ${items.length ? items.length + ' 道菜' : '还没安排'}</div>

      ${items.length ? `<div class="dish-list">${dishes}</div>
        <div class="meal-summary">
          <span>${gaps.size ? `这顿还差 ${gaps.size} 样：${Array.from(gaps).slice(0, 4).join('、')}${gaps.size > 4 ? '…' : ''}` : '食材都齐了，开火吧 🔥'}</span>
          <span class="spacer"></span>
          ${gaps.size ? `<button class="btn btn-primary btn-sm" data-act="add-gaps" data-k="${k}" data-m="${m}">加入买菜单</button>` : ''}
        </div>`
      : `<div class="empty-meal">
          <div class="bowl">${ic.flame.replace('<svg', '<svg style="width:34px;height:34px;color:#2E4A3A"')}</div>
          <h2>这一顿，想吃什么？</h2>
          <p>从冰箱现有的东西里挑几道喜欢的，<br>缺的食材会自动进买菜单。</p>
          <button class="btn btn-primary btn-lg" data-act="open-pick">去点菜 ${ic.plus}</button>
        </div>`}

      <div class="section-title"><i class="dot"></i>${recs.length && recs[0].miss.length === 0 ? '现在就能做' : '用手头的食材做'} <span class="more" data-act="nav" data-v="recipes">全部菜谱 ›</span></div>
      ${recs.length ? `<div class="rec-row">
        ${recs.map(x => `<div class="rec-card" data-act="open-recipe" data-id="${x.r.id}" data-from="${k}|${m}">
          <div class="ri">${icoV(x.r.icon)}</div>
          <h4>${esc(x.r.name)}</h4>
          <small>${x.r.time} 分钟 · ${x.r.level}</small>
          ${x.miss.length ? `<span class="chip clay">缺 ${x.miss.length} 样</span>` : `<span class="chip sage">可以开火</span>`}
        </div>`).join('')}
      </div>` : `<div class="card pad rec-guide">
        <div class="rg-ico">${hasFood ? '🍽️' : '🥬'}</div>
        <div class="rg-main"><b>${hasFood ? '这顿没找到合适的菜' : '先放两样食材'}</b>
          <div class="rg-t">${hasFood ? '换个餐次看看，或者直接去点菜' : '记下冰箱里有什么，我才好按食材配菜 —— 光有调料是配不出来的'}</div>
        </div>
        <button class="btn btn-primary btn-sm" data-act="${hasFood ? 'open-pick' : 'open-add'}">${hasFood ? '去点菜' : '添加食材'}</button>
      </div>`}
    </div>`;
  }

  /* ---------------- 视图：汇总 ---------------- */
  function viewSummary() {
    const t = todayKey();
    const monday = (() => {
      const d = parseKey(t);
      const w = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - w);
      return dateKey(d);
    })();
    const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const idx = invIndex();
    const planned = Object.keys(S.plans).reduce((n, k) => n + MEALS.reduce((s, m) => s + (S.plans[k][m] || []).length, 0), 0);
    const shop = shoppingEntries();
    const counts = { 食材: 0, 调料: 0, 剩菜: 0 };
    S.items.forEach(i => { counts[i.cat] = (counts[i.cat] || 0) + i.qty; });
    const cnt = { 食材: 0, 调料: 0, 剩菜: 0 };
    S.items.forEach(i => { cnt[i.cat] = (cnt[i.cat] || 0) + 1; });
    const maxCnt = Math.max(1, ...Object.values(cnt));
    const exp = S.items.filter(i => i.expire).map(i => ({ i, left: diffDays(t, i.expire) })).filter(x => x.left <= 3).sort((a, b) => a.left - b.left);

    return `<div class="fade-up">
      <div class="view-head"><div><h1>汇总<em>。</em></h1><div class="sub">这周的三餐、冰箱的库存、要买的东西</div></div></div>

      <div class="section-title"><i class="dot"></i>本周三餐 <span class="more">点日期直接去看</span></div>
      <div class="week-grid">
        ${week.map(k => {
          const d = parseKey(k);
          const items = MEALS.map(m => (S.plans[k] && S.plans[k][m]) || []);
          return `<div class="day-cell ${k === t ? 'today' : ''}" data-act="goto-day" data-k="${k}">
            <div class="dw">${WEEK[d.getDay()]}</div>
            <div class="dn">${d.getDate()}</div>
            <div class="dots">${items.map(a => `<i class="${a.length ? 'f' : ''}"></i>`).join('')}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="section-title"><i class="dot"></i>冰箱概览</div>
      <div class="stat-row">
        <div class="stat-box"><b>${S.items.length}</b><span>库存种类</span></div>
        <div class="stat-box"><b>${cookable(idx).length}</b><span>能做的菜</span></div>
        <div class="stat-box"><b>${expiringItems(2).length}</b><span>临期食材</span></div>
      </div>

      <div class="card pad" style="margin-top:12px">
        <div class="bars">
          ${[['食材', '#4E7A5C'], ['调料', '#8A8F63'], ['剩菜', '#B0654A']].map(([c, col]) => `
            <div class="bar-line"><span class="bl">${c}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round((cnt[c] || 0) / maxCnt * 100)}%;background:linear-gradient(90deg, ${col}, ${col}bb)"></div></div>
              <span class="bn">${cnt[c] || 0}</span></div>`).join('')}
        </div>
        ${exp.length ? `<div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px">
          <div class="side-title" style="margin-bottom:8px">该先吃掉的</div>
          ${exp.slice(0, 4).map(x => `<div class="shop-row" style="padding:7px 0;border-bottom:0">
            <div class="item-ico ${txtCls(iconOf(x.i))}" style="width:28px;height:28px;font-size:15px;border-radius:9px">${icoV(iconOf(x.i))}</div>
            <span class="shop-n">${esc(x.i.name)}</span>
            <span class="shop-a">${x.i.qty}${esc(x.i.unit || '')}</span>
            <span class="shop-src">${x.left < 0 ? '已过期' : x.left === 0 ? '今天到期' : x.left + ' 天后到期'}</span>
          </div>`).join('')}
        </div>` : ''}
      </div>

      <div class="section-title"><i class="dot"></i>买菜清单 <span class="more" data-act="nav" data-v="shop">去管理 ›</span></div>
      <div class="card pad">
        ${shop.length ? shop.slice(0, 5).map(e => `<div class="shop-row">
          <div class="check ${S.checked[e.name] ? 'on' : ''}" data-act="shop-toggle" data-name="${esc(e.name)}">${ic.check}</div>
          <div><div class="shop-n ${S.checked[e.name] ? 'done' : ''}">${esc(e.name)}</div></div>
          <div class="shop-src">${e.amounts.slice(0, 2).join(' · ') || ''}</div>
        </div>`).join('') : `<div class="side-empty">还没有要买的东西</div>`}
        ${shop.length > 5 ? `<div style="text-align:center;padding-top:10px"><button class="btn btn-plain btn-sm" data-act="nav" data-v="shop">还有 ${shop.length - 5} 样 ›</button></div>` : ''}
      </div>

      <div class="section-title"><i class="dot"></i>最近记录</div>
      <div class="stat-row">
        <div class="stat-box"><b>${planned}</b><span>已安排菜品</span></div>
        <div class="stat-box"><b>${S.stats.cooked || 0}</b><span>做完的顿数</span></div>
        <div class="stat-box"><b>${Object.keys(S.plans).length}</b><span>计划天数</span></div>
      </div>
    </div>`;
  }

  /* ---------------- 视图：菜谱库 / 食材册 ---------------- */
  function viewLibrary() {
    const idx = invIndex();
    let list = scored(idx);
    if (UI.libMode === '可做') list = list.filter(x => x.miss.length === 0 && x.mains > 0);
    if (UI.libMode === '差点') list = list.filter(x => x.miss.length === 1 && x.have.length >= 1 && (x.mains <= 2 || x.ratio >= .5));
    if (UI.libCat !== '全部') list = list.filter(x => x.r.cat === UI.libCat);
    if (UI.libQ.trim()) {
      const q = UI.libQ.trim();
      list = list.filter(x => x.r.name.includes(q) || x.r.ing.some(i => i.n.includes(q)));
    }
    const cats = ['全部', '快手菜', '家常菜', '硬菜', '汤羹', '主食', '早餐', '凉菜'];

    return `<div class="fade-up">
      <div class="view-head">
        <div><h1>食材册<em>。</em></h1><div class="sub">${allRecipes().length} 道 · 按冰箱内容排序${myRecipes().length ? ` · ${myRecipes().length} 道你录的` : ''}</div></div>
        <div class="lib-ops">
          <button class="btn btn-soft btn-sm" data-act="new-recipe">${ic.plus} 录一道</button>
          <button class="btn btn-soft btn-sm" data-act="nav" data-v="fridge">${ic.snow} 回冰箱</button>
        </div>
      </div>
      <div class="search-row">
        <label class="search-box">${ic.search}<input id="libSearch" placeholder="搜菜名或食材" value="${esc(UI.libQ)}" data-input="lib-q"/></label>
      </div>
      <div class="pick-tabs">
        ${['可做', '差点', '全部'].map(x => `<button class="${UI.libMode === x ? 'on' : ''}" data-act="lib-mode" data-m="${x}">${x}</button>`).join('')}
      </div>
      <div class="pick-tabs scrollable">
        ${cats.map(c => `<button class="${UI.libCat === c ? 'on' : ''}" data-act="lib-cat" data-c="${c}">${c}</button>`).join('')}
      </div>
      <div id="libList">${libListHTML(list)}</div>
    </div>`;
  }

  function libListHTML(list) {
    if (!list.length) return `<div class="empty"><span class="em">🍳</span>这个条件下没有菜谱<br><button class="btn btn-plain btn-sm" style="margin-top:8px" data-act="lib-mode" data-m="全部">看全部</button></div>`;
    return `<div style="margin-top:6px">${list.map(x => `
      <div class="pick-row" data-act="open-recipe" data-id="${x.r.id}">
        <div class="pi">${icoV(x.r.icon)}</div>
        <div style="min-width:0">
          <div class="pn">${esc(x.r.name)}</div>
          <div class="pm">${x.r.cat} · ${x.r.time} 分钟 · ${x.r.level}</div>
        </div>
        <div class="pc">${x.miss.length ? `<span class="chip clay">缺 ${x.miss.length}</span>` : `<span class="chip sage">齐</span>`}</div>
      </div>`).join('')}</div>`;
  }

  /* ---------------- 视图：买菜单 ---------------- */
  function viewShop() {
    const list = shoppingEntries();
    const bought = list.filter(e => S.checked[e.name]);
    return `<div class="fade-up">
      <div class="view-head">
        <div><h1>买菜单<em>。</em></h1><div class="sub">${list.filter(e => !S.checked[e.name]).length} 样待买 · ${bought.length} 样已买</div></div>
        <button class="btn btn-primary btn-sm" data-act="shop-add">${ic.plus} 加一样</button>
      </div>
      <div class="card pad">
        ${list.length ? list.map(e => `<div class="shop-row">
          <div class="check ${S.checked[e.name] ? 'on' : ''}" data-act="shop-toggle" data-name="${esc(e.name)}">${ic.check}</div>
          <div style="min-width:0">
            <div class="shop-n ${S.checked[e.name] ? 'done' : ''}">${esc(e.name)}</div>
            <div class="shop-a">${e.amounts.slice(0, 3).join(' · ')}</div>
          </div>
          <div class="shop-src">${e.srcs.length ? e.srcs.slice(0, 2).join(' / ') : (e.manual ? '手动添加' : '')}</div>
          ${e.manual ? `<button class="row-del" data-act="shop-del" data-name="${esc(e.name)}">${ic.x}</button>` : ''}
        </div>`).join('') : `<div class="empty"><span class="em">🧺</span>清单是空的<br><span style="font-size:12px">安排好三餐后，缺的食材会自动出现在这里</span></div>`}
      </div>
      ${bought.length ? `<div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn btn-primary btn-block" data-act="shop-into-fridge">把已买的 ${bought.length} 样放进冰箱</button>
        <button class="btn btn-soft" data-act="shop-clear">清空</button>
      </div>` : ''}
      <div class="section-title"><i class="dot"></i>说明</div>
      <div class="card pad" style="font-size:12.5px;color:var(--ink-3);line-height:1.8">
        买菜单＝计划里所有「缺的食材」自动汇总。打勾表示已买到，点上面的按钮可以一键入库，库存就跟着更新了。
      </div>
    </div>`;
  }

  /* ---------------- 视图：我的 ---------------- */
  function viewMe() {
    const n = S.items.filter(i => i.qty > 0).length;
    return `<div class="fade-up">
      <div class="view-head"><div><h1>我的<em>。</em></h1><div class="sub">偏好设置与数据管理</div></div></div>
      <div class="profile-card">
        <div class="profile-ava">🍳</div>
        <div><h3>我家的冰箱</h3><p>${S.prefs.people} 人吃饭 · 库存 ${n} 样 · 做完 ${S.stats.cooked || 0} 顿</p></div>
      </div>

      <div class="section-title"><i class="dot"></i>口味偏好</div>
      <div class="card pad">
        <div class="set-row">
          <div class="sl">常住人数<small>影响菜谱推荐的份量</small></div>
          <div class="sr"><div class="stepper">
            <button data-act="people" data-d="-1">−</button><span>${S.prefs.people} 人</span><button data-act="people" data-d="1">+</button>
          </div></div>
        </div>
        <div class="set-row" style="display:block">
          <div class="sl">忌口与限制<small>勾选后推荐会自动避开</small></div>
          <div class="avoid-wrap">
            ${AVOID.map(a => `<button class="avoid ${(S.prefs.avoid || []).includes(a.k) ? 'on' : ''}" data-act="avoid" data-k="${a.k}">${a.label}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="section-title"><i class="dot"></i>数据</div>
      <div class="card pad">
        <div class="set-row"><div class="sl">库存 / 计划 / 清单<small>存在本机浏览器，不上传</small></div>
          <div class="sr"><button class="btn btn-soft btn-sm" data-act="export">导出备份</button></div></div>
        <div class="set-row"><div class="sl">导入备份<small>从 JSON 文件恢复</small></div>
          <div class="sr"><button class="btn btn-soft btn-sm" data-act="import">选择文件</button></div></div>
        <div class="set-row"><div class="sl">重新开始<small>清空所有数据，恢复示例冰箱</small></div>
          <div class="sr"><button class="btn btn-danger btn-sm" data-act="reset">重置</button></div></div>
      </div>

      <div class="section-title"><i class="dot"></i>关于</div>
      <div class="card pad" style="font-size:12.5px;color:var(--ink-3);line-height:1.9">
        我家冰箱 v0.1 · 离线可用的冰箱管理与三餐计划工具。<br>
        内置 ${RECIPES.length} 道家常菜谱、${Object.keys(ING).length} 种常见食材，自己还能再录菜谱、加食材。<br>
        PC 版可直接在浏览器打开，安卓版随后打包。
      </div>
    </div>`;
  }

  /* ---------------- 左侧栏 / 右侧栏 / 底部栏 ---------------- */
  function renderRail() {
    const shopN = shoppingEntries().filter(e => !S.checked[e.name]).length;
    const todayN = MEALS.reduce((s, m) => s + mealList(todayKey(), m).length, 0);
    const nav = [['fridge', '冰箱', ic.snow], ['today', '今天', ic.flame], ['summary', '汇总', ic.chart], ['me', '我的', ic.user]];
    $('#rail').innerHTML = `
      <div class="brand">
        <div class="brand-mark">冰</div>
        <div class="brand-txt"><b>我家冰箱</b><span>WHAT'S IN MY FRIDGE</span></div>
      </div>
      <nav class="rail-nav">
        ${nav.map(([v, label, icon]) => `<button class="nav-item ${((UI.view === 'stock' || UI.view === 'catalog') ? 'fridge' : UI.view) === v ? 'on' : ''}" data-act="nav" data-v="${v}">
          ${icon}<span>${label}</span>
          ${v === 'today' && todayN ? `<span class="nb soft">${todayN}</span>` : ''}
        </button>`).join('')}
      </nav>
      <div class="rail-sep"></div>
      <div class="rail-label">工具</div>
      <nav class="rail-nav">
        <button class="nav-item ${UI.view === 'recipes' ? 'on' : ''}" data-act="nav" data-v="recipes">${ic.book}<span>食材册</span></button>
        <button class="nav-item ${UI.view === 'shop' ? 'on' : ''}" data-act="nav" data-v="shop">${ic.list}<span>买菜单</span>
          ${shopN ? `<span class="nb">${shopN}</span>` : ''}</button>
      </nav>
      <div class="rail-foot">
        能做的菜 <b>${cookable().length}</b> 道<br>
        临期 <b>${expiringItems(2).length}</b> 样 · 已过期 ${expiredItems().length} 样
      </div>`;
  }

  function renderSide() {
    const idx = invIndex();
    const near = nearReady(idx).slice(0, 3);
    const t = todayKey();
    const mealStats = MEALS.map(m => ({ m, n: mealList(t, m).length }));
    const shop = shoppingEntries().filter(e => !S.checked[e.name]);
    const exp = expiringItems(2).slice(0, 4);

    $('#side').innerHTML = `
      <div class="side-sec">
        <div class="side-title">今天的安排 <span class="more" data-act="nav" data-v="today">去安排 ›</span></div>
        <div class="side-card">
          <div class="side-mini-stats">
            ${mealStats.map(x => `<div class="sms" data-act="goto-meal" data-m="${x.m}"><b>${x.n}</b><span>${x.m}</span></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="side-sec">
        <div class="side-title">差一点就能开饭</div>
        <div class="side-card">
          ${near.length ? near.map(x => `<div class="mini-dish" data-act="open-recipe" data-id="${x.r.id}">
            <div class="mi">${icoV(x.r.icon)}</div>
            <div><div class="mn">${esc(x.r.name)}</div><div class="ms">还差 ${esc(x.miss.map(m => m.n).join('、'))}</div></div>
            <div class="mc">${x.r.time}′</div>
          </div>`).join('') : `<div class="side-empty">暂时没有只差一样的菜</div>`}
        </div>
      </div>
      <div class="side-sec">
        <div class="side-title">冰箱速览 <span class="more" data-act="nav" data-v="fridge">全部 ›</span></div>
        <div class="side-card">
          <div class="side-mini-stats">
            <div class="sms"><b>${S.items.length}</b><span>库存</span></div>
            <div class="sms"><b>${cookable(idx).length}</b><span>能做</span></div>
            <div class="sms"><b>${expiringItems(2).length}</b><span>临期</span></div>
          </div>
          ${exp.length ? `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
            ${exp.map(i => `<div class="mini-dish" data-act="nav" data-v="stock">
              <div class="mi ${txtCls(iconOf(i))}">${icoV(iconOf(i))}</div>
              <div><div class="mn">${esc(i.name)}</div><div class="ms">${i.qty}${esc(i.unit || '')}</div></div>
              <div class="mc">快到期</div>
            </div>`).join('')}
          </div>` : ''}
        </div>
      </div>
      <div class="side-sec">
        <div class="side-title">买菜清单 <span class="more" data-act="nav" data-v="shop">管理 ›</span></div>
        <div class="side-card">
          ${shop.length ? shop.slice(0, 6).map(e => `<div class="mini-dish">
            <div class="check ${S.checked[e.name] ? 'on' : ''}" style="width:18px;height:18px;border-radius:6px" data-act="shop-toggle" data-name="${esc(e.name)}">${ic.check}</div>
            <div><div class="mn">${esc(e.name)}</div></div>
            <div class="ms" style="margin-left:auto">${e.amounts[0] || ''}</div>
          </div>`).join('') : `<div class="side-empty">清单是空的</div>`}
        </div>
      </div>`;
  }

  function renderTabbar() {
    const nav = [['fridge', '冰箱', ic.snow], ['today', '今天', ic.flame], ['summary', '汇总', ic.chart], ['me', '我的', ic.user]];
    const cur = (UI.view === 'stock' || UI.view === 'catalog') ? 'fridge' : UI.view;
    $('#tabbar').innerHTML = nav.map(([v, label, icon]) =>
      `<button class="tab-item ${cur === v ? 'on' : ''}" data-act="nav" data-v="${v}">${icon}<span>${label}</span></button>`).join('');
  }

  /* ------------------------------------------------------------
   * 9. 主渲染
   * ---------------------------------------------------------- */
  const views = { fridge: viewFridge, stock: viewStock, catalog: viewCatalog, today: viewToday, summary: viewSummary, me: viewMe, recipes: viewLibrary, shop: viewShop };

  let lastView = null;
  function render() {
    const el = $('#stageInner');
    const fit = UI.view === 'fridge' || UI.view === 'catalog';
    el.classList.toggle('fit', fit);
    $('#stage').classList.toggle('no-scroll', fit);
    el.innerHTML = (views[UI.view] || viewFridge)();
    renderRail();
    renderSide();
    renderTabbar();
    if (fit) bindPager();
    else if (lastView !== UI.view) $('#stage').scrollTop = 0;
    lastView = UI.view;
  }

  /* 冷藏 / 冷冻：横向滑到哪一页就认哪一页；桌面用鼠标按住也能拖 */
  let suppressClick = false;
  function bindPager() {
    const p = $('#frPager'); if (!p) return;
    const pageW = () => p.clientWidth || 1;
    const idxNow = () => Math.max(0, Math.min(ZONES.length - 1, Math.round(p.scrollLeft / pageW())));
    const sync = () => {
      const z = ZONES[idxNow()];
      if (!z || z === UI.zone) return;
      UI.zone = z;
      $$('.fr-zonebar button').forEach(b => b.classList.toggle('on', b.dataset.z === z));
    };
    if (UI.zone === '冷冻') p.scrollLeft = pageW();
    p.addEventListener('scroll', sync, { passive: true });

    let drag = null;
    p.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: p.scrollLeft, moved: false };
    });
    p.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 5) return;
      drag.moved = true;
      p.style.scrollSnapType = 'none';
      p.scrollLeft = drag.left - dx;
    });
    const drop = () => {
      if (!drag) return;
      const moved = drag.moved; drag = null;
      p.style.scrollSnapType = '';
      if (!moved) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 350);
      p.scrollTo({ left: idxNow() * pageW(), behavior: 'smooth' });
    };
    p.addEventListener('pointerup', drop);
    p.addEventListener('pointerleave', drop);
    p.addEventListener('pointercancel', drop);
  }

  function softRender() {
    // 只更新列表，保留输入焦点
    if (UI.view === 'recipes') {
      const l = $('#libList');
      if (l) {
        const idx = invIndex();
        let list = scored(idx);
        if (UI.libMode === '可做') list = list.filter(x => x.miss.length === 0 && x.mains > 0);
        if (UI.libMode === '差点') list = list.filter(x => x.miss.length === 1 && x.have.length >= 1 && (x.mains <= 2 || x.ratio >= .5));
        if (UI.libCat !== '全部') list = list.filter(x => x.r.cat === UI.libCat);
        if (UI.libQ.trim()) { const q = UI.libQ.trim(); list = list.filter(x => x.r.name.includes(q) || x.r.ing.some(i => i.n.includes(q))); }
        l.innerHTML = libListHTML(list);
      }
    }
  }

  /* ------------------------------------------------------------
   * 10. 抽屉
   * ---------------------------------------------------------- */
  const sheetRoot = $('#sheetRoot'), sheetEl = $('#sheet');

  function openSheet(title, sub, body, foot, opts) {
    sheetEl.innerHTML = `
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div>
        <button class="icon-btn x" data-act="close-sheet">${ic.x}</button>
      </div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
    sheetRoot.classList.add('open');
    sheetRoot.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (!opts || !opts.keep) sheetEl.querySelector('.sheet-body').scrollTop = 0;
  }
  function closeSheet() {
    sheetRoot.classList.remove('open');
    sheetRoot.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /* ---- 通用确认弹窗 ---- */
  function modal(html, actions) {
    const root = $('#modalRoot'), card = $('#modalCard');
    if (!root) return;
    card.innerHTML = `<div class="md-body">${html}</div>
      <div class="md-foot">${actions.map(a =>
        `<button class="btn ${a.kind || 'btn-soft'} ${a.block ? 'btn-block' : ''}" data-act="${a.act}">${a.label}</button>`).join('')}</div>`;
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    const root = $('#modalRoot');
    if (!root) return;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
  }

  /* ---- 手绘像素图标：16×16 填色，存成 data:image/png ---- */
  const PIX_N = 16;
  const PIX_COLORS = ['#33403A', '#FFFFFF', '#E4574B', '#E98A3C', '#F2C94C',
    '#7FAE68', '#3E7A55', '#6BA8D8', '#8E6BB5', '#C98B5B', '#EFA6BE'];
  const PIX = { cells: new Array(PIX_N * PIX_N).fill(''), color: PIX_COLORS[0], target: null, stack: [] };
  let pixDown = false, pixLast = -1;

  const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function snapColor(css) {
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(css || '');
    if (!m) return PIX_COLORS[0];
    const rgb = [+m[1], +m[2], +m[3]];
    let best = PIX_COLORS[0], bd = 1e9;
    PIX_COLORS.forEach(h => {
      const c = hex2rgb(h);
      const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
      if (d < bd) { bd = d; best = h; }
    });
    return best;
  }

  function pixGridHTML() {
    return PIX.cells.map((c, i) =>
      `<span class="pix-cell${c ? ' filled' : ''}" data-pix="${i}"${c ? ` style="background:${c}"` : ''}></span>`).join('');
  }

  function paintPixGrid() {
    const g = $('#pixGrid');
    if (g) g.innerHTML = pixGridHTML();
  }

  // 把已有的像素图标还原回格子，方便接着改
  function decodePix(url) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = PIX_N;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, PIX_N, PIX_N);
      const d = g.getImageData(0, 0, PIX_N, PIX_N).data;
      for (let i = 0; i < PIX_N * PIX_N; i++) {
        const a = d[i * 4 + 3];
        PIX.cells[i] = a > 40 ? snapColor(`rgb(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]})`) : '';
      }
      paintPixGrid();
    };
    img.src = url;
  }

  function pixURL() {
    const S = 16;
    const c = document.createElement('canvas');
    c.width = c.height = PIX_N * S;
    const g = c.getContext('2d');
    PIX.cells.forEach((col, i) => {
      if (!col) return;
      g.fillStyle = col;
      g.fillRect((i % PIX_N) * S, ((i / PIX_N) | 0) * S, S, S);
    });
    return c.toDataURL('image/png');
  }

  function pixelEditorHTML() {
    return `<div class="pix-wrap">
      <h3>画个图标</h3>
      <p class="md-sub">16×16 的点阵：点一格填一格，按住能连着画；留白的地方是透明的。</p>
      <div class="pix-grid" id="pixGrid">${pixGridHTML()}</div>
      <div class="pix-pal">
        ${PIX_COLORS.map(c => `<button class="pix-sw${PIX.color === c ? ' on' : ''}" data-act="pix-color" data-c="${c}" style="background:${c}" aria-label="颜色 ${c}"></button>`).join('')}
        <button class="pix-era${PIX.color === '' ? ' on' : ''}" data-act="pix-color" data-c="" aria-label="橡皮">橡皮</button>
      </div>
      <div class="pix-acts">
        <button class="btn btn-soft" data-act="pix-undo">撤销</button>
        <button class="btn btn-soft" data-act="pix-clear">清空</button>
        <button class="btn btn-primary" data-act="pix-done">用这个图标</button>
      </div>
    </div>`;
  }

  function openPixel(target) {
    PIX.target = target;
    PIX.cells = new Array(PIX_N * PIX_N).fill('');
    PIX.stack = [];
    PIX.color = PIX_COLORS[0];
    const cur = target === 'edit' ? (UI.edit && UI.edit.icon)
      : target === 'cf' ? (UI.cf && UI.cf.icon)
        : (UI.rf && UI.rf.icon);
    modal(pixelEditorHTML(), []);
    // 弹窗默认的按钮区对编辑器没用，塞完清掉
    const foot = $('#modalCard .md-foot'); if (foot) foot.remove();
    const card = $('#modalCard'); if (card) card.classList.add('modal-card-pix');
    if (isPic(cur)) decodePix(cur);
  }

  function closePixel() {
    PIX.target = null;
    const card = $('#modalCard'); if (card) card.classList.remove('modal-card-pix');
    closeModal();
  }

  function pixPaint(cell) {
    const i = Number(cell.dataset.pix);
    if (!Number.isFinite(i) || i === pixLast) return;
    pixLast = i;
    PIX.cells[i] = PIX.color;
    cell.style.background = PIX.color || '';
    cell.classList.toggle('filled', !!PIX.color);
  }

  function pixCommit() {
    if (!PIX.cells.some(Boolean)) { toast('还什么都没画，先点几格', true); return; }
    const url = pixURL();
    const t = PIX.target;
    closePixel();
    if (t === 'edit' && UI.edit) { UI.edit.icon = url; UI.edit.img = null; paintEdit(); }
    else if (t === 'cf' && UI.cf) { UI.cf.icon = url; UI.cf.touched = true; paintCustom(); }
    else if (t === 'rf' && UI.rf) { UI.rf.icon = url; paintRecipeForm(); }
    toast('图标换好了');
  }

  // 「自己画」入口按钮：已经用了像素图就直接显示那张图
  function drawBtnHTML(target, cur) {
    const on = isPic(cur);
    return `<button class="ed-draw${on ? ' on' : ''}" data-act="pix-open" data-t="${target}" title="自己画一个图标">
      ${on ? `<img class="ico-img" src="${cur}" alt=""/>` : '<span>✏️</span>'}</button>`;
  }

  /* ---- 食材编辑（新增 / 修改共用一套表单） ---- */
  const ICON_POOL = ['🥚', '🍅', '🥔', '🥕', '🥬', '🥦', '🍄', '🌽', '🍆', '🥒', '🧅', '🌶️', '🍪',
    '🥩', '🍗', '🐟', '🦐', '🍚', '🍜', '🥟', '🧀', '🥛', '🍞', '🍫', '🧂', '🍯', '🥣', '🍎',
    // 水果
    '🍌', '🍇', '🍓', '🍊', '🍉', '🍑', '🥭',
    // 冰品甜点零食
    '🍦', '🍨', '🍧', '🍰', '🧁', '🍮', '🍩', '🍿',
    // 肉与坚果
    '🥓', '🍖', '🌰', '🥜', '🫘',
    // 主食杂粮
    '🍠', '🎃', '🥐', '🥖',
    // 其他
    '🧊', '🥫', '🧃'];

  function editIconHTML(e) {
    if (e.img) return `<img src="${e.img}" alt=""/>`;
    const i0 = e.icon || metaOf(e.name).icon;
    if (isPic(i0)) return `<img class="pix-shot" src="${i0}" alt=""/>`;
    return `<span class="${/[\u4e00-\u9fa5]/.test(i0) ? 'txt-ico' : ''}">${i0}</span>`;
  }

  function editBody() {
    const e = UI.edit;
    const left = e.expire ? diffDays(todayKey(), e.expire) : null;
    const hint = !e.expire ? '不记保质期，就不会进临期提醒'
      : left < 0 ? `已经过期 ${-left} 天，建议先吃掉或删掉`
        : left === 0 ? '今天就到期' : `还有 ${left} 天`;
    const cond = isCond(e.name);
    const snack = isSnack(e.name);
    return `<div class="ed-top">
        <button class="ed-pic ${e.img ? 'has-img' : ''}" data-act="edit-photo">
          ${editIconHTML(e)}<i>换图</i>
        </button>
        <div class="ed-top-r">
          <input class="input ed-name" id="edName" value="${esc(e.name)}" data-input="edit-name"/>
          <div class="ed-sub">${e.isNew ? '准备放进冰箱' : `${metaOf(e.name).cat} · 现在在${zoneLabel(zoneOf(e))}`}</div>
        </div>
      </div>

      <div class="ed-icons">
        ${ICON_POOL.map(x => `<button class="${!e.img && (e.icon || metaOf(e.name).icon) === x ? 'on' : ''}" data-act="edit-icon" data-i="${x}">${x}</button>`).join('')}
        ${drawBtnHTML('edit', e.img ? null : e.icon)}
      </div>

      <div class="field"><label>数量</label>
        <div class="qty-row">
          <div class="qty-stepper">
            <button type="button" data-act="edit-qty" data-d="-1">−</button>
            <input id="edQty" type="number" min="0" step="1" value="${e.qty}" data-input="edit-qty"/>
            <button type="button" data-act="edit-qty" data-d="1">+</button>
          </div>
          <input class="input unit-sel" id="edUnit" value="${esc(e.unit || '')}" placeholder="单位" data-input="edit-unit"/>
        </div>
      </div>

      <div class="field"><label>保质期</label>
        <input class="input" type="date" id="edExpire" value="${e.expire || ''}" data-input="edit-expire"/>
        <div class="days-chips">
          ${[[3, '3 天'], [7, '1 周'], [14, '2 周'], [30, '1 个月'], [null, '不记']].map(([d, l]) =>
            `<button data-act="edit-days" data-d="${d === null ? 'null' : d}">${l}</button>`).join('')}
        </div>
        <div class="hint">${hint}</div>
      </div>

      <div class="field"><label>放在哪</label>
        ${cond
          ? `<div class="ed-fixed">🧂 <b>调料区</b><span>调料不占冷藏 / 冷冻的格位</span></div>`
          : `<div class="seg">
               ${MOVE_ZONES.map(z => `<button class="${e.zone === z ? 'on' : ''}" data-act="edit-zone" data-z="${z}">${zoneLabel(z)}</button>`).join('')}
             </div>
             <div class="hint">${snack
                ? '零食也占冷格：冰激凌、雪糕放冷冻，巧克力、饼干这类放冷藏'
                : '冷藏 / 冷冻是两页，左右滑就能翻'}</div>`}
      </div>`;
  }

  function paintEdit() {
    const e = UI.edit;
    const foot = e.isNew
      ? `<button class="btn btn-soft btn-block" data-act="close-sheet">取消</button>
         <button class="btn btn-primary btn-block" data-act="edit-save">放进冰箱</button>`
      : `<button class="btn btn-danger btn-block" data-act="edit-del">删除</button>
         <button class="btn btn-primary btn-block" data-act="edit-save">保存</button>`;
    openSheet(e.isNew ? '放进冰箱' : '改一改',
      e.isNew ? '补一下数量和保质期，也可以先不填' : '名字、图片、数量、保质期、放哪都能改',
      editBody(), foot, { keep: true });
  }

  function openEdit(id) {
    const it = S.items.find(i => i.id === id);
    if (!it) { toast('这样东西不见了', true); return; }
    UI.edit = {
      id, isNew: false, name: it.name, qty: it.qty, unit: it.unit || '',
      expire: it.expire || null, zone: zoneOf(it), img: it.img || null, icon: it.icon || null
    };
    paintEdit();
  }

  function openQuickAdd(name) {
    const m = metaOf(name);
    UI.edit = {
      id: null, isNew: true, name: norm(name), qty: 1, unit: m.unit,
      expire: m.days ? addDays(todayKey(), m.days) : null,
      zone: zoneFor(norm(name), UI.catZonePicked ? UI.catZone : null),
      img: null, icon: null
    };
    paintEdit();
  }

  /* ---- 自定义食材（食材库里那些「系统没有的」） ---- */
  const CF_GROUPS = ['蔬菜', '肉蛋', '水产', '主食', '豆乳', '调料', '零食', '其他'];
  const CF_ICON = { 蔬菜: '🥬', 肉蛋: '🥩', 水产: '🐟', 主食: '🍚', 豆乳: '🥛', 调料: '🧂', 零食: '🍪', 其他: '🥣' };

  function guessGroup(n) {
    // 零食先判：薯片 / 饼干再往下走会被当成蔬菜；冰激凌 / 雪糕也算零食
    if (/(薯片|薯条|饼干|坚果|瓜子|果冻|巧克力|糖果|软糖|奶糖|辣条|肉干|蜜饯|爆米花|腰果|杏仁|核桃|冰淇淋|冰激凌|雪糕|冰棍|冰棒|蛋卷|果干|虾条)/.test(n)) return '零食';
    // 调料只认结尾：油菜不该被当成调料，香油 / 孜然粉 / 花椒该
    if (/(粉|酱|油|醋|盐|糖|椒|精|料)$/.test(n)) return '调料';
    if (/鱼|虾|蟹|贝|蛤|鱿|海带|紫菜/.test(n)) return '水产';
    if (/肉|鸡|鸭|蛋|排骨|牛|羊|猪|肠/.test(n)) return '肉蛋';
    if (/米|面|馒|饺|粉条|年糕|面包|饼/.test(n)) return '主食';
    if (/奶|豆|腐|酪|黄油/.test(n)) return '豆乳';
    return '蔬菜';
  }

  function openCustom(name) {
    const n = norm(name || '');
    UI.cf = {
      name: n, group: n ? guessGroup(n) : '蔬菜', icon: null,
      unit: '', days: 7, touched: false
    };
    paintCustom();
  }

  // 零食的默认图标跟着名字走：冰激凌给 🍦，巧克力给 🍫，别一律 🍪
  function guessSnackIcon(n) {
    if (/冰|雪糕|雪泥|甜筒/.test(n)) return '🍦';
    if (/巧克力|可可/.test(n)) return '🍫';
    if (/薯片|薯条|爆米花|虾条|锅巴/.test(n)) return '🍿';
    if (/坚果|瓜子|腰果|杏仁|核桃|花生/.test(n)) return '🥜';
    if (/蛋糕|面包|派|酥/.test(n)) return '🍰';
    if (/糖|果冻|蜜饯|果干|布丁/.test(n)) return '🍬';
    return CF_ICON[SNACK];
  }

  function cfIcon() {
    const c = UI.cf;
    if (c.icon) return c.icon;
    if (c.group === SNACK) return guessSnackIcon(c.name);
    return CF_ICON[c.group] || '🥣';
  }

  function customBody() {
    const c = UI.cf;
    const icon = cfIcon();
    const dup = !!ING[norm(c.name)] || !!customOf(c.name);
    return `<div class="field"><label>叫什么</label>
        <input class="input" id="cfName" value="${esc(c.name)}" placeholder="比如 秋葵、马蹄、孜然粉"
               data-input="cf-name" autocomplete="off"/>
        <div class="hint">${dup ? '这个名字库里已经有了，保存会覆盖它的设置' : '在食材库、存货、买菜单里都用这个名字'}</div>
      </div>

      <div class="field"><label>算哪一类</label>
        <div class="days-chips">
          ${CF_GROUPS.map(g => `<button class="${c.group === g ? 'on' : ''}" data-act="cf-cat" data-g="${g}">${g}</button>`).join('')}
        </div>
        <div class="hint">「调料」自动进调料区、不占冷格；「零食」只定分类——冰激凌放冷冻、巧克力放冷藏，照样占格</div>
      </div>

      <div class="field"><label>配个图标</label>
        <div class="ed-icons">
          ${ICON_POOL.map(x => `<button class="${icon === x ? 'on' : ''}" data-act="cf-icon" data-i="${x}">${x}</button>`).join('')}
          ${drawBtnHTML('cf', c.icon)}
        </div>
      </div>

      <div class="field"><label>单位和大概能放几天</label>
        <div class="qty-row">
          <input class="input unit-sel" id="cfUnit" value="${esc(c.unit)}" placeholder="份 / 个 / g" data-input="cf-unit"/>
          <div class="qty-stepper">
            <button type="button" data-act="cf-days" data-d="-1">−</button>
            <input id="cfDays" type="number" min="1" max="3650" value="${c.days}" data-input="cf-days-in"/>
            <button type="button" data-act="cf-days" data-d="1">+</button>
          </div>
          <span class="cf-days-t">天</span>
        </div>
        <div class="hint">只是默认值，放进冰箱后每一样还能单独改保质期</div>
      </div>`;
  }

  function paintCustom() {
    openSheet('自己加一个食材', '只在这个手机上生效，加一次以后都能搜到',
      customBody(),
      `<button class="btn btn-soft" data-act="cf-save">先存进食材库</button>
       <button class="btn btn-primary" data-act="cf-add">放进冰箱</button>`,
      { keep: true });
  }

  function upsertCustom(rec) {
    const i = S.custom.findIndex(c => c.name === rec.name);
    if (i >= 0) S.custom[i] = Object.assign({}, S.custom[i], rec);
    else S.custom.push(rec);
  }

  function saveCustomFromSheet() {
    const c = UI.cf;
    const nameEl = $('#cfName');
    const name = norm(nameEl ? nameEl.value : c.name);
    if (!name) { toast('先给它起个名字', true); return null; }
    const days = Math.max(1, Number(($('#cfDays') || {}).value) || 7);
    const unit = (($('#cfUnit') || {}).value || '').trim() || '份';
    const rec = { name, group: c.group, icon: cfIcon(), unit, days, at: todayKey() };
    upsertCustom(rec);
    save();
    return rec;
  }


  /* 选一张本地图片，压成 160×160 存进 localStorage */
  function pickImage(cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const SZ = 160;
          const c = document.createElement('canvas'); c.width = c.height = SZ;
          const ctx = c.getContext('2d');
          const side = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SZ, SZ);
          cb(c.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = () => toast('这张图读不出来', true);
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
    };
    inp.click();
  }

  /* ---- 放进冰箱：同名合并 / 分开存放 ---- */
  function conflictsOf(names) {
    const set = new Set(names.map(norm));
    return Array.from(new Set(S.items.filter(i => i.qty > 0 && set.has(i.name)).map(i => i.name)));
  }

  function commitAdd(names, opts, mode) {
    // 没手动点过层位就别硬塞冷藏：冰激凌会自己进冷冻
    const want = opts.zone || null;
    names.map(norm).forEach(n => {
      const m = metaOf(n);
      const zone = zoneFor(n, want);
      const olds = S.items.filter(i => i.name === n);
      if (olds.length && mode === 'merge') {
        const t0 = olds[0];
        t0.qty = Number(t0.qty) + (opts.qty == null ? 1 : opts.qty);
        if (opts.expire !== undefined && opts.expire) t0.expire = opts.expire;
        t0.zone = zone;
        if (opts.img) t0.img = opts.img;
        if (opts.icon) t0.icon = opts.icon;
      } else {
        S.items.unshift({
          id: uid(), name: n, cat: m.cat,
          qty: opts.qty == null ? 1 : opts.qty,
          unit: opts.unit || m.unit,
          expire: opts.expire !== undefined ? opts.expire : (m.days ? addDays(todayKey(), m.days) : null),
          zone, img: opts.img || null, icon: opts.icon || null,
          addedAt: todayKey()
        });
      }
    });
  }

  function finishAdd(names, opts, mode) {
    commitAdd(names, opts, mode);
    save(); closeModal(); closeSheet();
    UI.catSel.clear();
    // 放的是调料，就把下方架子露出调料区
    if (zoneFor(names[0], opts.zone) === COND) UI.rack = COND;
    render();
    const condN = names.filter(isCond).length;
    const where = condN === names.length ? '调料区'
      : condN ? '冰箱' : zoneLabel(zoneFor(names[0], opts.zone));
    toast(mode === 'merge' ? `已合并 ${names.length} 样到${where}` : `已放进${where} · ${names.length} 样`);
  }

  function addWithMerge(names, opts) {
    names = names.map(norm).filter(Boolean);
    if (!names.length) return;
    const clashes = conflictsOf(names);
    if (!clashes.length) { finishAdd(names, opts, 'separate'); return; }
    UI.pendingAdd = { names, opts };
    modal(`<h3>冰箱里已经有 ${clashes.length} 样</h3>
      <div class="md-chips">${clashes.map(n => `<span>${icoV(metaOf(n).icon, 14)} ${esc(n)}</span>`).join('')}</div>
      <p class="md-sub">合并：数量加起来，保质期用新填的。<br>分开：各记各的，保质期互不影响。</p>`,
      [
        { label: '合并数量', act: 'merge-yes', kind: 'btn-primary', block: true },
        { label: '分开存放', act: 'merge-no', block: true },
        { label: '再想想', act: 'modal-close', block: true }
      ]);
  }


  /* ---- 菜谱详情 ---- */
  function sheetRecipe(id, from) {
    const r = dishById(id); if (!r) return;
    const idx = invIndex();
    const mm = matchRecipe(r, idx);
    const missNames = mm.miss.map(m => m.n);

    const ingRows = r.ing.map(i => {
      const n = norm(i.n);
      const role = roleOf(n);
      const have = !!idx[n];
      // 只有「真食材主料」才打有/缺，葱姜蒜和调料按常备算
      const isFoodMain = !!i.m && role === 'food';
      const tag = role !== 'food'
        ? `<span class="itag"> · ${ROLE_LABEL[role]}</span>`
        : (i.m ? '' : '<span class="itag"> · 可选</span>');
      return `<div class="ing-row ${isFoodMain && !have ? 'is-miss' : ''}">
        <span class="ii">${icoV(metaOf(n).icon)}</span>
        <span>${esc(n)}${tag}</span>
        ${isFoodMain ? (have ? '<span class="have">有</span>' : '<span class="miss">缺</span>') : ''}
        <span class="ia">${esc(i.a || '适量')}</span>
      </div>`;
    }).join('');
    const condNames = mm.condMissing.map(x => x.n);

    const body = `
      <div class="rd-hero">
        <div class="rd-ico">${icoV(r.icon)}</div>
        <h2>${esc(r.name)}</h2>
        <div class="dish-meta"><span>${r.cat}</span><span>·</span><span>${r.time} 分钟</span><span>·</span><span>${r.level}</span><span>·</span><span>${S.prefs.people} 人份</span></div>
        <div class="rd-tags">${r.tags.map(t => `<span class="chip sage">${esc(t)}</span>`).join('')}${r.mine ? '<span class="chip clay">我录的</span>' : ''}</div>
      </div>
      <div class="rd-sec-title">需要这些</div>
      <div class="ing-list">${ingRows}</div>
      ${missNames.length
        ? `<div class="rd-lack">⚠️ 还缺：${esc(missNames.join('、'))}</div>`
        : `<div class="rd-lack ok">✓ 主料齐了，${mm.mains} 样都在冰箱里</div>`}
      ${condNames.length ? `<div class="rd-note">${esc(condNames.join('、'))} 算家里常备，缺了也不影响能不能做，顺手补上更稳。</div>` : ''}
      <div class="rd-sec-title">怎么做</div>
      <div class="steps-list">${r.steps.map(s => `<div class="step">${esc(s)}</div>`).join('')}</div>`;

    const foot = `
      ${r.mine ? `<div class="rd-mine">
        <button class="btn btn-soft btn-sm" data-act="rf-edit" data-id="${r.id}">改一改</button>
        <button class="btn btn-plain btn-sm rd-danger" data-act="rf-del" data-id="${r.id}">${ic.trash} 删掉</button>
      </div>` : ''}
      ${missNames.length ? `<button class="btn btn-soft" data-act="recipe-shop" data-id="${r.id}">缺的加进买菜单</button>` : ''}
      <button class="btn btn-primary btn-block" data-act="recipe-plan" data-id="${r.id}" data-from="${from || (UI.date + '|' + UI.meal)}">安排到${UI.meal}</button>`;
    openSheet(r.mine ? '我录的菜谱' : '菜谱',
      r.mine ? '自己录的 · 推荐里也算它一份' : '离线菜谱 · 按你冰箱算的匹配', body, foot);
  }

  /* ------------------------------------------------------------
   * 录入菜谱：照内置菜谱的规格填，存进 S.recipes
   * ---------------------------------------------------------- */
  const RF_ICONS = ['🥘', '🍳', '🍲', '🥗', '🍜', '🍚', '🥟', '🍖',
    '🐟', '🍤', '🥩', '🧆', '🌶️', '🥬', '🍆', '🥔',
    '🍅', '🥚', '🍞', '🥧', '🍮', '🍵', '🥣', '🍠',
    // 甜点冰品、面点小食
    '🍦', '🍨', '🍧', '🍰', '🧁', '🍩', '🍕', '🍔',
    '🍟', '🌮', '🍣'];
  const RF_CATS = ['快手菜', '家常菜', '硬菜', '汤羹', '主食', '早餐', '凉菜'];
  const RF_LEVELS = ['新手', '熟练', '挑战'];
  const RF_TIMES = [10, 15, 20, 30, 45, 60];

  function openRecipeForm(id) {
    const r = id ? dishById(id) : null;
    UI.rf = r ? {
      id: r.id, name: r.name, icon: r.icon || '🍳', cat: r.cat || '家常菜',
      time: r.time || 20, level: r.level || '新手',
      ing: (r.ing || []).map(i => ({ n: norm(i.n), a: i.a || '适量', m: i.m ? 1 : 0 })),
      steps: (r.steps || []).join('\n'), step: 'form', pickQ: ''
    } : {
      id: null, name: '', icon: '🍳', cat: '家常菜', time: 20, level: '新手',
      ing: [], steps: '', step: 'form', pickQ: ''
    };
    paintRecipeForm();
  }

  function paintRecipeForm() {
    const f = UI.rf; if (!f) return;
    const editing = !!f.id;
    const body = f.step === 'pick' ? rfPickBody() : rfBody();
    const foot = f.step === 'pick'
      ? `<button class="btn btn-soft btn-block" data-act="rf-back">返回</button>`
      : `<button class="btn btn-soft" data-act="close-sheet">取消</button>
         <button class="btn btn-primary btn-block" data-act="rf-save">${editing ? '保存修改' : '存进菜谱库'}</button>`;
    const holder = sheetEl.querySelector('.sheet-body');
    const sc = holder ? holder.scrollTop : 0;
    // 从食材选择器返回时，holder 的 scrollTop 是选择器自己的（通常 0），
    // 直接用会把表单弹回顶部 —— 进选择器前把位置记在 f.scroll 上
    const restore = (f.step === 'form' && typeof f.scroll === 'number') ? f.scroll : sc;
    if (f.step === 'form') delete f.scroll;
    openSheet(editing ? '改菜谱' : '录入菜谱',
      editing ? '改完保存，推荐里马上按新配方算' : '照着家里那道菜填，存进来就能被推荐、也能排进三餐',
      body, foot, { keep: true });
    const b2 = sheetEl.querySelector('.sheet-body');
    if (b2) {
      if (f.step === 'pick') {
        const i2 = $('#rfPickSearch');
        if (i2) i2.focus();
      } else b2.scrollTop = restore;   // 加了食材别把滚动条弹回顶部
    }
  }

  function rfBody() {
    const f = UI.rf;
    const ings = f.ing.map((it, i) => {
      const role = roleOf(it.n);
      const tag = role === 'food' ? (it.m ? '主料' : '辅料') : ROLE_LABEL[role];
      return `<div class="rf-ing ${it.m ? 'main' : ''}">
        <span class="rf-ii ${txtCls(metaOf(it.n))}">${icoV(metaOf(it.n).icon)}</span>
        <span class="rf-nm">${esc(it.n)}<em>${tag}</em></span>
        <input class="rf-ia" value="${esc(it.a)}" placeholder="用量" data-input="rf-amt" data-i="${i}"/>
        <button class="rf-role ${it.m ? 'on' : ''}" data-act="rf-role" data-i="${i}"
          title="点一下切换主料 / 辅料">${it.m ? '主' : '辅'}</button>
        <button class="rf-x" data-act="rf-ing-del" data-i="${i}" title="去掉">${ic.x}</button>
      </div>`;
    }).join('');

    return `
      <div class="field"><label>菜名</label>
        <input class="input" id="rfName" value="${esc(f.name)}" placeholder="比如 外婆的红烧肉"
          data-input="rf-name" autocomplete="off"/>
      </div>

      <div class="field"><label>配个图标</label>
        <div class="ed-icons rf-icons">
          ${RF_ICONS.map(x => `<button class="${f.icon === x ? 'on' : ''}" data-act="rf-icon" data-i="${x}">${x}</button>`).join('')}
          ${drawBtnHTML('rf', f.icon)}
        </div>
      </div>

      <div class="field"><label>分类</label>
        <div class="pick-tabs">
          ${RF_CATS.map(c => `<button class="${f.cat === c ? 'on' : ''}" data-act="rf-cat" data-c="${c}">${c}</button>`).join('')}
        </div>
      </div>

      <div class="field"><label>难度 · 用时</label>
        <div class="pick-tabs">
          ${RF_LEVELS.map(l => `<button class="${f.level === l ? 'on' : ''}" data-act="rf-level" data-l="${l}">${l}</button>`).join('')}
        </div>
        <div class="pick-tabs" style="margin-top:8px">
          ${RF_TIMES.map(t => `<button class="${f.time === t ? 'on' : ''}" data-act="rf-time" data-t="${t}">${t} 分钟</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>食材 <span class="rf-cnt">${f.ing.length ? f.ing.length + ' 样' : '还没加'}</span></label>
        ${f.ing.length ? `<div class="rf-ings">${ings}</div>` : ''}
        <button class="btn btn-plain btn-block rf-add" data-act="rf-add">${ic.plus} 添加食材</button>
        <div class="hint">「主」是撑起这道菜的主料（会算进「能做几道」），「辅」是可有可无的配菜；调料自动按常备算</div>
      </div>

      <div class="field"><label>做法</label>
        <textarea class="input rf-steps" rows="6" data-input="rf-steps"
          placeholder="一行写一步，比如：&#10;五花肉切块，冷水下锅焯水&#10;热锅下糖炒出糖色，下肉翻炒&#10;加水没过肉，小火炖 40 分钟">${esc(f.steps)}</textarea>
        <div class="hint">一行一步，空行会被忽略</div>
      </div>`;
  }

  function rfPickBody() {
    const f = UI.rf;
    return `
      <label class="search-box">${ic.search}
        <input id="rfPickSearch" placeholder="搜食材，比如 五花肉、土豆" value="${esc(f.pickQ)}" data-input="rf-pick-q"/>
      </label>
      <div id="rfPickList">${rfPickListHTML()}</div>`;
  }

  function rfPickListHTML() {
    const f = UI.rf; if (!f) return '';
    const q = (f.pickQ || '').trim();
    const have = new Set(f.ing.map(i => i.n));
    let names = catalogNames();
    if (q) names = names.filter(n => n.includes(q));
    const canNew = !!q && !names.length;
    const rows = names.map(n => `<button class="rf-p ${have.has(n) ? 'has' : ''}" data-act="rf-pick" data-n="${esc(n)}">
        <span class="rf-ii ${txtCls(metaOf(n))}">${icoV(metaOf(n).icon)}</span>
        <span class="rf-pn">${esc(n)}</span>
        <span class="rf-pg">${groupOf(n)}</span>
        <span class="rf-px">${have.has(n) ? '已加' : ic.plus}</span>
      </button>`).join('');
    return `${canNew ? `<button class="btn btn-block rf-add" style="margin-top:10px" data-act="rf-pick" data-n="${esc(q)}">
        ${ic.plus} 把「${esc(q)}」当作食材加进来</button>` : ''}
      ${rows ? `<div class="rf-picklist">${rows}</div>`
        : (canNew ? '' : `<div class="empty"><span class="em">🔍</span>没找到，换个词试试</div>`)}`;
  }

  function addRecipeIng(name) {
    const f = UI.rf; if (!f) return;
    const n = norm(name);
    if (!n) return;
    if (f.ing.some(i => i.n === n)) { toast('「' + n + '」已经在里面了'); return; }
    const role = roleOf(n);
    f.ing.push({ n, a: '适量', m: role === 'food' ? 1 : 0 });
    f.step = 'form';
    f.pickQ = '';
    paintRecipeForm();
  }

  function saveRecipeForm() {
    const f = UI.rf; if (!f) return;
    // 菜名不能走 norm（那是食材别名表，会把菜名也替换掉）
    const name = String(f.name || '').trim();
    if (!name) { toast('先给菜起个名字', true); return; }
    if (!f.ing.length) { toast('至少加一样食材', true); return; }
    const steps = String(f.steps || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!steps.length) { toast('写一句做法吧', true); return; }

    const ing = f.ing.map(i => {
      const role = roleOf(i.n);
      const o = { n: i.n, a: String(i.a || '').trim() || '适量' };
      if (role === 'food') { if (i.m) o.m = 1; else o.o = 1; }
      else if (role === 'aroma') o.o = 1;
      // 调料不标 m：缺了也不算缺菜，跟内置菜谱一个规矩
      return o;
    });
    const dish = {
      id: f.id || ('my' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
      name, icon: f.icon, cat: f.cat, time: f.time, level: f.level,
      tags: [], ing, steps, mine: true, at: todayKey()
    };
    if (f.id) {
      const i0 = S.recipes.findIndex(r => r.id === f.id);
      if (i0 >= 0) S.recipes[i0] = Object.assign({}, S.recipes[i0], dish);
      else S.recipes.unshift(dish);
    } else {
      S.recipes.unshift(dish);
    }
    const wasEdit = !!f.id;
    const dup = !wasEdit && S.recipes.some(r => r.name === name);
    save();
    closeSheet();
    UI.rf = null;
    UI.view = 'recipes'; UI.libQ = ''; UI.libMode = '全部'; UI.libCat = '全部';
    render();
    toast(wasEdit ? `已保存「${name}」`
      : dup ? `「${name}」存下了 · 库里本来还有一道同名`
        : `「${name}」已存进菜谱库`);
  }

  /* ---- 点菜选择器 ---- */
  function sheetPick() {
    UI.pickSel = new Set(mealList(UI.date, UI.meal).map(x => x.id));
    UI.pickTab = '推荐';
    UI.pickQ = '';
    openSheet(`点菜 · ${shortDay(UI.date)}${UI.meal}`, '挑几道喜欢的，点确认就排进这三餐', pickBody(),
      `<button class="btn btn-soft btn-block" data-act="close-sheet">取消</button>
       <button class="btn btn-primary btn-block" data-act="confirm-pick">确认（<b id="pickCount">${UI.pickSel.size}</b>）</button>`);
  }

  function pickBody() {
    const idx = invIndex();
    // 有搜索词时按名字搜全库（用户主动找菜，不受「推荐」限制）
    let list = scored(idx);
    if (UI.pickQ.trim()) {
      const q = UI.pickQ.trim();
      list = list.filter(x => x.r.name.includes(q) || x.r.ing.some(i => i.n.includes(q)));
    } else {
      if (UI.pickTab === '推荐') list = recommended(idx, UI.meal).filter(x => x.miss.length <= 1);
      if (UI.pickTab === '可做') list = cookable(idx).filter(x => mealFit(x.r, UI.meal));
    }
    return `<label class="search-box" style="margin-bottom:12px">${ic.search}
        <input id="pickSearch" placeholder="搜菜名，比如 番茄" value="${esc(UI.pickQ)}" data-input="pick-q"/></label>
      <div class="pick-tabs">
        ${['推荐', '可做', '全部'].map(x => `<button class="${UI.pickTab === x ? 'on' : ''}" data-act="pick-tab" data-m="${x}">${x}</button>`).join('')}
      </div>
      <div id="pickList">${pickListHTML(list)}</div>`;
  }

  function pickListHTML(list) {
    const idx = invIndex();
    if (!list.length) {
      const noFood = !foodItems().length;
      return `<div class="empty"><span class="em">${noFood ? '🥬' : '🍽️'}</span>
        ${noFood ? '冰箱里还没有食材<br><span style="font-size:12px">推荐只按真食材算，调料不算数</span>' : '这个条件下没有可选的菜'}
        ${noFood ? `<br><button class="btn btn-primary btn-sm" style="margin-top:12px" data-act="open-add">${ic.plus} 添加食材</button>` : ''}</div>`;
    }
    return list.map(x => {
      const on = UI.pickSel.has(x.r.id);
      return `<div class="pick-row" data-act="pick-toggle" data-id="${x.r.id}">
        <div class="pi">${icoV(x.r.icon)}</div>
        <div style="min-width:0">
          <div class="pn">${esc(x.r.name)}</div>
          <div class="pm">${x.r.time} 分钟 · ${x.r.level}${x.miss.length ? ' · 缺 ' + x.miss.map(m => m.n).join('、') : ''}</div>
        </div>
        <div class="pc"><div class="pick-check ${on ? 'on' : ''}">${ic.check}</div></div>
      </div>`;
    }).join('');
  }

  /* ---- 日期选择 ---- */
  function sheetDate() {
    const t = todayKey();
    const opts = [
      { k: t, label: '今天' }, { k: addDays(t, 1), label: '明天' }, { k: addDays(t, 2), label: '后天' },
      { k: addDays(t, 3), label: '大后天' }, { k: addDays(t, 7), label: '一周后' }
    ];
    openSheet('选日期', '要看哪天的三餐？',
      `<div class="days-chips" style="margin-bottom:18px">
        ${opts.map(o => `<button class="${UI.date === o.k ? 'on' : ''}" data-act="set-date" data-k="${o.k}">${o.label}</button>`).join('')}
       </div>
       <div class="field"><label>或指定日期</label>
         <input class="input" type="date" id="dateInput" value="${UI.date}"/></div>`,
      `<button class="btn btn-primary btn-block" data-act="confirm-date">确定</button>`);
  }

  /* ------------------------------------------------------------
   * 11. 事件
   * ---------------------------------------------------------- */
  document.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target.closest('[data-act]');
    if (!t) {
      if (e.target.closest('[data-close]')) closeSheet();
      return;
    }
    const act = t.dataset.act;
    const after = (fn) => { fn(); };

    switch (act) {
      /* 导航 */
      case 'nav':
        UI.view = t.dataset.v;
        if (t.dataset.zone) UI.stockZone = t.dataset.zone;
        UI.manage = false;
        closeSheet(); closeModal();
        render();
        $('#stage').scrollTop = 0;
        break;
      case 'goto-day':
        UI.date = t.dataset.k; UI.view = 'today'; render(); $('#stage').scrollTop = 0; break;
      case 'goto-meal':
        UI.meal = t.dataset.m; UI.date = todayKey(); UI.view = 'today'; render(); break;

      /* 冰箱 */
      case 'toggle-door':
        S.prefs.doorOpen = !S.prefs.doorOpen;
        UI.zone = '冷藏';
        save(); render(); break;
      case 'fr-zone': {
        UI.zone = t.dataset.z;
        $$('.fr-zonebar button').forEach(b => b.classList.toggle('on', b.dataset.z === UI.zone));
        const p = $('#frPager');
        if (p) p.scrollTo({ left: UI.zone === '冷冻' ? p.clientWidth : 0, behavior: 'smooth' });
        break;
      }
      case 'edit-item':
        openEdit(t.dataset.id); break;

      /* 存货页 */
      case 'stock-zone':
        UI.stockZone = t.dataset.z; render(); break;

      /* 冰箱 */
      /* 食材库 */
      case 'go-catalog':
        closeSheet(); closeModal();
        UI.view = 'catalog'; UI.catSel.clear(); UI.catQ = '';
        UI.catZonePicked = false;   // 每次进食材库都回到「按食材自动放」
        UI.catGroup = (t.dataset.g && CAT_GROUPS.includes(t.dataset.g)) ? t.dataset.g : '全部';
        render(); break;
      case 'go-back':
        closeSheet(); closeModal();
        UI.view = 'fridge'; render(); break;
      case 'cat-group':
        UI.catGroup = t.dataset.g; render(); break;
      case 'cat-zone':
        UI.catZone = t.dataset.z; UI.catZonePicked = true; paintCatBar(); break;
      case 'cat-toggle': {
        const n = t.dataset.n;
        if (UI.catSel.has(n)) UI.catSel.delete(n); else UI.catSel.add(n);
        t.classList.toggle('on', UI.catSel.has(n));
        const chk = t.querySelector('.ct-check');
        if (chk) chk.classList.toggle('on', UI.catSel.has(n));
        paintCatBar();
        break;
      }
      case 'cat-one':
        openQuickAdd(t.dataset.n); break;
      case 'cat-add':
        if (!UI.catSel.size) return;
        addWithMerge(Array.from(UI.catSel), { zone: UI.catZonePicked ? UI.catZone : null });
        break;

      /* 自定义食材 */
      case 'cat-custom':
        openCustom(t.dataset.name || (UI.catQ.trim() && !catalogNames().some(n => n.includes(UI.catQ.trim())) ? UI.catQ : ''));
        break;
      case 'cat-del-custom': {
        const n = t.dataset.n;
        UI.cfDel = n;
        modal(`<h3>删掉「${esc(n)}」？</h3>
          <p class="md-sub">只是从食材库里移除；已经在冰箱里的那几条不受影响。</p>`,
          [
            { label: '删掉', act: 'cf-del-yes', kind: 'btn-primary', block: true },
            { label: '留着', act: 'modal-close', block: true }
          ]);
        break;
      }
      case 'cf-del-yes': {
        const n = UI.cfDel;
        if (n) {
          S.custom = S.custom.filter(c => c.name !== n);
          UI.catSel.delete(n);
          UI.cfDel = null;
          save();
        }
        closeModal();
        toast(n ? `已从食材库删掉「${n}」` : '已删除');
        render();
        break;
      }
      case 'cf-cat': {
        const c = UI.cf; if (!c) return;
        const g = t.dataset.g;
        // 图标还是跟着上一类走的默认值，就跟着换；用户手挑过的不动
        if (!c.touched) c.icon = null;   // 没手挑过就跟着分类走
        c.group = g; c.touched = true; paintCustom(); break;
      }
      case 'cf-icon': {
        const c = UI.cf; if (!c) return;
        c.icon = t.dataset.i; c.touched = true; paintCustom(); break;
      }
      case 'cf-days': {
        const c = UI.cf; if (!c) return;
        c.days = Math.min(3650, Math.max(1, Number(c.days) + Number(t.dataset.d)));
        paintCustom(); break;
      }
      case 'cf-save': {
        const rec = saveCustomFromSheet(); if (!rec) return;
        closeSheet();
        UI.catSel.add(rec.name);
        UI.catQ = ''; UI.catGroup = '全部';
        render();
        toast(`「${rec.name}」已加进食材库，勾上就能放`);
        break;
      }
      case 'cf-add': {
        const rec = saveCustomFromSheet(); if (!rec) return;
        closeSheet();
        addWithMerge([rec.name], {
          zone: UI.catZonePicked ? UI.catZone : null, qty: 1,
          expire: addDays(todayKey(), rec.days)
        });
        break;
      }

      /* 编辑面板 */
      case 'edit-qty': {
        const e = UI.edit; if (!e) return;
        e.qty = Math.max(0, Number(e.qty) + Number(t.dataset.d));
        const q = $('#edQty'); if (q) q.value = e.qty;
        break;
      }
      case 'edit-days': {
        const e = UI.edit; if (!e) return;
        e.expire = t.dataset.d === 'null' ? null : addDays(todayKey(), Number(t.dataset.d));
        paintEdit();
        break;
      }
      case 'edit-zone': {
        const e = UI.edit; if (!e) return;
        e.zone = t.dataset.z; paintEdit(); break;
      }
      case 'edit-icon': {
        const e = UI.edit; if (!e) return;
        e.icon = t.dataset.i; e.img = null; paintEdit(); break;
      }
      case 'edit-photo':
        pickImage(url => { UI.edit.img = url; paintEdit(); });
        break;
      case 'edit-save': {
        const e = UI.edit; if (!e) return;
        const name = norm($('#edName').value);
        if (!name) { toast('先写个名字吧', true); return; }
        const qty = Math.max(0, Number($('#edQty').value) || 0);
        const unit = ($('#edUnit').value || metaOf(name).unit).trim();
        const expire = $('#edExpire').value || null;
        if (e.isNew) {
          addWithMerge([name], { zone: e.zone, qty: qty || 1, unit, expire, img: e.img, icon: e.icon });
        } else {
          const it = S.items.find(i => i.id === e.id);
          if (!it) { closeSheet(); return; }
          if (qty <= 0) {
            S.items = S.items.filter(i => i.id !== e.id);
            save(); closeSheet(); render(); toast('已删掉 ' + name);
            break;
          }
          const z = zoneFor(name, e.zone);
          Object.assign(it, { name, qty, unit, expire, zone: z, img: e.img, icon: e.icon, cat: metaOf(name).cat });
          if (z === COND) UI.rack = COND;
          save(); closeSheet(); render(); toast('已更新 ' + name);
        }
        break;
      }
      case 'edit-del': {
        const e = UI.edit; if (!e) return;
        modal(`<h3>删掉「${esc(e.name)}」？</h3><p class="md-sub">删掉之后库存和推荐都会跟着变。</p>`, [
          { label: '删除', act: 'del-confirm', kind: 'btn-danger', block: true },
          { label: '算了', act: 'modal-close', block: true }
        ]);
        break;
      }
      case 'del-confirm': {
        const e = UI.edit;
        if (e && e.id) {
          S.items = S.items.filter(i => i.id !== e.id);
          save(); closeModal(); closeSheet(); render(); toast('已删掉');
        }
        break;
      }
      case 'merge-yes':
      case 'merge-no': {
        const pend = UI.pendingAdd; UI.pendingAdd = null;
        closeModal();
        if (pend) finishAdd(pend.names, pend.opts, act === 'merge-yes' ? 'merge' : 'separate');
        break;
      }
      case 'modal-close': closePixel(); break;
      case 'open-add':
        closeSheet(); closeModal();
        UI.view = 'catalog'; UI.catSel.clear(); UI.catQ = ''; UI.catGroup = '全部';
        render(); break;

      /* 今天 */
      case 'set-date':
        UI.date = t.dataset.k; closeSheet(); render(); break;
      case 'set-meal':
        UI.meal = t.dataset.m; render(); break;
      case 'pick-date':
        sheetDate(); break;
      case 'confirm-date': {
        const v = $('#dateInput').value;
        if (v) UI.date = v;
        closeSheet(); render(); break;
      }
      case 'open-pick': sheetPick(); break;
      case 'pick-tab':
        UI.pickTab = t.dataset.m;
        $('#sheet .sheet-body').innerHTML = pickBody();
        break;
      case 'pick-toggle': {
        const id = t.dataset.id;
        if (UI.pickSel.has(id)) UI.pickSel.delete(id); else UI.pickSel.add(id);
        const chk = t.querySelector('.pick-check');
        if (chk) chk.classList.toggle('on', UI.pickSel.has(id));
        const c = $('#pickCount'); if (c) c.textContent = UI.pickSel.size;
        break;
      }
      case 'confirm-pick': {
        const d = dayPlan(UI.date);
        d[UI.meal] = Array.from(UI.pickSel).map(id => {
          const old = mealList(UI.date, UI.meal).find(x => x.id === id);
          return { id, done: old ? old.done : false };
        });
        save(); closeSheet(); render();
        toast(UI.pickSel.size ? `已排进${shortDay(UI.date)}${UI.meal}` : '这一顿清空了');
        break;
      }
      case 'toggle-done': {
        const d = S.plans[t.dataset.k]; const m = t.dataset.m;
        if (!d || !d[m]) return;
        const x = d[m].find(v => v.id === t.dataset.id); if (!x) return;
        x.done = !x.done;
        if (x.done) S.stats.cooked = (S.stats.cooked || 0) + 1;
        save(); render();
        break;
      }
      case 'add-gaps': {
        const k = t.dataset.k, m = t.dataset.m;
        const idx = invIndex();
        let n = 0;
        mealList(k, m).forEach(x => {
          const r = dishById(x.id); if (!r) return;
          matchRecipe(r, idx).miss.forEach(i => {
            if (!(S.shop || []).some(s => s.name === i.n)) { S.shop.push({ name: i.n, amount: i.a || '' }); n++; }
          });
        });
        save(); render(); toast(n ? `已加入 ${n} 样到买菜单` : '清单里已经有了');
        break;
      }

      /* 菜谱 */
      case 'open-recipe':
        sheetRecipe(t.dataset.id, t.dataset.from); break;

      /* 录入 / 改自己的菜谱 */
      case 'new-recipe': openRecipeForm(null); break;
      case 'rf-edit': openRecipeForm(t.dataset.id); break;
      case 'rf-save': saveRecipeForm(); break;
      case 'rf-icon':
        if (UI.rf) { UI.rf.icon = t.dataset.i; paintRecipeForm(); }
        break;
      /* 手绘图标 */
      case 'pix-open': openPixel(t.dataset.t || 'edit'); break;
      case 'pix-color': {
        PIX.color = t.dataset.c || '';
        pixLast = -1;   // 换色后同一格能立刻改
        const pal = $('#modalCard');
        if (pal) pal.querySelectorAll('.pix-sw,.pix-era').forEach(b => b.classList.toggle('on', (b.dataset.c || '') === PIX.color));
        break;
      }
      case 'pix-clear': {
        PIX.stack.push(PIX.cells.slice());
        PIX.cells = new Array(PIX_N * PIX_N).fill('');
        paintPixGrid();
        break;
      }
      case 'pix-undo': {
        if (!PIX.stack.length) { toast('没有可以撤销的了'); break; }
        PIX.cells = PIX.stack.pop();
        paintPixGrid();
        break;
      }
      case 'pix-done': pixCommit(); break;
      case 'rf-cat':
        if (UI.rf) { UI.rf.cat = t.dataset.c; paintRecipeForm(); }
        break;
      case 'rf-level':
        if (UI.rf) { UI.rf.level = t.dataset.l; paintRecipeForm(); }
        break;
      case 'rf-time':
        if (UI.rf) { UI.rf.time = Number(t.dataset.t); paintRecipeForm(); }
        break;
      case 'rf-add':
        if (UI.rf) {
          const h = sheetEl.querySelector('.sheet-body');
          UI.rf.scroll = h ? h.scrollTop : 0;
          UI.rf.step = 'pick'; UI.rf.pickQ = ''; paintRecipeForm();
        }
        break;
      case 'rf-back':
        if (UI.rf) { UI.rf.step = 'form'; paintRecipeForm(); }
        break;
      case 'rf-pick': addRecipeIng(t.dataset.n); break;
      case 'rf-role': {
        const f = UI.rf;
        if (f) {
          const it = f.ing[Number(t.dataset.i)];
          if (it) { it.m = it.m ? 0 : 1; paintRecipeForm(); }
        }
        break;
      }
      case 'rf-ing-del': {
        const f = UI.rf;
        if (f) { f.ing.splice(Number(t.dataset.i), 1); paintRecipeForm(); }
        break;
      }
      case 'rf-del': {
        const r = dishById(t.dataset.id); if (!r) return;
        UI.rfDel = t.dataset.id;
        modal(`<h3>删掉「${esc(r.name)}」？</h3>
          <p class="md-sub">只从菜谱库移除；已经排进三餐的那一顿会跟着去掉。</p>`,
          [
            { label: '删掉', act: 'rf-del-yes', kind: 'btn-primary', block: true },
            { label: '留着', act: 'modal-close', block: true }
          ]);
        break;
      }
      case 'rf-del-yes': {
        const id = UI.rfDel; UI.rfDel = null;
        if (id) {
          S.recipes = (S.recipes || []).filter(r => r.id !== id);
          // 计划里还引用它的，一起清掉，免得点开是空的
          Object.keys(S.plans).forEach(k => MEALS.forEach(m => {
            if (S.plans[k][m]) S.plans[k][m] = S.plans[k][m].filter(x => x.id !== id);
          }));
          save();
        }
        closeModal(); closeSheet(); render(); toast('已删掉这道菜');
        break;
      }
      case 'recipe-shop': {
        const r = dishById(t.dataset.id); if (!r) return;
        const idx = invIndex(); let n = 0;
        matchRecipe(r, idx).miss.forEach(i => {
          if (!(S.shop || []).some(s => s.name === i.n)) { S.shop.push({ name: i.n, amount: i.a || '' }); n++; }
        });
        save(); toast(n ? `缺的 ${n} 样已加入买菜单` : '这些你都有呀');
        break;
      }
      case 'recipe-plan': {
        const [k, m] = (t.dataset.from || '').split('|');
        const ok = addDish(k || UI.date, m || UI.meal, t.dataset.id);
        render(); closeSheet();
        toast(ok ? `已安排到 ${shortDay(k || UI.date)}${m || UI.meal}` : '这一顿已经有这道了');
        break;
      }
      case 'lib-mode':
        UI.libMode = t.dataset.m; render(); break;
      case 'lib-cat':
        UI.libCat = t.dataset.c; render(); break;

      /* 买菜单 */
      case 'shop-toggle': {
        const n = t.dataset.name;
        if (S.checked[n]) delete S.checked[n]; else S.checked[n] = true;
        save(); render(); break;
      }
      case 'shop-add': {
        openSheet('加一样要买的', '', `<div class="field"><label>名称</label>
          <input class="input" id="shopName" placeholder="例如：番茄"/></div>
          <div class="field"><label>数量（可选）</label><input class="input" id="shopAmt" placeholder="例如：2 个"/></div>`,
          `<button class="btn btn-soft btn-block" data-act="close-sheet">取消</button>
           <button class="btn btn-primary btn-block" data-act="shop-save">添加</button>`);
        break;
      }
      case 'shop-save': {
        const n = norm($('#shopName').value);
        if (!n) { toast('写个名字吧', true); return; }
        S.shop.push({ name: n, amount: ($('#shopAmt').value || '').trim() });
        save(); closeSheet(); render(); toast('已加入买菜单');
        break;
      }
      case 'shop-del':
        S.shop = S.shop.filter(s => s.name !== t.dataset.name);
        delete S.checked[t.dataset.name];
        save(); render(); break;
      case 'shop-into-fridge': {
        const names = Object.keys(S.checked).filter(n => S.checked[n]);
        names.forEach(n => {
          const m = metaOf(n);
          const exist = S.items.find(i => i.name === n);
          if (exist) exist.qty = Number(exist.qty) + 1;
          else S.items.unshift({ id: uid(), name: n, cat: m.cat, qty: 1, unit: m.unit, expire: m.days ? addDays(todayKey(), m.days) : null, addedAt: todayKey() });
          delete S.checked[n];
        });
        S.shop = S.shop.filter(s => !names.includes(s.name));
        save(); render(); toast(`已把 ${names.length} 样放进冰箱`);
        break;
      }
      case 'shop-clear':
        S.checked = {}; render(); break;

      /* 我的 */
      case 'people': {
        const d = Number(t.dataset.d);
        S.prefs.people = Math.min(10, Math.max(1, S.prefs.people + d));
        save(); render(); break;
      }
      case 'avoid': {
        const k = t.dataset.k;
        const arr = S.prefs.avoid || (S.prefs.avoid = []);
        const i = arr.indexOf(k);
        if (i >= 0) arr.splice(i, 1); else arr.push(k);
        save(); render(); break;
      }
      case 'export': {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `我家冰箱-备份-${todayKey()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('备份已导出');
        break;
      }
      case 'import': {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            try {
              const obj = JSON.parse(fr.result);
              if (!obj || !Array.isArray(obj.items)) throw 0;
              localStorage.setItem(KEY, JSON.stringify(obj));
              S = load(); render(); toast('备份已恢复');
            } catch (e) { toast('文件格式不对', true); }
          };
          fr.readAsText(f);
        };
        inp.click();
        break;
      }
      case 'reset': {
        if (!confirm('清空所有数据，并恢复成示例冰箱？')) return;
        localStorage.removeItem(KEY);
        S = fresh(); save(); render(); toast('已重置');
        break;
      }

      case 'close-sheet': closeSheet(); break;
      default: break;
    }
  });

  /* 像素画布：按住拖着画 */
  document.addEventListener('pointerdown', e => {
    if (!PIX.target) return;
    const cell = e.target.closest && e.target.closest('.pix-cell');
    if (!cell) return;
    e.preventDefault();
    PIX.stack.push(PIX.cells.slice());
    if (PIX.stack.length > 40) PIX.stack.shift();
    pixDown = true; pixLast = -1;
    pixPaint(cell);
  });
  document.addEventListener('pointermove', e => {
    if (!pixDown || !PIX.target) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest && el.closest('.pix-cell');
    if (cell) pixPaint(cell);
  });
  ['pointerup', 'pointercancel'].forEach(t =>
    document.addEventListener(t, () => { pixDown = false; pixLast = -1; }));

  /* 输入事件 */
  document.addEventListener('input', e => {
    const el = e.target;
    const k = el.dataset.input;
    if (k === 'stock-q') {
      UI.stockQ = el.value;
      const box = $('#stageInner');
      if (box) box.innerHTML = viewStock();
      const inp = $('#stockSearch');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
    else if (k === 'cat-q') { UI.catQ = el.value; render(); const i2 = $('#catSearch'); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } }
    else if (k === 'edit-name' && UI.edit) {
      const wasCond = isCond(UI.edit.name);
      UI.edit.name = el.value;
      const nowCond = isCond(el.value);
      if (nowCond) UI.edit.zone = COND;
      else if (UI.edit.zone === COND) UI.edit.zone = '冷藏';
      // 改成 / 改离调料时，层位选项要跟着换（只换这一段，别把输入框重建掉）
      if (nowCond !== wasCond) {
        const pos = el.selectionStart;
        paintEdit();
        const n2 = $('#edName');
        if (n2) { n2.focus(); n2.setSelectionRange(pos, pos); }
      }
    }
    else if (k === 'edit-qty' && UI.edit) { UI.edit.qty = Number(el.value) || 0; }
    else if (k === 'edit-unit' && UI.edit) { UI.edit.unit = el.value; }
    else if (k === 'edit-expire' && UI.edit) { UI.edit.expire = el.value || null; }
    /* 录入菜谱：只写数据、不重绘，免得光标乱跳 */
    else if (k === 'rf-name' && UI.rf) { UI.rf.name = el.value; }
    else if (k === 'rf-steps' && UI.rf) { UI.rf.steps = el.value; }
    else if (k === 'rf-amt' && UI.rf) {
      const it = UI.rf.ing[Number(el.dataset.i)];
      if (it) it.a = el.value;
    }
    else if (k === 'rf-pick-q' && UI.rf) {
      UI.rf.pickQ = el.value;
      const box = $('#rfPickList');
      if (box) box.innerHTML = rfPickListHTML();
    }
    else if (k === 'cf-name' && UI.cf) {
      const c = UI.cf;
      c.name = el.value;
      // 还没手动挑过分类时按名字猜（孜然粉 → 调料）；只改高亮不重建面板，免得光标乱跳
      if (!c.touched) {
        const g = guessGroup(el.value.trim());
        if (g !== c.group) {
          c.group = g; c.icon = null;
          $$('[data-act="cf-cat"]').forEach(b => b.classList.toggle('on', b.dataset.g === g));
          $$('[data-act="cf-icon"]').forEach(b => b.classList.toggle('on', b.dataset.i === cfIcon()));
        }
      }
    }
    else if (k === 'cf-unit' && UI.cf) { UI.cf.unit = el.value; }
    else if (k === 'cf-days-in' && UI.cf) { UI.cf.days = Number(el.value) || 1; }
    else if (k === 'lib-q') { UI.libQ = el.value; softRender(); }
    else if (el.dataset.input === 'pick-q') {
      UI.pickQ = el.value;
      const idx = invIndex();
      let list = scored(idx);
      if (UI.pickQ.trim()) {
        const q = UI.pickQ.trim();
        list = list.filter(x => x.r.name.includes(q) || x.r.ing.some(i => i.n.includes(q)));
      } else {
        if (UI.pickTab === '推荐') list = recommended(idx, UI.meal).filter(x => x.miss.length <= 1);
        if (UI.pickTab === '可做') list = cookable(idx).filter(x => mealFit(x.r, UI.meal));
      }
      const c = $('#pickList'); if (c) c.innerHTML = pickListHTML(list);
    }
  });

  /* Esc 关闭 */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSheet();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      const box = $('#stockSearch') || $('#catSearch') || $('#libSearch');
      if (box) { e.preventDefault(); box.focus(); }
    }
  });

  /* ------------------------------------------------------------
   * 12. 启动
   * ---------------------------------------------------------- */
  S = load();
  // 首次使用：给今天安排一点示例，让首页不空
  if (!Object.keys(S.plans).length) {
    const t = todayKey();
    const d = dayPlan(t);
    d['午餐'] = [{ id: 'r01', done: false }, { id: 'r39', done: false }];
    save();
  }
  // 便于截图 / 调试：#view=today&meal=晚餐&sheet=recipe:r01
  (function fromHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('view')) UI.view = h.get('view');
    if (h.get('meal')) UI.meal = h.get('meal');
    if (h.get('zone')) UI.zone = h.get('zone');
    if (h.get('door') === '1') S.prefs.doorOpen = true;
    if (h.get('door') === '0') S.prefs.doorOpen = false;
    if (h.get('stockZone')) UI.stockZone = h.get('stockZone');
    if (h.get('catGroup')) UI.catGroup = h.get('catGroup');
    // 调试：#cus=秋葵,马蹄 假装用户自己加过这几样
    if (h.get('cus')) h.get('cus').split(',').filter(Boolean).forEach(n =>
      S.custom.push({ name: n, group: guessGroup(n), icon: CF_ICON[guessGroup(n)], unit: '份', days: 7, at: todayKey() }));
    // 调试：#snack=冰淇淋,巧克力 塞两包零食（冰品进冷冻，其余进冷藏）
    if (h.get('snack')) h.get('snack').split(',').filter(Boolean).forEach((n, i) => {
      if (!S.custom.some(c => c.name === n)) S.custom.push({ name: n, group: SNACK, icon: guessSnackIcon(n), unit: '包', days: 90, at: todayKey() });
      S.items.push({
        id: 'mock-snack' + i, name: n, cat: SNACK, qty: 1, unit: '包',
        expire: addDays(todayKey(), 60 + i), zone: FROZEN_HINT.test(n) ? '冷冻' : '冷藏', addedAt: todayKey()
      });
    });
    if (h.get('rack')) UI.rack = h.get('rack');
    // 调试用假数据：#mock=25&mockzone=冷藏 往指定区塞 N 样，看看格子密度
    if (h.get('mock')) {
      const want = Number(h.get('mock')) || 0, mz = h.get('mockzone') || '冷藏';
      Object.keys(ING)
        .filter(n => metaOf(n).cat !== '调料' && !S.items.some(i => i.name === n))
        .slice(0, want)
        .forEach((n, i) => S.items.push({
          id: 'mock' + i, name: n, cat: metaOf(n).cat, qty: 1 + (i % 3), unit: metaOf(n).unit,
          expire: addDays(todayKey(), 2 + i), zone: mz, addedAt: todayKey()
        }));
    }
    // 调试：#myr=红烧肉,外婆的汤 假装录过几道自己的菜
    if (h.get('myr')) {
      h.get('myr').split(',').filter(Boolean).forEach((n, i) => {
        S.recipes.unshift({
          id: 'mock-my' + i, name: n, icon: '🍲', cat: '家常菜', time: 40, level: '熟练',
          tags: [], mine: true, at: todayKey(),
          ing: [{ n: '五花肉', a: '500g', m: 1 }, { n: '土豆', a: '1个', m: 1 }, { n: '生抽', a: '2勺' }],
          steps: ['肉切块，冷水下锅焯水', '小火炒糖色，下肉翻匀', '加水没过肉，小火炖 40 分钟']
        });
      });
    }
    const sh = h.get('sheet');
    if (sh) {
      const [k, v] = sh.split(':');
      if (k === 'recipe') sheetRecipe(v);
      else if (k === 'pick') sheetPick();
      else if (k === 'date') sheetDate();
      else if (k === 'edit') {
        const it = S.items.find(i => i.name === v) || S.items[0];
        if (it) openEdit(it.id);
      }
      else if (k === 'quick') openQuickAdd(v);
      else if (k === 'custom') openCustom(v === '_' ? '' : v);
      else if (k === 'newrecipe') openRecipeForm(null);
      else if (k === 'rfpick') { openRecipeForm(null); UI.rf.step = 'pick'; paintRecipeForm(); }
      else if (k === 'editrecipe') {
        const r = myRecipes().find(x => x.name === v);
        openRecipeForm(r ? r.id : null);
      }
      else if (k === 'myrecipe') {
        const r = myRecipes().find(x => x.name === v);
        if (r) sheetRecipe(r.id);
      }
      else if (k === 'merge') { UI.catSel.add(v); setTimeout(() => addWithMerge([v], { zone: '冷藏' }), 60); }
    }
    // 截图用：把录入面板滚到底（看食材行与做法）
    if (h.get('rfb')) {
      const b = document.querySelector('#sheet .sheet-body');
      if (b) b.scrollTop = b.scrollHeight;
    }
    if (h.get('rfq') && UI.rf) { UI.rf.pickQ = h.get('rfq'); paintRecipeForm(); }
    // 调试：#pix=edit|cf|rf 直接打开手绘图标面板（配合 sheet= 用）
    if (h.get('pix')) {
      const t = h.get('pix');
      if ((t === 'edit' && UI.edit) || (t === 'cf' && UI.cf) || (t === 'rf' && UI.rf)) openPixel(t);
    }
  })();

  render();
  window.W2E_APP = { get state() { return S; }, render };
})();

/* Steplify MVP — JSON'ları /data/ klasöründen otomatik yükler + freemium kilit + zengin içerik */
console.log('Steplify app v4');
const FREE_LIMIT = 5;
const PREMIUM_KEY = "steplify_premium";   // localStorage anahtarı

function isPremium() {
  try { return localStorage.getItem(PREMIUM_KEY) === "1"; } catch(_) { return false; }
}
function setPremium(v) {
  localStorage.setItem(PREMIUM_KEY, v ? "1" : "0");
  reflectPremiumUI();
}

let models = {};    // { modelName: steps[] }
let currentModel = null;

const DATA_FILES = [
  {name:"Affiliate",         path:"/public/data/affiliate.json"},
  {name:"Dropshipping",      path:"/public/data/dropshipping.json"},
  {name:"YouTube",           path:"/public/data/youtube.json"},
  {name:"Print on Demand",   path:"/public/data/pod.json"},
  {name:"E-ticaret",         path:"/public/data/eticaret.json"},
  {name:"Freelance",         path:"/public/data/freelance.json"},
];

// DOM elemanları
const els = {
  jsonInput: document.getElementById('jsonInput'),
  modelSelect: document.getElementById('modelSelect'),
  stepsList: document.getElementById('stepsList'),
  stepView: document.getElementById('stepView'),
  linksList: document.getElementById('linksList'),
  progressBar: document.getElementById('progressBar'),
  sidebarTitle: document.getElementById('sidebarTitle'),
  resetProgress: document.getElementById('resetProgress'),
  premiumBtn: document.getElementById('premiumBtn'),
  loadSample: document.getElementById('loadSample'),
};

// Kısa fallback açıklamalar (sheet yoksa)
const OPTION_TIPS = {
  "İş Modeli Seç": {
    "Dijital Ürünler": "Dijital ürünler stok gerektirmez; komisyonlar genelde daha yüksektir.",
    "Fiziksel Ürünler": "Fiziksel ürünlerde komisyon düşük ama talep yüksek; lojistik gerekir."
  }
};

// --------- Yardımcılar ----------
function esc(s){ return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

function renderOptionDetailHTML(det){
  if (!det || typeof det!=='object') return '';
  let html = '';
  if (det.info) html += `<p style="margin:0 0 8px">${esc(det.info)}</p>`;
  const mk = (arr) => (arr && arr.length) ? `<ul style="margin:6px 0 0 16px">${arr.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : '';
  if (det.pros && det.pros.length) html += `<div><b>Artılar</b>${mk(det.pros)}</div>`;
  if (det.cons && det.cons.length) html += `<div style="margin-top:8px"><b>Eksiler</b>${mk(det.cons)}</div>`;
  return html;
}

// --------- Güvenli Modal (tek kopya) ----------
let _modalResolver = null;

function ensureModal() {
  let m = document.getElementById('steplifyModal');
  if (m) return m;

  m = document.createElement('div');
  m.id = 'steplifyModal';
  m.style.cssText = `
    position:fixed; inset:0; display:none; z-index:9999;
    align-items:center; justify-content:center;
  `;
  m.innerHTML = `
    <div class="modal-backdrop" style="
      position:absolute; inset:0; background:rgba(0,0,0,.45);
    "></div>
    <div class="modal-sheet" style="
      position:relative; background:#fff; border-radius:12px; padding:16px 18px;
      width:min(560px, 92vw); box-shadow:0 20px 60px rgba(0,0,0,.25);
    ">
      <h3 id="modalTitle" style="margin:0 0 6px; font-size:18px;"></h3>
      <div id="modalText" style="margin:0 0 14px; color:#475569; line-height:1.5;"></div>
      <div class="modal-actions" style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="modalCancel" class="btn small outline" type="button">Vazgeç</button>
        <button id="modalOk" class="btn small primary" type="button">Devam Et</button>
      </div>
    </div>
  `;
  const okBtn = m.querySelector('#modalOk');
  const cancelBtn = m.querySelector('#modalCancel');
  Object.assign(okBtn.style, {
    background: '#2563eb',
    color: '#fff',
    border: '1px solid #1e40af',
    padding: '8px 12px',
    borderRadius: '8px'
  });
  Object.assign(cancelBtn.style, {
    background: '#fff',
    color: '#111',
    border: '1px solid #cbd5e1',
    padding: '8px 12px',
    borderRadius: '8px'
  });

  document.body.appendChild(m);

  // Kapatma/Onay bağlantıları
  const backdrop   = m.querySelector('.modal-backdrop');
  const btnCancel  = m.querySelector('#modalCancel');
  const btnOk      = m.querySelector('#modalOk');

  backdrop.addEventListener('click', () => closeModal(false));
  btnCancel.addEventListener('click', () => closeModal(false));
  btnOk.addEventListener('click', () => closeModal(true));

  // Klavye kısayolları
  document.addEventListener('keydown', (ev)=>{
    if (m.style.display === 'none') return;
    if (ev.key === 'Escape') closeModal(false);
    if (ev.key === 'Enter')  closeModal(true);
  });

  return m;
}

function openModal(title, html) {
  const m = ensureModal();
  m.style.display = 'flex';
  m.querySelector('#modalTitle').textContent = title || '';
  m.querySelector('#modalText').innerHTML   = html || '';
  return new Promise((resolve) => { _modalResolver = resolve; });
}

function closeModal(ok) {
  const m = document.getElementById('steplifyModal');
  if (!m) return;
  m.style.display = 'none';
  if (_modalResolver) { _modalResolver(!!ok); _modalResolver = null; }
}

// ---- LocalStorage yardımcıları ----
function lsKey(model){ return `steplify_progress::${model}`; }
function selKey(model){ return `steplify_selection::${model}`; }

function getProgress(m){
  try{ return JSON.parse(localStorage.getItem(lsKey(m))||'{}'); }catch(_){ return {}; }
}
function setProgress(m, obj){ localStorage.setItem(lsKey(m), JSON.stringify(obj||{})); }

function getSelections(m){
  try { return JSON.parse(localStorage.getItem(selKey(m)) || '{}'); }
  catch(_) { return {}; }
}
function setSelections(m, obj){
  localStorage.setItem(selKey(m), JSON.stringify(obj || {}));
}

// ---- URL hash (derin link) ----
function setHash(model, stepId){
  try { location.hash = `${encodeURIComponent(model)}:${stepId}`; } catch(_) {}
}
function getHash(){
  const h = (location.hash||'').replace(/^#/, '');
  if (!h) return {model:null, id:null};
  const [m, idStr] = h.split(':');
  const model = decodeURIComponent(m||'');
  const id = Number(idStr);
  return {model, id: Number.isFinite(id) ? id : null};
}

// ---- Branching görünürlük ----
function parseVisibleIf(expr){
  if (!expr || typeof expr !== 'string') return [];
  // "step:1=A|B; step:5=X" => [[{step:1,vals:['A','B']}],[{step:5,vals:['X']}]]
  // ;  = AND,  | = OR
  const andParts = expr.split(';').map(s=>s.trim()).filter(Boolean);
  return andParts.map(part=>{
    const ors = part.split('|').map(s=>s.trim()).filter(Boolean);
    return ors.map(t=>{
      const m = t.match(/^step:(\d+)\s*=\s*(.+)$/i);
      if (!m) return null;
      const stepId = Number(m[1]);
      const vals = m[2].split(',').map(v=>v.trim()).filter(Boolean);
      return {step: stepId, vals};
    }).filter(Boolean);
  });
}
function computeStepVisibility(step, selections){
  const cond = parseVisibleIf(step.visibleIf);
  if (!cond.length) return true; // kural yoksa görünür
  // AND of (OR groups)
  return cond.every(orGroup => {
    return orGroup.some(rule => {
      const sel = selections[rule.step];
      return sel && rule.vals.includes(sel);
    });
  });
}

// ---- Render yardımcıları ----
function computeOrder(steps){ return steps.slice().sort((a,b)=>a.id-b.id); }
function getOrderedSteps(){ return computeOrder(models[currentModel] || []); }

function reflectPremiumUI(){
  const on = isPremium();
  if (els.premiumBtn) els.premiumBtn.style.display = on ? 'none' : '';
}

function markActive(stepId){
  [...els.stepsList.querySelectorAll('.step')].forEach(li => li.classList.remove('active'));
  const order = computeOrder(models[currentModel]||[]);
  const idx   = order.findIndex(s=>s.id===stepId);
  const items = [...els.stepsList.querySelectorAll('.step')];
  if (idx>=0 && items[idx]) items[idx].classList.add('active');
}

function renderModels(){
  els.modelSelect.innerHTML = '';
  const names = Object.keys(models);
  names.forEach(n=>{
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    els.modelSelect.appendChild(opt);
  });

  if (names.length){
    const {model, id} = getHash();
    currentModel = (model && models[model]) ? model : names[0];
    els.modelSelect.value = currentModel;
    renderSteps();

    const first = computeOrder(models[currentModel] || [])[0];
    if (id){
      const order = computeOrder(models[currentModel] || []);
      const idx = order.findIndex(s=>s.id===id);
      if (idx>=0) showStep(order[idx], idx);
      else if (first) showStep(first, 0);
    } else if (first) {
      showStep(first, 0);
    }
  } else {
    currentModel = null;
  }
}

function renderSteps(){
  if (!currentModel || !models[currentModel] || !Array.isArray(models[currentModel]) || models[currentModel].length === 0) {
    els.sidebarTitle.textContent = 'Adımlar';
    els.stepsList.innerHTML = '';
    els.linksList.innerHTML = '';
    els.progressBar.style.width = '0%';
    els.progressBar.title = '0% tamamlandı';
    return;
  }

  const sels = getSelections(currentModel);
  const steps = models[currentModel] || [];
  const order = computeOrder(steps);
  const filtered = order.filter(s => computeStepVisibility(s, sels));
  const progress = getProgress(currentModel);

  els.sidebarTitle.textContent = `Adımlar — ${currentModel}`;
  els.stepsList.innerHTML = '';

  let doneCount = 0;

  filtered.forEach((s, idx) => {
    const li = document.createElement('li');
    li.className = 'step';

    const locked = (idx >= FREE_LIMIT) && !isPremium();
    if (locked) li.classList.add('locked');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.disabled = locked;
    cb.checked = !!progress[s.id];
    if (cb.checked) doneCount++;

    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = getProgress(currentModel);
      p[s.id] = !!e.target.checked;
      setProgress(currentModel, p);
      renderSteps();
    });

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `${s.id}. ${s.title}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = s.parentId ? `Üst adım: ${s.parentId}` : 'Kök adım';

    const chosen = sels[s.id];
    if (chosen) meta.textContent += ` • Seçim: ${chosen}`;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.appendChild(title);
    row.appendChild(meta);

    li.appendChild(cb);
    li.appendChild(row);

    li.addEventListener('click', () => showStep(s, idx, filtered));

    els.stepsList.appendChild(li);
  });

  const pct = filtered.length ? Math.round((Object.values(progress).filter(Boolean).length / filtered.length) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.title = `${pct}% tamamlandı`;
}

function renderGlossaryCard(step){
  const g = step.glossary || {};
  const terms = Object.keys(g);
  if (!terms.length) return null;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginTop = '12px';
  card.style.background = '#f8fafc';
  card.style.borderColor = '#e2e8f0';
  let html = `<h4 style="margin:0 0 6px">Terimler</h4><div class="muted" style="font-size:13px;margin-bottom:6px">Bu adımda geçen kavramlar</div>`;
  html += `<dl style="margin:0">`;
  terms.forEach(t=>{
    html += `<dt style="font-weight:600;margin-top:8px">${esc(t)}</dt><dd style="margin:2px 0 0 0">${esc(g[t])}</dd>`;
  });
  html += `</dl>`;
  card.innerHTML = html;
  return card;
}

function showStep(step, index, filteredList=null){
  els.stepView.innerHTML = '';

  const h = document.createElement('h2');
  h.textContent = `${step.id}. ${step.title}`;
  const d = document.createElement('p');
  d.textContent = step.description || 'Açıklama yok.';
  els.stepView.appendChild(h);
  els.stepView.appendChild(d);

  const gcard = renderGlossaryCard(step);
  if (gcard) els.stepView.appendChild(gcard);

  const sels = getSelections(currentModel);
  if (sels[step.id]) {
    const info = document.createElement('div');
    info.className = 'muted';
    info.style.marginTop = '4px';
    info.textContent = `Seçimin: ${sels[step.id]}`;
    els.stepView.appendChild(info);
  }

  const locked = (index >= FREE_LIMIT) && !isPremium();

  if (step.options && step.options.length) {
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'options';

    step.options.forEach(o => {
      const b = document.createElement('button');
      b.className = 'btn option-btn';
      b.textContent = o;
      b.dataset.option = o;
      if (sels[step.id] === o) b.classList.add('selected');
      if (locked) b.disabled = true;

      b.addEventListener('click', async () => {
        if (locked) return;

        const detailsMap = step.optionDetails || {};
        const det = detailsMap[o];
        const fallback =
          (OPTION_TIPS[step.title] && OPTION_TIPS[step.title][o]) ||
          `${o} ile devam edilsin mi?`;

        const html = det ? renderOptionDetailHTML(det) : `<p>${esc(fallback)}</p>`;
        const ok = await openModal(o, html);
        if (!ok) return;

        // Sonraki görünür adımı hesapla (filtreli sıraya göre)
        const order = Array.isArray(filteredList) ? filteredList : computeOrder(models[currentModel] || []).filter(s=>computeStepVisibility(s, getSelections(currentModel)));
        const curIdx = order.findIndex(s => s.id === step.id);
        const next   = order[curIdx + 1];
        const nextIdx = curIdx + 1;

        const _sels = getSelections(currentModel);
        _sels[step.id] = o;
        setSelections(currentModel, _sels);

        const p = getProgress(currentModel);
        p[step.id] = true;
        setProgress(currentModel, p);

        renderSteps();

        if (next) showStep(next, nextIdx);
      });

      optionsWrap.appendChild(b);
    });

    els.stepView.appendChild(optionsWrap);
  }

  // Sağdaki "Kaynaklar"
  els.linksList.innerHTML = '';
  (step.links || []).forEach(u => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = u; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = u;
    li.appendChild(a);
    els.linksList.appendChild(li);
  });

  if (locked) {
    const lock = document.createElement('div');
    lock.className = 'card';
    lock.style.marginTop = '12px';
    lock.style.background = '#fff7ed';
    lock.style.borderColor = '#fdba74';
    lock.innerHTML = `
      <b>Premium Kilit</b><br/>
      Bu adımı görmek için Premium'a geç.
      <div style="margin-top:8px">
        <a id="buyPremium" class="btn small primary" href="/premium.html">Premium'a Geç</a>
      </div>
    `;
    els.stepView.appendChild(lock);
  }

  markActive(step.id);
  setHash(currentModel, step.id);
}

function goToNextStep(currentStep){
  const order = getOrderedSteps().filter(s=>computeStepVisibility(s, getSelections(currentModel)));
  const i = order.findIndex(s => s.id === currentStep.id);
  const next = order[i+1];
  if(next){ showStep(next, i+1); }
}

// ---- Veri yükleme ----
async function loadDataFiles(){
  for(const f of DATA_FILES){
    try{
      const res = await fetch(f.path, {cache:'no-store'});
      if(!res.ok) continue;
      const obj = await res.json();
      if(obj && obj.model && Array.isArray(obj.steps)){
        models[obj.model] = obj.steps;
      }
    }catch(e){/* geç */}
  }
  renderModels();
  reflectPremiumUI();

  if (isPremium()){
    console.log("Premium aktif! UI güncelleniyor...");
    renderSteps();
  }
}

// ---- JSON güvenliği (sanitize) ----
function sanitizeOptionDetails(od){
  const out = {};
  if (!od || typeof od !== 'object') return out;
  Object.keys(od).slice(0,10).forEach(k=>{
    const v = od[k] || {};
    out[String(k).slice(0,120)] = {
      info: String(v.info||'').slice(0,500),
      pros: Array.isArray(v.pros) ? v.pros.map(x=>String(x).slice(0,160)).slice(0,10) : [],
      cons: Array.isArray(v.cons) ? v.cons.map(x=>String(x).slice(0,160)).slice(0,10) : [],
    };
  });
  return out;
}
function sanitizeGlossary(g){
  const out = {};
  if (!g || typeof g !== 'object') return out;
  Object.keys(g).slice(0,30).forEach(term=>{
    out[String(term).slice(0,80)] = String(g[term]||'').slice(0,400);
  });
  return out;
}

function sanitizePlan(obj){
  if (!obj || typeof obj!=='object') return null;
  if (typeof obj.model!=='string' || obj.model.length>60) return null;
  if (!Array.isArray(obj.steps) || obj.steps.length>1000) return null;
  const steps = obj.steps.map(s=>({
    id: Number(s.id),
    title: String(s.title||'').slice(0,200),
    description: String(s.description||'').slice(0,3000),
    parentId: s.parentId!=null ? Number(s.parentId) : null,
    options: Array.isArray(s.options) ? s.options.map(o=>String(o).slice(0,120)).slice(0,20) : [],
    links: Array.isArray(s.links) ? s.links.map(u=>String(u).slice(0,300)).slice(0,20) : [],
    visibleIf:
      (typeof s.visibleIf === 'string') ? s.visibleIf.slice(0,500)
    : (typeof s['GörünürEğer'] === 'string') ? s['GörünürEğer'].slice(0,500)
    : "",
    optionDetails: sanitizeOptionDetails(s.optionDetails),
    glossary: sanitizeGlossary(s.glossary || s['Terimler'] || s['Sözlük'] || s['Sozluk'])
  })).filter(s=>Number.isFinite(s.id));
  return { model: obj.model, steps };
}

// ---- Eventler ----
document.addEventListener('DOMContentLoaded', () => {
  ensureModal();
  closeModal(false);
  reflectPremiumUI();
  loadDataFiles();

  if (els.loadSample) {
    els.loadSample.addEventListener('click', () => {
      const names = Object.keys(models);
      if (!names.length) return alert('Örnekler yüklenemedi. JSON dosyaları bulunamadı.');
      currentModel = names[0];
      els.modelSelect.value = currentModel;
      renderSteps();
      const first = computeOrder(models[currentModel] || [])[0];
      if (first) showStep(first, 0);
    });
  }

  window.addEventListener('hashchange', ()=>{
    const {model, id} = getHash();
    if (!model || !models[model] || !Number.isFinite(id)) return;
    currentModel = model;
    if (els.modelSelect) els.modelSelect.value = model;
    renderSteps();
    const order = computeOrder(models[model] || []).filter(s=>computeStepVisibility(s, getSelections(model)));
    const idx = order.findIndex(s=>s.id===id);
    if (idx>=0) showStep(order[idx], idx, order);
  });
});

els.modelSelect.addEventListener('change', e=>{
  currentModel = e.target.value;
  renderSteps();
  const first = computeOrder(models[currentModel] || []).filter(s=>computeStepVisibility(s, getSelections(currentModel)))[0];
  if (first) showStep(first, 0);
});

els.resetProgress.addEventListener('click', ()=>{
  if(!currentModel) return;
  localStorage.removeItem(lsKey(currentModel));
  renderSteps();
});

els.jsonInput.addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const raw = JSON.parse(reader.result);
      const obj = sanitizePlan(raw);
      if(obj){
        models[obj.model]=obj.steps;
        renderModels();
      } else {
        alert('Geçersiz/çok büyük JSON.');
      }
    }catch(err){ alert('JSON okunamadı: '+err.message); }
  };
  reader.readAsText(file, 'utf-8');
});

window.addEventListener('storage', (e)=>{
  if(e.key===PREMIUM_KEY) reflectPremiumUI();
});

// URL ile premium açma (debug)
if (new URLSearchParams(location.search).get("unlock") === "1") {
  setPremium(true);
}

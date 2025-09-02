/* Steplify MVP — JSON'ları /data/ klasöründen otomatik yükler + freemium kilit */
console.log('Steplify app v3-branching');
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

// Açıklama kısa metinleri (isteğe göre genişlet)
const OPTION_TIPS = {
  "İş Modeli Seç": {
    "Dijital Ürünler": "Dijital ürünler (kurs, yazılım, e-kitap) stok gerektirmez; komisyonlar genelde daha yüksektir.",
    "Fiziksel Ürünler": "Fiziksel ürünlerde komisyon düşük ama talep yüksek; lojistik ve kargo takibi gerekir."
  }
};

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
      width:min(520px, 92vw); box-shadow:0 20px 60px rgba(0,0,0,.25);
    ">
      <h3 id="modalTitle" style="margin:0 0 6px; font-size:18px;"></h3>
      <p id="modalText" style="margin:0 0 14px; color:#475569;"></p>
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

function openModal(title, text) {
  if (!title && !text) return Promise.resolve(false);

  const m = ensureModal();
  m.style.display = 'flex';
  m.querySelector('#modalTitle').textContent = title || '';
  m.querySelector('#modalText').textContent  = text  || '';

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

// ---- Branching: VisibleIf / GörünürEğer ----
// Sözdizimi (CSV/JSON içinde): "step:<ID>=Değer1|Değer2; step:<ID>=Başka"
// ';' = AND, '|' = OR
function parseVisibleIf(v){
  if (!v || typeof v!=='string') return [];
  return v.split(';').map(part => {
    const p = part.trim();
    const m = p.match(/^step:(\d+)\s*=\s*(.+)$/i);
    if (!m) return null;
    const stepId = Number(m[1]);
    const values = m[2].split('|').map(s=>s.trim()).filter(Boolean);
    return { stepId, values };
  }).filter(Boolean);
}
function isStepVisible(step, selections){
  const vi = step.visibleIf || step['GörünürEğer'] || step['gorunurEger'];
  const rules = parseVisibleIf(vi);
  if (!rules.length) return true; // kural yoksa görünür
  for (const r of rules){
    const chosen = selections[r.stepId];
    if (!r.values.includes(String(chosen||''))) return false; // AND
  }
  return true;
}

// ---- Render yardımcıları ----
function computeOrder(steps){ return steps.slice().sort((a,b)=>a.id-b.id); }
function computeFilteredOrder(modelName){
  const steps = models[modelName] || [];
  const order = computeOrder(steps);
  const sels  = getSelections(modelName);
  return order.filter(s => isStepVisible(s, sels));
}
function getOrderedSteps(){ return computeFilteredOrder(currentModel); }

function reflectPremiumUI(){
  const on = isPremium();
  if (els.premiumBtn) els.premiumBtn.style.display = on ? 'none' : '';
}

function markActive(stepId){
  [...els.stepsList.querySelectorAll('.step')].forEach(li => li.classList.remove('active'));
  const order = computeFilteredOrder(models[currentModel] ? currentModel : null);
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
    // Hash'te model varsa onu kullan, yoksa ilkini seç
    const {model, id} = getHash();
    currentModel = (model && models[model]) ? model : names[0];
    els.modelSelect.value = currentModel;
    renderSteps();

    const first = computeFilteredOrder(currentModel)[0];
    if (id){
      const order = computeFilteredOrder(currentModel);
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
  // Güvenlik: model yoksa veya adım yoksa UI'yı temizle
  if (!currentModel || !models[currentModel] || !Array.isArray(models[currentModel]) || models[currentModel].length === 0) {
    els.sidebarTitle.textContent = 'Adımlar';
    els.stepsList.innerHTML = '';
    els.linksList.innerHTML = '';
    els.progressBar.style.width = '0%';
    els.progressBar.title = '0% tamamlandı';
    return;
  }

  const sels = getSelections(currentModel);
  const order = computeFilteredOrder(currentModel); // *** sadece görünen adımlar ***
  const progress = getProgress(currentModel);

  els.sidebarTitle.textContent = `Adımlar — ${currentModel}`;
  els.stepsList.innerHTML = '';

  let doneCount = 0;

  order.forEach((s, idx) => {
    const li = document.createElement('li');
    li.className = 'step';

    const locked = (idx >= FREE_LIMIT) && !isPremium();
    if (locked) li.classList.add('locked');

    // checkbox
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
      renderSteps();           // yalnızca liste/bar güncelleniyor
    });

    // başlık + meta
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

    // listedeki elemana tıklayınca adımı göster
    li.addEventListener('click', () => showStep(s, idx));

    els.stepsList.appendChild(li);
  });

  // Progress: sadece görünen adımlar üzerinden
  const denom = order.length || 1;
  const pct = Math.round((doneCount / denom) * 100);
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.title = `${pct}% tamamlandı`;
}

function showStep(step, index){
  // İçeriği sıfırla
  els.stepView.innerHTML = '';

  // Başlık + açıklama
  const h = document.createElement('h2');
  h.textContent = `${step.id}. ${step.title}`;
  const d = document.createElement('p');
  d.textContent = step.description || 'Açıklama yok.';
  els.stepView.appendChild(h);
  els.stepView.appendChild(d);

  // Seçimler (kullanıcının daha önce seçtikleri)
  const sels = getSelections(currentModel);
  if (sels[step.id]) {
    const info = document.createElement('div');
    info.className = 'muted';
    info.style.marginTop = '4px';
    info.textContent = `Seçimin: ${sels[step.id]}`;
    els.stepView.appendChild(info);
  }

  // Bu adım kilitli mi? (freemium)
  const locked = (index >= FREE_LIMIT) && !isPremium();

  // Seçenek butonları
  if (step.options && step.options.length) {
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'options'; // ortalı, büyük

    step.options.forEach(o => {
      const b = document.createElement('button');
      b.className = 'btn option-btn';
      b.textContent = o;
      b.dataset.option = o;

      // Eğer bu adım için daha önce seçim yapılmışsa, butonu vurgula
      if (sels[step.id] === o) b.classList.add('selected');

      // kilitliyse pasif
      if (locked) b.disabled = true;

      b.addEventListener('click', async () => {
        if (locked) return;

        // kısa açıklama
        const tip =
          (OPTION_TIPS[step.title] && OPTION_TIPS[step.title][o]) ||
          `${o} ile devam edilsin mi?`;

        // modal
        const ok = await openModal(o, tip);
        if (!ok) return;

        // --- 2) Seçimi ve ilerlemeyi kaydet ---
        const _sels = getSelections(currentModel);
        _sels[step.id] = o;
        setSelections(currentModel, _sels);

        const p = getProgress(currentModel);
        p[step.id] = true;
        setProgress(currentModel, p);

        // --- 3) Listeyi yenile (visibility değişebilir!) ---
        renderSteps();

        // --- 4) Görünür SIRADAKİ adıma git ---
        const order  = computeFilteredOrder(currentModel);
        const curIdx = order.findIndex(s => s.id === step.id);
        const next   = order[curIdx + 1];
        if (next) showStep(next, curIdx + 1);
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

  // Kilit kartı
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

  // Aktif adımı işaretle ve hash'i güncelle
  markActive(step.id);
  setHash(currentModel, step.id);
}

function goToNextStep(currentStep){
  const order = getOrderedSteps(); // *** filtered ***
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
function sanitizePlan(obj){
  if (!obj || typeof obj!=='object') return null;
  if (typeof obj.model!=='string' || obj.model.length>60) return null;
  if (!Array.isArray(obj.steps) || obj.steps.length>500) return null;

  const steps = obj.steps.map(s=>({
    id: Number(s.id),
    title: String(s.title||'').slice(0,200),
    description: String(s.description||'').slice(0,2000),
    parentId: s.parentId!=null ? Number(s.parentId) : null,
    options: Array.isArray(s.options) ? s.options.map(o=>String(o).slice(0,120)).slice(0,10) : [],
    links: Array.isArray(s.links) ? s.links.map(u=>String(u).slice(0,300)).slice(0,10) : [],
    // görünürlük kuralı (TR/EN anahtarları kabul)
    visibleIf:
      (typeof s.visibleIf === 'string') ? s.visibleIf.slice(0,500)
    : (typeof s['GörünürEğer'] === 'string') ? s['GörünürEğer'].slice(0,500)
    : ""
  })).filter(s=>Number.isFinite(s.id));

  return { model: obj.model, steps };
}

// ---- Eventler ----
document.addEventListener('DOMContentLoaded', () => {
  ensureModal();
  closeModal(false);
  reflectPremiumUI();
  loadDataFiles();

  // Örnekleri Yükle
  if (els.loadSample) {
    els.loadSample.addEventListener('click', () => {
      const names = Object.keys(models);
      if (!names.length) return alert('Örnekler yüklenemedi. JSON dosyaları bulunamadı.');
      currentModel = names[0];
      els.modelSelect.value = currentModel;
      renderSteps();
      const first = computeFilteredOrder(currentModel)[0];
      if (first) showStep(first, 0);
    });
  }

  // Hash değişince aynı adıma git
  window.addEventListener('hashchange', ()=>{
    const {model, id} = getHash();
    if (!model || !models[model] || !Number.isFinite(id)) return;
    currentModel = model;
    if (els.modelSelect) els.modelSelect.value = model;
    renderSteps();
    const order = computeFilteredOrder(model);
    const idx = order.findIndex(s=>s.id===id);
    if (idx>=0) showStep(order[idx], idx);
  });
});

// Model değişimi
els.modelSelect.addEventListener('change', e=>{
  currentModel = e.target.value;
  renderSteps();
  const first = computeFilteredOrder(currentModel)[0];
  if (first) showStep(first, 0);
});

// İlerlemeyi sıfırla
els.resetProgress.addEventListener('click', ()=>{
  if(!currentModel) return;
  localStorage.removeItem(lsKey(currentModel));
  renderSteps();
});

// JSON yükleme
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

// Premium state dışarıdan değişirse UI'yı yansıt
window.addEventListener('storage', (e)=>{
  if(e.key===PREMIUM_KEY) reflectPremiumUI();
});

// URL ile premium açma (debug)
if (new URLSearchParams(location.search).get("unlock") === "1") {
  setPremium(true);
}

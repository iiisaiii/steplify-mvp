/* Steplify MVP — JSON'ları /data/ klasöründen otomatik yükler + freemium kilit */
console.log('Steplify app v2');
const FREE_LIMIT = 5;
const PREMIUM_KEY = "steplify_premium";   // localStorage anahtarı

function isPremium() {
  try { return localStorage.getItem(PREMIUM_KEY) === "1"; } catch(_) { return false; }
}
function setPremium(v) {
  localStorage.setItem(PREMIUM_KEY, v ? "1" : "0");
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

  return m;
}

function openModal(title, text) {
  if (!title && !text) return Promise.resolve(false);

  const m = ensureModal();
  m.style.display = 'flex';
  m.querySelector('#modalTitle').textContent = title || '';  // <-- eklendi
  m.querySelector('#modalText').textContent  = text  || '';

  return new Promise((resolve) => { _modalResolver = resolve; });
}


function closeModal(ok) {
  const m = document.getElementById('steplifyModal');
  if (!m) return;
  m.style.display = 'none';
  if (_modalResolver) { _modalResolver(!!ok); _modalResolver = null; }
}

// Sayfa açıldığında modalı sağlam kur ve kapalı başlat
document.addEventListener('DOMContentLoaded', () => {
  ensureModal();
  closeModal(false);
});


function getOrderedSteps(){ return computeOrder(models[currentModel] || []); }

function goToNextStep(currentStep){
  const order = getOrderedSteps();
  const i = order.findIndex(s => s.id === currentStep.id);
  const next = order[i+1];
  if(next){ showStep(next, i+1); }
}

function lsKey(model){ return `steplify_progress::${model}`; }
function getSelections(m){
  try { return JSON.parse(localStorage.getItem(selKey(m)) || '{}'); }
  catch(_) { return {}; }
}
function setSelections(m, obj){
  localStorage.setItem(selKey(m), JSON.stringify(obj || {}));
}
function getProgress(m){ try{ return JSON.parse(localStorage.getItem(lsKey(m))||'{}'); }catch(_){ return {}; } }
function setProgress(m, obj){ localStorage.setItem(lsKey(m), JSON.stringify(obj||{})); }

function renderModels(){
  els.modelSelect.innerHTML = '';
  const names = Object.keys(models);
  names.forEach(n=>{
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    els.modelSelect.appendChild(opt);
  });
  if(names.length){
    currentModel = names[0];
    els.modelSelect.value = currentModel;
    renderSteps();
  }
}

function computeOrder(steps){ return steps.slice().sort((a,b)=>a.id-b.id); }

function renderSteps(){
  const sels = getSelections(currentModel);
  const steps = (models[currentModel]||[]);
  els.sidebarTitle.textContent = `Adımlar — ${currentModel}`;
  els.stepsList.innerHTML = '';
  const order = computeOrder(steps);
  const progress = getProgress(currentModel);
  let doneCount = 0;

  order.forEach((s, idx)=>{
    const li = document.createElement('li');
    li.className = 'step';
    const locked = (idx >= FREE_LIMIT) && !isPremium();
    if(locked) li.classList.add('locked');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.disabled = locked;
    cb.checked = !!progress[s.id];
    if(cb.checked) doneCount++;
    cb.addEventListener('click',(e)=>{
      e.stopPropagation();
      const p = getProgress(currentModel);
      p[s.id] = !!e.target.checked;
      setProgress(currentModel, p);
      renderSteps();
    });

    const title = document.createElement('div');
    title.className = 'title'; title.textContent = `${s.id}. ${s.title}`;
    const meta = document.createElement('div');
    meta.className = 'meta'; meta.textContent = s.parentId ? `Üst adım: ${s.parentId}` : 'Kök adım';
    const chosen = sels[s.id];
    if (chosen) {
      meta.textContent += ` • Seçim: ${chosen}`;
    }

    const row = document.createElement('div');
    row.style.display='flex'; row.style.flexDirection='column';
    row.appendChild(title); row.appendChild(meta);

    li.appendChild(cb); li.appendChild(row);
    li.addEventListener('click', ()=> showStep(s, idx));
    els.stepsList.appendChild(li);
  });

  const pct = steps.length ? Math.round(doneCount/steps.length*100) : 0;
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
      if (sels[step.id] === o) {
        b.classList.add('selected');
      }

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

        // seçimi kaydet
        const _sels = getSelections(currentModel);
        _sels[step.id] = o;
        setSelections(currentModel, _sels);

        // adımı tamamlandı işaretle
        const p = getProgress(currentModel);
        p[step.id] = true;
        setProgress(currentModel, p);

        // UI tazele
        renderSteps();

        // sonraki adıma geç
        goToNextStep(step);
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
}




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
  if (isPremium()) {
  console.log("Premium aktif! UI güncelleniyor...");
  renderSteps();
  }
  // İlk açılışta bir kere Step 1 göster
  const first = computeOrder(models[currentModel] || [])[0];
  if (first) showStep(first, 0);
}

document.addEventListener('DOMContentLoaded', loadDataFiles);

els.modelSelect.addEventListener('change', e=>{ currentModel = e.target.value; renderSteps(); });
els.resetProgress.addEventListener('click', ()=>{ if(!currentModel) return; localStorage.removeItem(lsKey(currentModel)); renderSteps(); });
els.jsonInput.addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const obj = JSON.parse(reader.result);
      if(obj.model && Array.isArray(obj.steps)){ models[obj.model]=obj.steps; renderModels(); }
      else alert('Geçersiz JSON.');
    }catch(err){ alert('JSON okunamadı: '+err.message); }
  };
  reader.readAsText(file, 'utf-8');
});

// sayfanın en altına, DOMContentLoaded'dan hemen sonra
if (new URLSearchParams(location.search).get("unlock") === "1") {
  setPremium(true);
}


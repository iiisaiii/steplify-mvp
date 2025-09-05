/* Steplify MVP — JSON loader + freemium + branching (visibleIf) + modal info + next-visible-step + glossary */
console.log('Steplify app v4.1');

const FREE_LIMIT = 5;
const PREMIUM_KEY = "steplify_premium";   // localStorage anahtarı

function isPremium(){ try{ return localStorage.getItem(PREMIUM_KEY)==="1"; }catch(_){ return false; } }
function setPremium(v){ localStorage.setItem(PREMIUM_KEY, v ? "1" : "0"); reflectPremiumUI(); }

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

// Açıklama kısa metinleri (fallback)
const OPTION_TIPS = {};

// --------- Güvenli Modal (tek kopya) ----------
let _modalResolver = null;

function ensureModal() {
  let m = document.getElementById('steplifyModal');
  if (m) return m;

  m = document.createElement('div');
  m.id = 'steplifyModal';
  m.style.cssText = `position:fixed; inset:0; display:none; z-index:9999; align-items:center; justify-content:center;`;
  m.innerHTML = `
    <div class="modal-backdrop" style="position:absolute; inset:0; background:rgba(0,0,0,.45);"></div>
    <div class="modal-sheet" style="position:relative; background:#fff; border-radius:12px; padding:16px 18px; width:min(560px, 92vw); box-shadow:0 20px 60px rgba(0,0,0,.25);">
      <h3 id="modalTitle" style="margin:0 0 6px; font-size:18px;"></h3>
      <div id="modalText" style="margin:0 0 14px; color:#475569; white-space:pre-wrap;"></div>
      <div class="modal-actions" style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="modalCancel" class="btn small outline" type="button">Vazgeç</button>
        <button id="modalOk" class="btn small primary" type="button">Devam Et</button>
      </div>
    </div>`;
  const okBtn = m.querySelector('#modalOk');
  const cancelBtn = m.querySelector('#modalCancel');
  Object.assign(okBtn.style,{background:'#2563eb',color:'#fff',border:'1px solid #1e40af',padding:'8px 12px',borderRadius:'8px'});
  Object.assign(cancelBtn.style,{background:'#fff',color:'#111',border:'1px solid #cbd5e1',padding:'8px 12px',borderRadius:'8px'});

  document.body.appendChild(m);

  // Kapatma/Onay + kısayol
  const backdrop=m.querySelector('.modal-backdrop');
  backdrop.addEventListener('click',()=>closeModal(false));
  cancelBtn.addEventListener('click',()=>closeModal(false));
  okBtn.addEventListener('click',()=>closeModal(true));
  document.addEventListener('keydown',(ev)=>{
    if (m.style.display==='none') return;
    if (ev.key==='Escape') closeModal(false);
    if (ev.key==='Enter')  closeModal(true);
  });
  return m;
}
function openModal(title, htmlText){
  const m = ensureModal();
  m.style.display = 'flex';
  m.querySelector('#modalTitle').textContent = title || '';
  const box = m.querySelector('#modalText');
  box.innerHTML = htmlText || '';
  return new Promise(res => { _modalResolver = res; });
}
function closeModal(ok){
  const m = document.getElementById('steplifyModal');
  if (!m) return;
  m.style.display = 'none';
  if (_modalResolver){ _modalResolver(!!ok); _modalResolver=null; }
}

// ---- LocalStorage yardımcıları ----
function lsKey(model){ return `steplify_progress::${model}`; }
function selKey(model){ return `steplify_selection::${model}`; }

function getProgress(m){ try{ return JSON.parse(localStorage.getItem(lsKey(m))||'{}'); }catch(_){ return {}; } }
function setProgress(m,obj){ localStorage.setItem(lsKey(m), JSON.stringify(obj||{})); }

function getSelections(m){ try{ return JSON.parse(localStorage.getItem(selKey(m))||'{}'); }catch(_){ return {}; } }
function setSelections(m,obj){ localStorage.setItem(selKey(m), JSON.stringify(obj||{})); }

// ---- URL hash (derin link) ----
function setHash(model, stepId){ try{ location.hash = `${encodeURIComponent(model)}:${stepId}`; }catch(_){} }
function getHash(){
  const h=(location.hash||'').replace(/^#/, '');
  if(!h) return {model:null,id:null};
  const [m,idStr]=h.split(':'); const id=Number(idStr);
  return {model:decodeURIComponent(m||''), id:Number.isFinite(id)?id:null};
}

// ---- Görünürlük kuralları ----
// "step:1=Dijital Ürünler" | "step:6=ClickBank|Digistore24" | "step:1!=Fiziksel"
// AND: "," veya "AND",  OR: "||" veya "OR"
const norm = s => String(s||'').trim().toLowerCase();
function evalAtom(token, sels){
  token = token.trim();
  let negate=false;
  if (token.startsWith('!')){ negate=true; token=token.slice(1).trim(); }
  const m = token.match(/^step\s*:\s*(\d+)\s*(!?=)\s*(.+)$/i);
  if (!m) return true; // tanınmayan ifade bozmasın
  const stepId = Number(m[1]);
  const op = m[2];
  const values = m[3].split('|').map(v=>norm(v));
  const chosen = norm(sels[stepId]);
  const hit = values.includes(chosen);
  let ok = (op==='=') ? hit : !hit;
  if (negate) ok = !ok;
  return ok;
}
function evaluateVisibility(rule, sels){
  if (!rule || !String(rule).trim()) return true;
  const orParts = String(rule).split(/\s*\|\|\s*|\s+\bOR\b\s+/i);
  for (const orp of orParts){
    const andParts = orp.split(/\s*,\s*|\s+\bAND\b\s+/i);
    let all = true;
    for (const p of andParts){
      if (!evalAtom(p, sels)){ all=false; break; }
    }
    if (all) return true;
  }
  return false;
}

function computeOrder(steps){ return steps.slice().sort((a,b)=>a.id-b.id); }
function getVisibleOrderedSteps(){
  const steps = models[currentModel] || [];
  const order = computeOrder(steps);
  const sels = getSelections(currentModel);
  return order.filter(s => evaluateVisibility(s.visibleIf, sels));
}

function reflectPremiumUI(){ const on=isPremium(); if (els.premiumBtn) els.premiumBtn.style.display = on ? 'none' : ''; }

function markActive(stepId){
  [...els.stepsList.querySelectorAll('.step')].forEach(li=>li.classList.remove('active'));
  const order = getVisibleOrderedSteps();
  const idx = order.findIndex(s=>s.id===stepId);
  const items = [...els.stepsList.querySelectorAll('.step')];
  if (idx>=0 && items[idx]) items[idx].classList.add('active');
}

/* --------- TERİMLER (Glossary) yardımcıları --------- */
// Şekil 1: object  { "Shopify": "barındırılan..." }
// Şekil 2: string  "Shopify: ... || WooCommerce: ..."
// Şekil 3: array   ["Shopify: ...", "Woo: ..."]
function normalizeGlossary(gl){
  if (!gl) return [];
  // Objeyse
  if (typeof gl === 'object' && !Array.isArray(gl)){
    return Object.keys(gl).map(k=>({ term:String(k), desc:String(gl[k]||'') })).filter(x=>x.term.trim());
  }
  // Diziyse
  if (Array.isArray(gl)){
    const out=[];
    gl.forEach(item=>{
      if (item==null) return;
      const s=String(item);
      const i=s.indexOf(':');
      if (i>=0) out.push({term:s.slice(0,i).trim(), desc:s.slice(i+1).trim()});
      else out.push({term:s.trim(), desc:''});
    });
    return out.filter(x=>x.term);
  }
  // Dizeyse: "A: ... || B: ..."
  const s = String(gl);
  const segs = s.split('||').map(x=>x.trim()).filter(Boolean);
  const out=[];
  segs.forEach(seg=>{
    const i = seg.indexOf(':');
    if (i>=0) out.push({term:seg.slice(0,i).trim(), desc:seg.slice(i+1).trim()});
    else out.push({term:seg.trim(), desc:''});
  });
  return out.filter(x=>x.term);
}
function renderGlossaryCard(step){
  const entries = normalizeGlossary(step.glossary || step['Terimler']);
  if (!entries.length) return null;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginTop = '12px';

  const title = document.createElement('h3');
  title.textContent = 'Terimler';
  title.style.marginTop = '0';
  title.style.marginBottom = '8px';
  card.appendChild(title);

  const list = document.createElement('dl');
  list.style.display='grid';
  list.style.gridTemplateColumns='max-content 1fr';
  list.style.columnGap='12px';
  list.style.rowGap='8px';
  list.style.margin='0';

  entries.forEach(({term, desc})=>{
    const dt=document.createElement('dt');
    dt.style.fontWeight='600';
    dt.style.margin='0';
    dt.textContent = term;

    const dd=document.createElement('dd');
    dd.style.margin='0';
    dd.style.color='#475569';
    dd.textContent = desc || '—';

    list.appendChild(dt);
    list.appendChild(dd);
  });

  card.appendChild(list);
  return card;
}

// ---- Render ----
function renderModels(){
  els.modelSelect.innerHTML = '';
  const names = Object.keys(models);
  names.forEach(n=>{
    const opt=document.createElement('option'); opt.value=n; opt.textContent=n; els.modelSelect.appendChild(opt);
  });

  if (names.length){
    const {model,id} = getHash();
    currentModel = (model && models[model]) ? model : names[0];
    els.modelSelect.value = currentModel;
    renderSteps();

    const vis = getVisibleOrderedSteps();
    const first = vis[0];
    if (id){
      const idx = vis.findIndex(s=>s.id===id);
      if (idx>=0) showStep(vis[idx], idx);
      else if (first) showStep(first, 0);
    } else if (first){
      showStep(first, 0);
    }
  } else {
    currentModel = null;
  }
}

function renderSteps(){
  if (!currentModel || !models[currentModel] || !Array.isArray(models[currentModel]) || models[currentModel].length===0){
    els.sidebarTitle.textContent='Adımlar';
    els.stepsList.innerHTML=''; els.linksList.innerHTML=''; els.progressBar.style.width='0%'; els.progressBar.title='0% tamamlandı'; return;
  }

  const progress = getProgress(currentModel);
  const sels = getSelections(currentModel);
  const order = getVisibleOrderedSteps();

  els.sidebarTitle.textContent = `Adımlar — ${currentModel}`;
  els.stepsList.innerHTML = '';

  let doneCount = 0;

  order.forEach((s, idx)=>{
    const li=document.createElement('li'); li.className='step';

    const locked = (idx >= FREE_LIMIT) && !isPremium();
    if (locked) li.classList.add('locked');

    const cb=document.createElement('input'); cb.type='checkbox'; cb.disabled = locked; cb.checked = !!progress[s.id];
    if (cb.checked) doneCount++;

    cb.addEventListener('click',(e)=>{
      e.stopPropagation();
      const p = getProgress(currentModel); p[s.id] = !!e.target.checked; setProgress(currentModel,p);
      renderSteps();
    });

    const title=document.createElement('div'); title.className='title'; title.textContent = `${s.id}. ${s.title}`;
    const meta=document.createElement('div'); meta.className='meta';
    meta.textContent = s.parentId ? `Üst adım: ${s.parentId}` : 'Kök adım';
    const chosen = sels[s.id];
    if (chosen) meta.textContent += ` • Seçim: ${chosen}`;

    const row=document.createElement('div'); row.style.display='flex'; row.style.flexDirection='column';
    row.appendChild(title); row.appendChild(meta);

    li.appendChild(cb); li.appendChild(row);
    li.addEventListener('click',()=>showStep(s, idx));
    els.stepsList.appendChild(li);
  });

  const pct = order.length ? Math.round((doneCount / order.length) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.title = `${pct}% tamamlandı`;
}

function nextVisibleAfter(stepId){
  const order = getVisibleOrderedSteps();
  const i = order.findIndex(s=>s.id===stepId);
  return (i>=0) ? {next: order[i+1], nextIdx: i+1} : {next:null, nextIdx:-1};
}

function showStep(step, index){
  // Adım görünür değilse, ilk görünür adıma atla
  const vis = getVisibleOrderedSteps();
  if (!vis.some(s=>s.id===step.id)){
    const first = vis[0]; if (first) return showStep(first, 0); else return;
  }

  els.stepView.innerHTML = '';
  const h=document.createElement('h2'); h.textContent = `${step.id}. ${step.title}`;
  const d=document.createElement('p'); d.textContent = step.description || 'Açıklama yok.';
  els.stepView.appendChild(h); els.stepView.appendChild(d);

  // --- Terimler kartı (varsa) ---
  const glossaryCard = renderGlossaryCard(step);
  if (glossaryCard) els.stepView.appendChild(glossaryCard);

  const sels = getSelections(currentModel);
  if (sels[step.id]){
    const info=document.createElement('div'); info.className='muted'; info.style.marginTop='4px'; info.textContent=`Seçimin: ${sels[step.id]}`;
    els.stepView.appendChild(info);
  }

  const locked = (index >= FREE_LIMIT) && !isPremium();

  // Seçenek butonları
  const options = Array.isArray(step.options) ? step.options : [];
  if (options.length){
    const optionsWrap=document.createElement('div'); optionsWrap.className='options';
    options.forEach(label=>{
      const b=document.createElement('button'); b.className='btn option-btn'; b.textContent = label; b.dataset.option=label;
      if (sels[step.id] === label) b.classList.add('selected');
      if (locked) b.disabled = true;

      b.addEventListener('click', async ()=>{
        if (locked) return;

        // modal içeriğini optionDetails'tan üret
        let modalHtml = '';
        const od = (step.optionDetails && step.optionDetails[label]) || null;
        if (od){
          const p = (arr)=> arr && arr.length ? `<ul style="margin:.4rem 0 .2rem 1rem;">${arr.map(x=>`<li>${x}</li>`).join('')}</ul>` : '<span class="muted">–</span>';
          modalHtml =
            `<div style="line-height:1.5">
              <div><b>Bilgi:</b> ${od.info || '<span class="muted">–</span>'}</div>
              <div style="margin-top:.5rem"><b>Artılar:</b> ${p(od.pros)}</div>
              <div style="margin-top:.3rem"><b>Eksiler:</b> ${p(od.cons)}</div>
            </div>`;
        }else{
          const tip = (OPTION_TIPS[step.title] && OPTION_TIPS[step.title][label]) || `${label} ile devam edilsin mi?`;
          modalHtml = tip;
        }

        const ok = await openModal(label, modalHtml);
        if (!ok) return;

        // seçimi & ilerlemeyi kaydet
        const _sels = getSelections(currentModel); _sels[step.id] = label; setSelections(currentModel, _sels);
        const p = getProgress(currentModel); p[step.id] = true; setProgress(currentModel, p);

        // görünür listeyi güncelle ve bir sonraki GÖRÜNÜR adıma geç
        renderSteps();
        const {next, nextIdx} = nextVisibleAfter(step.id);
        if (next) showStep(next, nextIdx);
      });

      optionsWrap.appendChild(b);
    });
    els.stepView.appendChild(optionsWrap);
  } else {
    // Opsiyon yoksa içerikten ilerleme butonu
    if (!locked){
      const wrap=document.createElement('div');
      wrap.style.marginTop='12px';
      wrap.innerHTML = `<button id="finishStep" class="btn small primary">Adımı Tamamla → Sonraki</button>`;
      els.stepView.appendChild(wrap);
      wrap.querySelector('#finishStep').addEventListener('click', ()=>{
        const p = getProgress(currentModel); p[step.id] = true; setProgress(currentModel, p);
        renderSteps();
        const {next, nextIdx} = nextVisibleAfter(step.id);
        if (next) showStep(next, nextIdx);
      });
    }
  }

  // Sağdaki "Kaynaklar"
  els.linksList.innerHTML = '';
  (step.links || []).forEach(u=>{
    const val = String(u||'').trim();
    if (!val || val==='-' || val==='—' || val==='–') return;
    const li=document.createElement('li');
    if (/^https?:\/\//i.test(val)){
      const a=document.createElement('a'); a.href=val; a.target='_blank'; a.rel='noopener'; a.textContent=val; li.appendChild(a);
    }else{
      li.textContent = val;
    }
    els.linksList.appendChild(li);
  });

  // Kilit kartı
  if (locked){
    const lock=document.createElement('div'); lock.className='card'; lock.style.marginTop='12px'; lock.style.background='#fff7ed'; lock.style.borderColor='#fdba74';
    lock.innerHTML = `<b>Premium Kilit</b><br/>Bu adımı görmek için Premium'a geç.
      <div style="margin-top:8px"><a id="buyPremium" class="btn small primary" href="/premium.html">Premium'a Geç</a></div>`;
    els.stepView.appendChild(lock);
  }

  // Aktif adımı işaretle ve hash'i güncelle
  markActive(step.id);
  setHash(currentModel, step.id);
}

// ---- Veri yükleme ----
async function loadDataFiles(){
  for (const f of DATA_FILES){
    try{
      const res = await fetch(f.path, {cache:'no-store'});
      if (!res.ok) continue;
      const obj = await res.json();
      if (obj && obj.model && Array.isArray(obj.steps)){ models[obj.model] = obj.steps; }
    }catch(_){}
  }
  renderModels();
  reflectPremiumUI();
  if (isPremium()){ console.log("Premium aktif! UI güncelleniyor..."); renderSteps(); }
}

// ---- JSON güvenliği (sanitize) ----
function sanitizePlan(obj){
  if (!obj || typeof obj!=='object') return null;
  if (typeof obj.model!=='string' || obj.model.length>60) return null;
  if (!Array.isArray(obj.steps) || obj.steps.length>1000) return null;
  const steps = obj.steps.map(s=>({
    id: Number(s.id),
    title: String(s.title||'').slice(0,200),
    description: String(s.description||'').slice(0,4000),
    parentId: s.parentId!=null ? Number(s.parentId) : null,
    options: Array.isArray(s.options) ? s.options.map(o=>String(o).slice(0,200)).slice(0,20) : [],
    links: Array.isArray(s.links) ? s.links.map(u=>String(u).slice(0,500)).slice(0,20) : [],
    visibleIf: typeof s.visibleIf==='string' ? s.visibleIf.slice(0,1000)
            : (typeof s['GörünürEğer']==='string' ? s['GörünürEğer'].slice(0,1000) : undefined),
    optionDetails: (s.optionDetails && typeof s.optionDetails==='object') ? s.optionDetails : {},
    glossary: (s.glossary && typeof s.glossary==='object') ? s.glossary
            : (typeof s['Terimler']==='string' || Array.isArray(s['Terimler']) ? s['Terimler'] : {}),
  })).filter(s=>Number.isFinite(s.id));
  return { model: obj.model, steps };
}

// ---- Eventler ----
document.addEventListener('DOMContentLoaded', ()=>{
  ensureModal(); closeModal(false); reflectPremiumUI(); loadDataFiles();

  if (els.loadSample){
    els.loadSample.addEventListener('click', ()=>{
      const names = Object.keys(models); if (!names.length) return alert('Örnekler yüklenemedi. JSON dosyaları bulunamadı.');
      currentModel = names[0]; els.modelSelect.value = currentModel; renderSteps();
      const vis = getVisibleOrderedSteps(); if (vis[0]) showStep(vis[0], 0);
    });
  }

  // Hash değişince ilgili görünür adıma git
  window.addEventListener('hashchange', ()=>{
    const {model,id} = getHash(); if (!model || !models[model] || !Number.isFinite(id)) return;
    currentModel = model; if (els.modelSelect) els.modelSelect.value = model; renderSteps();
    const vis = getVisibleOrderedSteps(); const idx = vis.findIndex(s=>s.id===id); if (idx>=0) showStep(vis[idx], idx);
  });
});

// Model değişimi
els.modelSelect.addEventListener('change', e=>{
  currentModel = e.target.value; renderSteps();
  const vis = getVisibleOrderedSteps(); if (vis[0]) showStep(vis[0], 0);
});

// İlerlemeyi sıfırla (seçimler dahil)
els.resetProgress.addEventListener('click', ()=>{
  if(!currentModel) return; localStorage.removeItem(lsKey(currentModel)); localStorage.removeItem(selKey(currentModel)); renderSteps();
});

// JSON yükleme
els.jsonInput.addEventListener('change', (e)=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const raw=JSON.parse(reader.result); const obj=sanitizePlan(raw);
      if(obj){ models[obj.model]=obj.steps; renderModels(); }
      else alert('Geçersiz/çok büyük JSON.');
    }catch(err){ alert('JSON okunamadı: '+err.message); }
  };
  reader.readAsText(file, 'utf-8');
});

// Premium state dışarıdan değişirse UI'yı yansıt
window.addEventListener('storage',(e)=>{ if(e.key===PREMIUM_KEY) reflectPremiumUI(); });

// URL ile premium açma (debug)
if (new URLSearchParams(location.search).get("unlock")==="1"){ setPremium(true); }

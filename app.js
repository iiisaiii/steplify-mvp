/* Steplify MVP — static checklist with freemium lock */
const FREE_LIMIT = 5;

let models = {};
let currentModel = null;

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

function lsKey(model){ return `steplify_progress::${model}`; }
function getProgress(model){ try{ return JSON.parse(localStorage.getItem(lsKey(model))||'{}'); }catch(_){ return {}; } }
function setProgress(model, obj){ localStorage.setItem(lsKey(model), JSON.stringify(obj||{})); }

function renderModels(){
  els.modelSelect.innerHTML = '';
  const names = Object.keys(models);
  names.forEach(n=>{
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    els.modelSelect.appendChild(opt);
  });
  if(names.length){ currentModel = names[0]; els.modelSelect.value = currentModel; renderSteps(); }
}

function computeOrder(steps){ return steps.slice().sort((a,b)=>a.id-b.id); }

function renderSteps(){
  const steps = (models[currentModel]||[]);
  els.sidebarTitle.textContent = `Adımlar — ${currentModel}`;
  els.stepsList.innerHTML = '';
  const order = computeOrder(steps);
  const progress = getProgress(currentModel);
  let doneCount = 0;

  order.forEach((s, idx)=>{
    const li = document.createElement('li');
    li.className = 'step';
    const locked = idx >= FREE_LIMIT;
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
    const row = document.createElement('div'); row.style.display='flex';row.style.flexDirection='column';
    row.appendChild(title); row.appendChild(meta);
    li.appendChild(cb); li.appendChild(row);
    li.addEventListener('click', ()=> showStep(s, idx));
    els.stepsList.appendChild(li);
  });

  const pct = steps.length ? Math.round(doneCount/steps.length*100) : 0;
  els.progressBar.style.width = `${pct}%`; els.progressBar.title = `${pct}% tamamlandı`;
  if(order.length){ showStep(order[0], 0); }
}

function showStep(step, index){
  els.stepView.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = `${step.id}. ${step.title}`;
  const d = document.createElement('p'); d.textContent = step.description || 'Açıklama yok.';
  els.stepView.appendChild(h); els.stepView.appendChild(d);

  if(step.options && step.options.length){
    const optWrap = document.createElement('div'); optWrap.style.marginTop='8px';
    const lbl = document.createElement('div'); lbl.textContent='Seçenekler:'; optWrap.appendChild(lbl);
    const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='8px'; btns.style.flexWrap='wrap';
    step.options.forEach(o=>{
      const b = document.createElement('button'); b.className='btn small outline'; b.textContent=o;
      b.addEventListener('click', ()=> alert(`Seçildi: ${o} (MVP)`));
      btns.appendChild(b);
    });
    optWrap.appendChild(btns); els.stepView.appendChild(optWrap);
  }

  els.linksList.innerHTML = '';
  (step.links||[]).forEach(u=>{
    const li = document.createElement('li');
    const a = document.createElement('a'); a.href=u; a.target='_blank'; a.rel='noopener'; a.textContent=u;
    li.appendChild(a); els.linksList.appendChild(li);
  });

  if(index >= FREE_LIMIT){
    const lock = document.createElement('div'); lock.className='card'; lock.style.marginTop='12px'; lock.style.background='#fff7ed'; lock.style.borderColor='#fdba74';
    lock.innerHTML = `<b>Premium Kilit</b><br/>Bu adımı görmek için Premium'a geç (`+
      `<a href="#" target="_blank" rel="noopener">Tek Model 99 TL</a> / `+
      `<a href="#" target="_blank" rel="noopener">Tümü 299 TL</a>).`;
    els.stepView.appendChild(lock);
  }
}

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

document.addEventListener('DOMContentLoaded', ()=>{
  const affiliate = {
    model:"Affiliate",
    steps:[
      {id:1,parentId:0,title:"İş Modeli Seç",description:"Affiliate ile başlıyoruz.",options:["Dijital","Fiziksel"],links:[]},
      {id:2,parentId:1,title:"Platform Seç",description:"ClickBank / Digistore24 vb.",options:["Free","Paid"],links:["https://www.clickbank.com/"]},
      {id:3,parentId:2,title:"Ürün Araştırma",description:"TikTok trendleri, Reddit, YouTube.",options:["Free"],links:["https://ads.tiktok.com/business/creativecenter"]},
      {id:4,parentId:3,title:"Rakip Analizi",description:"Kim nasıl tanıtıyor?",options:[],links:[]},
      {id:5,parentId:4,title:"Kanal Seçimi",description:"TikTok / YouTube / Blog / Email",options:["TikTok","YouTube","Blog"],links:[]},
      {id:6,parentId:5,title:"İçerik Planı",description:"İlk 7 gün için plan.",options:[],links:[]},
      {id:7,parentId:6,title:"İlk Yayın",description:"İlk postları at.",options:[],links:[]}
    ]
  };
  models = {Affiliate:affiliate.steps};
  renderModels();
});

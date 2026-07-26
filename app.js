'use strict';

const CONFIG = window.LIWA77_CONFIG || {};
const COLLECTIONS = ['harvest','trees','maintenance','irrigation','tasks','expenses','inventory'];
const CACHE_KEY = `liwa77-cache-${CONFIG.farmId || 'liwa77'}`;
const SESSION_KEY = `liwa77-worker-${CONFIG.farmId || 'liwa77'}`;
const cloudConfigured = /^https:\/\//.test(CONFIG.supabaseUrl || '') && !String(CONFIG.supabaseUrl).includes('PASTE_') && String(CONFIG.supabaseAnonKey || '').length > 40 && !String(CONFIG.supabaseAnonKey).includes('PASTE_');
let client = null;
let workerName = localStorage.getItem(SESSION_KEY) || '';
let state = loadCache();
let syncState = cloudConfigured ? 'connecting' : 'local';

const dateFmt = new Intl.DateTimeFormat('ar-AE',{day:'2-digit',month:'short',year:'numeric'});
const numberFmt = new Intl.NumberFormat('ar-AE',{maximumFractionDigits:1});
const moneyFmt = new Intl.NumberFormat('ar-AE',{style:'currency',currency:'AED',maximumFractionDigits:2});

const configs = {
  harvest:{form:'harvestForm',table:'harvestTable',count:'harvestCountText',label:'سجل الحصاد',columns:[x=>fmtDate(x.date),x=>x.variety,x=>x.zone||'—',x=>`${num(x.quantity)} كجم`,x=>badge(x.grade),x=>x.recordedBy||'—']},
  trees:{form:'treesForm',table:'treesTable',count:'treesCountText',label:'مجموعة الأشجار',columns:[x=>x.variety,x=>x.zone||'—',x=>num(x.count),x=>x.plantingYear||'—',x=>badge(x.health),x=>x.recordedBy||'—']},
  maintenance:{form:'maintenanceForm',table:'maintenanceTable',count:'maintenanceCountText',label:'سجل الصيانة',columns:[x=>fmtDate(x.date),x=>x.type,x=>x.zone||'—',x=>badge(x.status),x=>x.nextDue?fmtDate(x.nextDue):'—',x=>x.recordedBy||'—']},
  irrigation:{form:'irrigationForm',table:'irrigationTable',count:'irrigationCountText',label:'سجل الري',columns:[x=>fmtDate(x.date),x=>x.zone||'—',x=>`${num(x.duration)} دقيقة`,x=>x.litres?`${num(x.litres)} لتر`:'—',x=>badge(x.status),x=>x.recordedBy||'—']},
  tasks:{form:'tasksForm',table:'tasksTable',count:'tasksCountText',label:'المهمة',columns:[x=>fmtDate(x.dueDate),x=>x.title,x=>badge(x.priority),x=>x.assignedTo||'—',x=>badge(x.status),x=>x.recordedBy||'—']},
  expenses:{form:'expensesForm',table:'expensesTable',count:'expensesCountText',label:'المصروف',columns:[x=>fmtDate(x.date),x=>x.category,x=>x.description,x=>x.supplier||'—',x=>money(x.amount),x=>x.recordedBy||'—']},
  inventory:{form:'inventoryForm',table:'inventoryTable',count:'inventoryCountText',label:'مادة المخزون',columns:[x=>x.item,x=>x.category,x=>`${num(x.quantity)} ${x.unit||''}`,x=>x.minimumLevel?`${num(x.minimumLevel)} ${x.unit||''}`:'—',x=>x.location||'—',x=>x.recordedBy||'—']}
};

document.addEventListener('DOMContentLoaded', init);

async function init(){
  document.getElementById('farmNameSide').textContent=CONFIG.farmName||'مزرعة ليوا 77';
  document.getElementById('todayText').textContent=dateFmt.format(new Date());
  bindLogin(); bindNavigation(); bindForms(); bindActions(); setDefaultDates(); renderAll();
  if(workerName) openApp();
  if(cloudConfigured){
    try{
      client=window.supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabaseAnonKey,{auth:{persistSession:false}});
      await loadCloud(); subscribeRealtime(); setSync('online');
    }catch(error){console.error(error);setSync('offline');showToast('تعذر الاتصال بالسحابة؛ تظهر آخر نسخة محفوظة');}
  }else{
    document.getElementById('setupBanner').hidden=false; setSync('local');
  }
}

function emptyState(){return Object.fromEntries(COLLECTIONS.map(k=>[k,[]]));}
function loadCache(){try{return {...emptyState(),...(JSON.parse(localStorage.getItem(CACHE_KEY))||{})};}catch{return emptyState();}}
function saveCache(){localStorage.setItem(CACHE_KEY,JSON.stringify(state));}
function uuid(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;}

function bindLogin(){
  document.getElementById('loginForm').addEventListener('submit',e=>{
    e.preventDefault(); const data=Object.fromEntries(new FormData(e.currentTarget));
    if(String(data.pin)!==String(CONFIG.accessPin||'')){document.getElementById('loginMessage').textContent='رمز المزرعة غير صحيح.';return;}
    workerName=String(data.workerName).trim(); localStorage.setItem(SESSION_KEY,workerName); openApp();
  });
  document.getElementById('logoutButton').addEventListener('click',()=>{localStorage.removeItem(SESSION_KEY);workerName='';document.getElementById('loginScreen').classList.remove('hidden');document.getElementById('loginForm').reset();});
}
function openApp(){document.getElementById('loginScreen').classList.add('hidden');document.getElementById('workerNameText').textContent=workerName;}

function bindNavigation(){
  const sidebar=document.getElementById('sidebar');
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{showSection(btn.dataset.section);sidebar.classList.remove('open');}));
  document.getElementById('menuButton').addEventListener('click',()=>sidebar.classList.toggle('open'));
}
function showSection(id){document.querySelectorAll('.page-section').forEach(s=>s.classList.toggle('active',s.id===id));document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.section===id));document.getElementById('pageTitle').textContent=document.querySelector(`[data-section="${id}"]`)?.textContent||'لوحة التحكم';window.scrollTo({top:0,behavior:'smooth'});}

function bindForms(){
  Object.entries(configs).forEach(([type,cfg])=>{
    const form=document.getElementById(cfg.form);
    form.addEventListener('submit',async e=>{
      e.preventDefault(); const fd=Object.fromEntries(new FormData(form)); const editing=fd.id; delete fd.id;
      const old=editing?state[type].find(x=>x.id===editing):null;
      const record={...old,...fd,id:editing||uuid(),recordedBy:old?.recordedBy||workerName,updatedAt:new Date().toISOString(),createdAt:old?.createdAt||new Date().toISOString()};
      upsertLocal(type,record); renderAll(); resetForm(type); showToast('جاري الحفظ...');
      const ok=await upsertCloud(type,record); showToast(ok?'تم الحفظ والمزامنة':'تم الحفظ على هذا الجهاز فقط');
    });
    form.querySelector('.cancel-edit').addEventListener('click',()=>resetForm(type));
  });
}
function bindActions(){
  document.querySelectorAll('[data-search]').forEach(inp=>inp.addEventListener('input',()=>renderTable(inp.dataset.search,inp.value)));
  document.getElementById('syncButton').addEventListener('click',async()=>{if(cloudConfigured){await loadCloud();showToast('تم تحديث البيانات');}else showToast('الربط السحابي غير مفعّل');});
  document.getElementById('exportBackup').addEventListener('click',exportBackup);
  document.getElementById('exportCsv').addEventListener('click',exportCsv);
  document.getElementById('importBackup').addEventListener('change',importBackup);
  window.addEventListener('online',()=>cloudConfigured&&loadCloud());
  window.addEventListener('offline',()=>setSync('offline'));
}
function setDefaultDates(){const today=isoDate(new Date());document.querySelectorAll('input[type="date"]').forEach(i=>{if(!i.value&&['date','dueDate'].includes(i.name))i.value=today;});}
function resetForm(type){const form=document.getElementById(configs[type].form);form.reset();form.elements.id.value='';form.querySelector('.cancel-edit').classList.remove('visible');setDefaultDates();}
function upsertLocal(type,record){const i=state[type].findIndex(x=>x.id===record.id);if(i>=0)state[type][i]=record;else state[type].unshift(record);saveCache();}

async function loadCloud(){
  if(!client)return false; setSync('connecting');
  const {data,error}=await client.from('farm_records').select('*').eq('farm_id',CONFIG.farmId).order('updated_at',{ascending:false});
  if(error){setSync('offline');throw error;}
  const next=emptyState();
  for(const row of data||[]){if(next[row.category])next[row.category].push({...row.record_data,id:row.id,recordedBy:row.recorded_by||row.record_data?.recordedBy,createdAt:row.created_at,updatedAt:row.updated_at});}
  state=next;saveCache();renderAll();setSync('online');return true;
}
async function upsertCloud(type,record){
  if(!client)return false;
  const payload={id:record.id,farm_id:CONFIG.farmId,category:type,record_data:record,recorded_by:record.recordedBy,record_date:record.date||record.dueDate||null,updated_at:new Date().toISOString()};
  const {error}=await client.from('farm_records').upsert(payload,{onConflict:'id'});
  if(error){console.error(error);setSync('offline');return false;}setSync('online');return true;
}
async function deleteCloud(type,id){if(!client)return false;const {error}=await client.from('farm_records').delete().eq('id',id).eq('farm_id',CONFIG.farmId).eq('category',type);if(error){console.error(error);return false;}return true;}
function subscribeRealtime(){
  client.channel(`farm-${CONFIG.farmId}`).on('postgres_changes',{event:'*',schema:'public',table:'farm_records',filter:`farm_id=eq.${CONFIG.farmId}`},()=>loadCloud().catch(console.error)).subscribe();
}
function setSync(mode){syncState=mode;const dot=document.getElementById('syncDot'),text=document.getElementById('syncText');dot.className='status-dot';if(mode==='online'){dot.classList.add('online');text.textContent='متصل ومزامن';}else if(mode==='offline'){dot.classList.add('offline');text.textContent='غير متصل';}else if(mode==='local'){text.textContent='حفظ محلي فقط';}else{text.textContent='جاري الاتصال...';}renderConnection();}

function renderAll(){COLLECTIONS.forEach(t=>renderTable(t));renderDashboard();renderReports();renderConnection();}
function renderTable(type,query=''){
  const cfg=configs[type],tbody=document.querySelector(`#${cfg.table} tbody`),q=query.trim().toLowerCase();
  const rows=state[type].filter(x=>!q||Object.values(x).some(v=>String(v??'').toLowerCase().includes(q)));
  document.getElementById(cfg.count).textContent=`${numberFmt.format(state[type].length)} سجل`;
  if(!rows.length){tbody.innerHTML='<tr><td colspan="7" class="no-data">لا توجد سجلات.</td></tr>';return;}
  tbody.innerHTML=rows.map(x=>`<tr>${cfg.columns.map(fn=>`<td>${safeCell(fn(x))}</td>`).join('')}<td class="table-actions"><button class="icon-action" data-edit="${type}" data-id="${x.id}">تعديل</button><button class="icon-action delete" data-delete="${type}" data-id="${x.id}">حذف</button></td></tr>`).join('');
  tbody.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>editRecord(b.dataset.edit,b.dataset.id)));
  tbody.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>removeRecord(b.dataset.delete,b.dataset.id)));
}
function safeCell(value){return typeof value==='string'&&value.startsWith('<span class="badge')?value:escapeHtml(value);}
function editRecord(type,id){const record=state[type].find(x=>x.id===id),form=document.getElementById(configs[type].form);if(!record)return;Object.entries(record).forEach(([k,v])=>{if(form.elements[k])form.elements[k].value=v??'';});form.elements.id.value=id;form.querySelector('.cancel-edit').classList.add('visible');showSection(type);form.scrollIntoView({behavior:'smooth',block:'start'});}
async function removeRecord(type,id){if(!confirm('هل تريد حذف هذا السجل؟'))return;state[type]=state[type].filter(x=>x.id!==id);saveCache();renderAll();const ok=await deleteCloud(type,id);showToast(ok||!cloudConfigured?'تم حذف السجل':'حُذف محلياً وتعذر حذفه من السحابة');}

function renderDashboard(){
  const month=isoDate(new Date()).slice(0,7),h=state.harvest.filter(x=>x.date?.startsWith(month)),e=state.expenses.filter(x=>x.date?.startsWith(month));
  const due=state.maintenance.filter(x=>x.nextDue&&daysFromToday(x.nextDue)<=14&&x.status!=='مكتمل').length;
  const open=state.tasks.filter(x=>x.status!=='مكتمل');
  const low=state.inventory.filter(x=>Number(x.minimumLevel||0)>0&&Number(x.quantity||0)<=Number(x.minimumLevel||0)).length;
  setText('statTrees',num(sum(state.trees,'count')));setText('statHarvest',`${num(sum(h,'quantity'))} كجم`);setText('statHarvestRevenue',money(sum(h,'revenue')));setText('statMaintenance',num(due));setText('statTasks',num(open.length));setText('statUrgentTasks',`${num(open.filter(x=>x.priority==='عالية').length)} عالية الأولوية`);setText('statExpenses',money(sum(e,'amount')));setText('statLowStock',num(low));
  const upcoming=[...open.map(x=>({date:x.dueDate,title:x.title,meta:`مهمة · ${x.assignedTo||'غير محدد'} · ${x.priority}`})),...state.maintenance.filter(x=>x.nextDue&&x.status!=='مكتمل').map(x=>({date:x.nextDue,title:x.type,meta:`صيانة · ${x.zone}`}))].filter(x=>x.date).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,7);
  renderActivity('upcomingList',upcoming.map(x=>({title:x.title,meta:`${fmtDate(x.date)} · ${x.meta}`})),'لا توجد أعمال قادمة.');
  const recent=[];COLLECTIONS.forEach(type=>state[type].forEach(x=>recent.push({at:x.updatedAt||x.createdAt||x.date||x.dueDate,title:activityTitle(type,x),meta:`${x.recordedBy||'غير معروف'} · ${typeLabel(type)}`})));
  recent.sort((a,b)=>String(b.at).localeCompare(String(a.at)));renderActivity('recentActivity',recent.slice(0,8),'لا توجد سجلات حتى الآن.');
}
function renderActivity(id,items,empty){const el=document.getElementById(id);if(!items.length){el.className='activity-list empty-state';el.textContent=empty;return;}el.className='activity-list';el.innerHTML=items.map(x=>`<div class="activity-item"><span class="activity-dot"></span><div><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.meta)}</span></div></div>`).join('');}
function activityTitle(type,x){return({harvest:`حصاد ${num(x.quantity)} كجم من ${x.variety}`,trees:`تسجيل ${num(x.count)} شجرة ${x.variety}`,maintenance:x.type,irrigation:`ري ${x.zone}`,tasks:x.title,expenses:`مصروف ${money(x.amount)}`,inventory:`تحديث مخزون ${x.item}`})[type]||'سجل جديد';}
function typeLabel(t){return({harvest:'الحصاد',trees:'الأشجار',maintenance:'الصيانة',irrigation:'الري',tasks:'المهام',expenses:'المصروفات',inventory:'المخزون'})[t]||t;}
function renderReports(){const totalCost=sum(state.expenses,'amount')+sum(state.maintenance,'cost'),totalRevenue=sum(state.harvest,'revenue');const items=[['إجمالي الأشجار',num(sum(state.trees,'count'))],['إجمالي الحصاد',`${num(sum(state.harvest,'quantity'))} كجم`],['إيرادات الحصاد',money(totalRevenue)],['التكاليف المسجلة',money(totalCost)],['صافي القيمة المسجلة',money(totalRevenue-totalCost)],['المياه المسجلة',`${num(sum(state.irrigation,'litres'))} لتر`],['المهام المفتوحة',num(state.tasks.filter(x=>x.status!=='مكتمل').length)],['مواد المخزون',num(state.inventory.length)]];document.getElementById('reportTotals').innerHTML=items.map(([a,b])=>`<div><dt>${escapeHtml(a)}</dt><dd>${escapeHtml(b)}</dd></div>`).join('');}
function renderConnection(){const el=document.getElementById('connectionDetails');if(!el)return;el.innerHTML=`<div><strong>الوضع:</strong> ${syncState==='online'?'سحابي مشترك':syncState==='local'?'محلي تجريبي':'غير متصل'}</div><div><strong>المزرعة:</strong> ${escapeHtml(CONFIG.farmName||'مزرعة ليوا 77')}</div><div><strong>العامل الحالي:</strong> ${escapeHtml(workerName||'لم يسجّل الدخول')}</div><div><strong>آخر تحديث:</strong> ${dateFmt.format(new Date())}</div>`;}

function exportBackup(){download(`liwa77-backup-${isoDate(new Date())}.json`,JSON.stringify({farm:CONFIG.farmId,exportedAt:new Date().toISOString(),data:state},null,2),'application/json');}
function exportCsv(){const rows=[];COLLECTIONS.forEach(type=>state[type].forEach(x=>rows.push({القسم:typeLabel(type),...x})));if(!rows.length){showToast('لا توجد بيانات للتصدير');return;}const headers=[...new Set(rows.flatMap(Object.keys))];const csv=[headers.map(csvCell).join(','),...rows.map(r=>headers.map(h=>csvCell(r[h])).join(','))].join('\n');download(`liwa77-all-${isoDate(new Date())}.csv`,`\uFEFF${csv}`,'text/csv;charset=utf-8');}
function importBackup(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{const parsed=JSON.parse(reader.result),data=parsed.data||parsed;COLLECTIONS.forEach(k=>state[k]=Array.isArray(data[k])?data[k]:[]);saveCache();renderAll();if(client){for(const type of COLLECTIONS)for(const rec of state[type])await upsertCloud(type,rec);}showToast('تم استيراد النسخة');}catch{alert('ملف النسخة الاحتياطية غير صالح.');}e.target.value='';};reader.readAsText(file);}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}

function badge(v){const text=String(v||'—');let cls='';if(['سليمة','مكتمل','طبيعي','ممتاز'].includes(text))cls='good';else if(['تحتاج متابعة','تحت العلاج','بانتظار قطع الغيار','ضغط منخفض','تم العثور على تسرب','نقاط التنقيط مسدودة','مشكلة في المضخة','عالية'].includes(text))cls='issue';else if(text==='ميتة / للإزالة'||text==='منخفضة')cls='low';return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function num(v){return numberFmt.format(Number(v||0));}function money(v){return moneyFmt.format(Number(v||0));}function sum(a,k){return a.reduce((t,x)=>t+Number(x[k]||0),0);}function setText(id,v){document.getElementById(id).textContent=v;}
function fmtDate(v){if(!v)return'—';const d=new Date(`${v}T12:00:00`);return Number.isNaN(d.getTime())?v:dateFmt.format(d);}function isoDate(d){const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10);}function daysFromToday(v){const t=new Date(`${v}T12:00:00`),n=new Date();n.setHours(12,0,0,0);return Math.ceil((t-n)/86400000);}function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`;}
let toastTimer;function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2400);}

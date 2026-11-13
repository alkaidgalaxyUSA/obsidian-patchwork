(async () => {
 const {modal,raw}=window.__pwDiffValidation;
 const settle=()=>new Promise(resolve=>setTimeout(resolve,100));
 const results=[];
 const assert=(value,message)=>{if(!value)throw Error(message);};
 const test=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}};
 const host=modal.contentEl;
 await test('live modal blocks, connectors and real line numbers',async()=>{await settle();assert(host.querySelectorAll('[data-diff-change]').length===3,'changes');assert(host.querySelectorAll('.pw-diff-connector').length===3,'connectors');assert(host.querySelector('.pw-diff-numbers-left .pw-diff-number').textContent==='40','real old line');assert(host.querySelector('.pw-diff-numbers-right .pw-diff-number').textContent==='90','real new line');});
 await test('live empty-side boundaries connect through text and gutter',async()=>{
  const markers=[...host.querySelectorAll('.pw-diff-boundary')];assert(markers.length===2,'two empty-side markers');
  for(const marker of markers){
   const side=marker.dataset.side,view=host.querySelector('.pw-diff-document-'+side),type=side==='left'?'add':'del';
   const r=marker.getBoundingClientRect(),group=view.querySelector(`[data-diff-type="${type}"]`);
   assert(!marker.hidden&&r.height===2,'visible thin boundary');assert(Math.abs(r.top-group.getBoundingClientRect().top)<1,'actual range boundary');
   assert(r.width>=view.clientWidth,'text and gutter span');assert(getComputedStyle(marker).pointerEvents==='none','selection remains accessible');
  }
 });
 await test('live context folding expands and creates scrollable documents',async()=>{host.querySelector('.pw-diff-document-right .pw-diff-expand').click();await settle();assert(host.querySelector('.pw-diff-document-right').scrollHeight>1000,'expanded document');assert(!host.querySelector('.pw-diff-expand'),'fold removed');});
 await test('live two-way scroll and gutters',async()=>{const left=host.querySelector('.pw-diff-document-left'),right=host.querySelector('.pw-diff-document-right');left.scrollTop=460;await settle();assert(Math.abs(right.scrollTop-left.scrollTop)<1,'left sync');right.scrollTop=900;await settle();assert(Math.abs(left.scrollTop-right.scrollTop)<1,'right sync');assert(host.querySelector('.pw-diff-numbers-left').scrollTop===left.scrollTop,'gutter');});
 await test('live rebuild preserves scroll position',async()=>{modal.render();await settle();assert(host.querySelector('.pw-diff-document-left').scrollTop===900,'restored scroll');});
 await test('live wraps, resize and unequal text remain aligned',async()=>{modal.wrap=true;modal.modalEl.style.width='760px';modal.render();await settle();const a=[...host.querySelectorAll('.pw-diff-document-left .pw-diff-cell')],b=[...host.querySelectorAll('.pw-diff-document-right .pw-diff-cell')];assert(a.every((el,i)=>Math.abs(el.getBoundingClientRect().height-b[i].getBoundingClientRect().height)<1),'row heights');});
 await test('live navigation reaches all changes and both sides without sync',async()=>{modal.align=false;modal.sync=false;modal.render();await settle();modal.index=undefined;modal.navigate(1);modal.navigate(1);modal.navigate(1);await settle();assert(modal.index===2,'three stops');assert(host.querySelector('.pw-diff-document-right').scrollTop>0,'right navigated');});
 await test('live unified and split toggles dispose and recreate documents',async()=>{for(let i=0;i<6;i++){modal.mode=i%2?'split':'unified';modal.render();await settle();assert(host.querySelectorAll('[data-diff-change]').length===3,'stable count');if(modal.mode==='unified')assert(modal.documentListeners.length===1,'unified cleanup count');}});
 const previous=app.workspace.activeLeaf;
 const leaf=app.workspace.getLeaf('tab');
 try {
  await leaf.setViewState({type:'patchwork-git-diff',active:true,state:{title:'Disposable Diff tab regression',text:raw,comparison:'snapshot',mode:'split',fullContext:true}});
  const view=leaf.view;
  await settle();
  await test('live tab uses the same two-sided renderer',()=>{assert(view.contentEl.querySelectorAll('.pw-diff-document').length===2,'tab documents');assert(view.contentEl.querySelectorAll('.pw-diff-connector').length===3,'tab connectors');});
  await test('live tab navigation and right context dispatch preserve hunk identity',()=>{view.navigateHunk(1);view.navigateHunk(1);assert(view.hunkIndex===1,'tab next');const original=view.hunkMenu;let received;view.hunkMenu=(event,file,fileIndex,hunkIndex)=>{event.preventDefault();received=[fileIndex,hunkIndex];};try{view.contentEl.querySelector('.pw-diff-document-right .pw-diff-cell').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert(JSON.stringify(received)==='[0,0]','right hunk');}finally{view.hunkMenu=original;}});
  await test('live tab switches unified and restores split without errors',async()=>{view.mode='unified';view.render();await settle();assert(!view.contentEl.querySelector('.pw-diff-documents'),'unified');view.mode='split';view.render();await settle();assert(view.contentEl.querySelectorAll('.pw-diff-document').length===2,'split');});
 } finally {leaf.detach();if(previous)app.workspace.setActiveLeaf(previous,{focus:true});}
 modal.align=true;modal.sync=true;modal.wrap=false;modal.mode='split';modal.collapse=true;modal.modalEl.style.width='';modal.render();await settle();
 window.__pwDiffValidation.results=results;
 return JSON.stringify(results);
})()

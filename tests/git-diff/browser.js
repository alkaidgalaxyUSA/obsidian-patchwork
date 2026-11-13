import { navigateDifference } from '../../plugins/git/src/utils/diff-navigation';
import { renderDiff } from '../../plugins/git/src/history/utils/render-diff';
// Minimal Obsidian DOM extensions; all diff code and styles are production sources.
for (const [name, tag] of [['createDiv','div'],['createSpan','span'],['createEl',null]]) Element.prototype[name] = function(first={}, second={}) {
 const options=tag?first:second, el=this.ownerDocument.createElement(tag||first);
 if(options.cls) el.className=options.cls;if(options.text!==undefined) el.textContent=options.text;
 for(const [key,value] of Object.entries(options.attr||{})) el.setAttribute(key,value);
 this.append(el);return el;
};
Element.prototype.empty=function(){this.replaceChildren();};Element.prototype.setText=function(text){this.textContent=text;};
let observers=0;
const NativeObserver=window.ResizeObserver;
window.ResizeObserver=class extends NativeObserver { constructor(fn){super(fn);this.active=true;observers++;} disconnect(){if(this.active){this.active=false;observers--;}super.disconnect();} };
const fixture=()=>{
 const lines=[];let old=40,next=90;
 const context=content=>lines.push({type:'context',content,oldLineNo:old++,newLineNo:next++});
 const del=content=>lines.push({type:'del',content,oldLineNo:old++});const add=content=>lines.push({type:'add',content,newLineNo:next++});
 context('function example() {');del('  const value = 1;');add('  const value = 2;');add('  // added explanation');
 for(let i=0;i<30;i++) context(`  unchanged ${i}`);
 del('  removed line');context('  boundary');add('  // inserted at boundary');
 context('  '+ 'long content '.repeat(40));
 for(let i=0;i<45;i++) context(`  tail ${i}`);
 return [{path:'example.ts',change:'modified',additions:3,deletions:2,hunks:[{oldStart:40,newStart:90,oldLines:old-40,newLines:next-90,header:'',lines}]}];
};
let menus=[];
const host=document.querySelector('#host');let cleanups=[],mode='split',options={align:true,sync:true,wrap:false},files=fixture();
const dispose=()=>{for(const fn of cleanups.splice(0)) fn();};
const render=(limit=3000)=>{dispose();host.empty(); const out=host.createEl('pre',{cls:'pw-git-output'});renderDiff(out,'',files,mode,(event,file,fileIndex,hunkIndex)=>{event.preventDefault();menus.push([fileIndex,hunkIndex]);},limit,{...options,onExpandContext:()=>{options.collapse=false;render();},registerCleanup:fn=>cleanups.push(fn)});};
const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,120)));
const assert=(value,message)=>{if(!value)throw Error(message);};
const rows=side=>[...host.querySelectorAll(`.pw-diff-document-${side} .pw-diff-cell`)];
let index=-1;
document.querySelector('#split').onclick=()=>{mode='split';render();};document.querySelector('#unified').onclick=()=>{mode='unified';render();};
document.querySelector('#wrap').onclick=()=>{options.wrap=!options.wrap;render();};document.querySelector('#align').onclick=()=>{options.align=!options.align;render();};
document.querySelector('#next').onclick=()=>{const changes=host.querySelectorAll('[data-diff-change]');const el=changes[++index%changes.length];el?.scrollIntoView({block:'center'});el?.focus({preventScroll:true});};
window.diffTest={render,dispose,getObservers:()=>observers};
window.runRegression=async()=>{
 const results=[];const test=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}};
 files=fixture();mode='split';options={align:true,sync:true,wrap:false};render();await settle();
 await test('real old/new line numbers and blank spacers',()=>{assert(rows('left')[0].dataset.lineNumber==='40','old number');assert(rows('right')[0].dataset.lineNumber==='90','new number');assert([...host.querySelectorAll('.pw-diff-numbers-left .pw-diff-number')].some(el=>el.textContent===''),'placeholder number must be blank');});
 await test('three separate change blocks and three colored SVG connections',()=>{assert(host.querySelectorAll('[data-diff-change]').length===3,'block count');assert(host.querySelectorAll('.pw-diff-connector').length===3,'connector count');assert(host.querySelector('.pw-diff-connector').getAttribute('d').startsWith('M'),'connector geometry');});
 await test('connectors taper to actual changed ranges and gutters exclude padding',async()=>{
  const paths=[...host.querySelectorAll('.pw-diff-connector')];
  const spans=path=>{const n=path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);return [n[15]-n[1],n[9]-n[7]];};
  const [oldHeight,newHeight]=spans(paths[0]);assert(oldHeight===20&&newHeight===40,'replacement must taper 20 to 40');
  host.querySelector('.pw-diff-document-left').scrollTop=500;await settle();
  assert(spans(paths[1])[1]===2,'deletion ends at a two-pixel face');assert(spans(paths[2])[0]===2,'insertion starts at a two-pixel face');
  assert([...host.querySelectorAll('.pw-diff-number')].filter(el=>!el.textContent).every(el=>el.className==='pw-diff-number'),'padding gutter must not be colored');
  host.querySelector('.pw-diff-document-left').scrollTop=0;await settle();
 });
 await test('rapid bidirectional scroll updates peers and connectors before every paint',async()=>{
  const a=host.querySelector('.pw-diff-document-left'),b=host.querySelector('.pw-diff-document-right');
  for(let i=0;i<24;i++){
   const source=i%2?a:b;source.scrollTop=40+(i*37)%500;
   await new Promise(requestAnimationFrame);
   assert(Math.abs(a.scrollTop-b.scrollTop)<1,`mixed scroll frame ${i}`);
   const path=host.querySelector('.pw-diff-connector'),group=host.querySelector('[data-diff-change]');
   const expected=group.getBoundingClientRect().top-host.querySelector('.pw-diff-center-space').getBoundingClientRect().top;
   if(path.getAttribute('d')) assert(Math.abs(Number(path.getAttribute('d').match(/^M0,(-?[\d.]+)/)[1])-expected)<1,`stale connector frame ${i}`);
  }
  a.scrollTop=0;await settle();
 });
 await test('wheel bursts update dense changes, both documents and gutters in the input event',async()=>{
  const lines=[];for(let i=1;i<=220;i++){
   if(i%4===0)lines.push({type:'del',content:`old ${i}`,oldLineNo:i},{type:'add',content:`new ${i}`,newLineNo:i});
   else lines.push({type:'context',content:`context ${i}`,oldLineNo:i,newLineNo:i});
  }
  files=[{path:'dense.txt',change:'modified',hunks:[{oldStart:1,newStart:1,oldLines:220,newLines:220,lines}]}];render();await settle();
  const a=host.querySelector('.pw-diff-document-left'),b=host.querySelector('.pw-diff-document-right');
  const surfaces=[a,b,host.querySelector('.pw-diff-numbers-left'),host.querySelector('.pw-diff-numbers-right')];
  for(let i=0;i<36;i++){
   const delta=i<24?83:-127,event=new WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true});
   surfaces[i%4].dispatchEvent(event);
   assert(event.defaultPrevented,'native compositor must not scroll a single surface');
   assert(a.scrollTop===b.scrollTop,'both documents synchronized before wheel returns');
   for(const side of ['left','right'])assert(host.querySelector('.pw-diff-numbers-'+side).scrollTop===a.scrollTop,'gutter synchronized before wheel returns');
   const center=host.querySelector('.pw-diff-center-space').getBoundingClientRect(),groups=[...a.querySelectorAll('[data-diff-change]')];
   [...host.querySelectorAll('.pw-diff-connector')].forEach((path,index)=>{
    const r=groups[index].getBoundingClientRect(),d=path.getAttribute('d');
    if(r.bottom>=center.top&&r.top<=center.bottom){assert(!!d,'visible connector must not disappear');assert(Math.abs(Number(d.match(/^M0,(-?[\d.]+)/)[1])-r.top+center.top)<1,'connector follows dense change in same event');}
   });
   await new Promise(requestAnimationFrame);
   assert(a.scrollTop===b.scrollTop,'no scroll echo regression on next paint');
  }
  files=fixture();render();await settle();
 });
 await test('wheel units, horizontal RTL, independent mode and browser zoom remain correct',async()=>{
  const a=host.querySelector('.pw-diff-document-left'),b=host.querySelector('.pw-diff-document-right');
  const send=(el,init)=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,...init});el.dispatchEvent(e);return e;};
  send(a,{deltaY:3,deltaMode:1});assert(a.scrollTop===60&&b.scrollTop===60,'line units');
  send(b,{deltaY:1,deltaMode:2});assert(a.scrollTop===60+b.clientHeight,'page units');
  const oldX=a.scrollLeft;send(a,{deltaY:80,shiftKey:true});assert(a.scrollLeft>oldX&&b.scrollLeft===80,'shift horizontal and left RTL');
  const before=a.scrollTop;assert(!send(a,{deltaY:100,ctrlKey:true}).defaultPrevented&&a.scrollTop===before,'browser zoom is untouched');
  options={align:false,sync:false};render();await settle();
  const independentLeft=host.querySelector('.pw-diff-document-left'),independentRight=host.querySelector('.pw-diff-document-right');
  send(independentRight,{deltaY:100});assert(independentRight.scrollTop===100&&independentLeft.scrollTop===0,'independent wheel');
  dispose();assert(!send(independentRight,{deltaY:10}).defaultPrevented,'wheel listener disposed');
  options={align:true,sync:true,wrap:false};render();await settle();
 });
 await test('empty-side boundaries span text and gutter without adding rows in either alignment mode',async()=>{
  for(const align of [true,false]){
   options.align=align;render();await settle();
   const markers=[...host.querySelectorAll('.pw-diff-boundary')];assert(markers.length===2,'only pure insertion and deletion need boundaries');
   const left=host.querySelector('.pw-diff-document-left');left.scrollTop=500;await settle();
   for(const marker of markers){
    const side=marker.dataset.side,view=host.querySelector('.pw-diff-document-'+side);
    const type=side==='left'?'add':'del';
    const group=view.querySelector(`[data-diff-type="${type}"]`),r=marker.getBoundingClientRect(),v=view.getBoundingClientRect();
    assert(!marker.hidden,'visible boundary');assert(Math.abs(r.top-group.getBoundingClientRect().top)<1,'boundary anchors at insertion/deletion position');
    assert(r.height===2&&getComputedStyle(marker).pointerEvents==='none','two pixels and non-interactive');
    assert(r.width>=view.clientWidth,'covers text and gutter');
    assert(side==='left'?Math.abs(r.left-v.left-view.clientLeft)<1:Math.abs(r.right-v.left-view.clientLeft-view.clientWidth)<1,'reaches document edge');
    assert(getComputedStyle(marker).backgroundColor!=='rgba(0, 0, 0, 0)','semantic boundary color');
    const connector=host.querySelector('.pw-diff-connector-'+type),center=host.querySelector('.pw-diff-center-space').getBoundingClientRect();
    assert(!host.querySelector('.pw-diff-boundary-connector'),'no stroke extending into the trapezoid');
    assert(getComputedStyle(connector).fill===getComputedStyle(marker).backgroundColor,'line matches block fill');
    assert(Math.abs(side==='left'?r.right-center.left:r.left-center.right)<0.01,'line stops exactly at trapezoid end face');
    const n=connector.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    const top=side==='left'?n[1]:n[7],bottom=side==='left'?n[15]:n[9];
    assert(Math.abs(center.top+top-r.top)<0.01&&Math.abs(center.top+bottom-r.bottom)<0.01,'entire two-pixel face abuts boundary without a gap');


   }
   left.scrollTop=0;await settle();assert(markers.every(marker=>marker.hidden),'offscreen boundaries hidden');
   dispose();assert(markers.every(marker=>!marker.isConnected),'boundary cleanup');
  }
  options.align=true;render();await settle();
 });
 await test('replacement backgrounds agree on both sides and differ from insertion',()=>{const a=host.querySelector('.pw-diff-document-left .pw-diff-modify'),b=host.querySelector('.pw-diff-document-right .pw-diff-modify');assert(getComputedStyle(a).backgroundColor===getComputedStyle(b).backgroundColor,'replacement colors');assert(getComputedStyle(a).backgroundColor!==getComputedStyle(host.querySelector('.pw-diff-document-right .pw-diff-add')).backgroundColor,'distinct add color');});
 await test('aligned row geometry remains equal after asymmetric wrapping and resize',async()=>{options.wrap=true;host.style.width='620px';render();await settle();const a=rows('left'),b=rows('right');assert(a.length===b.length,'row count');a.forEach((el,i)=>assert(Math.abs(el.getBoundingClientRect().height-b[i].getBoundingClientRect().height)<1,`height ${i}`));const long=a.find(el=>el.textContent.includes('long content'));assert(long.getBoundingClientRect().height>20,'wrap must increase height');});
 await test('bidirectional scroll, gutters and visible connectors remain responsive',async()=>{const a=host.querySelector('.pw-diff-document-left'),b=host.querySelector('.pw-diff-document-right');a.scrollTop=320;await settle();assert(Math.abs(a.scrollTop-b.scrollTop)<1,'left sync');b.scrollTop=600;await settle();assert(Math.abs(a.scrollTop-b.scrollTop)<1,'right sync');assert(host.querySelector('.pw-diff-numbers-left').scrollTop===a.scrollTop,'gutter sync');});
 await test('unaligned view removes placeholder heights and maps scroll positions',async()=>{options.align=false;render();await settle();assert([...host.querySelectorAll('.pw-diff-empty')].every(el=>el.getBoundingClientRect().height===0),'zero-height placeholders');const a=host.querySelector('.pw-diff-document-left'),b=host.querySelector('.pw-diff-document-right');a.scrollTop=200;await settle();assert(b.scrollTop>0,'mapped scroll');});
 await test('independent scrolling can be disabled without feedback',async()=>{options.sync=false;render();await settle();const a=host.querySelector('.pw-diff-document-left'),b=host.querySelector('.pw-diff-document-right');a.scrollTop=200;await settle();assert(b.scrollTop===0,'independent scroll');});
 await test('unified preserves actual lines and change navigation without observers',()=>{mode='unified';render();assert(host.querySelectorAll('[data-diff-change]').length===3,'unified changes');assert(host.querySelectorAll('.pw-diff-unified-line').length===files[0].hunks[0].lines.length,'unified complete');assert(observers===0,'split observers disposed');});
 await test('full-file additions and deletions retain two document sides',async()=>{mode='split';options={align:true,sync:true};for(const type of ['added','deleted']){files=[{path:'empty.txt',change:type,hunks:[{oldStart:0,newStart:1,oldLines:type==='deleted'?2:0,newLines:type==='added'?2:0,lines:['one','two'].map((content,i)=>({type:type==='added'?'add':'del',content,...(type==='added'?{newLineNo:i+1}:{oldLineNo:i+1})}))}]}];render();await settle();assert(host.querySelectorAll('.pw-diff-document').length===2,type+' sides');assert(host.querySelectorAll('.pw-diff-connector').length===1,type+' connector');assert(host.querySelectorAll('.pw-diff-boundary').length===1,type+' empty document boundary');assert(!host.querySelector('.pw-diff-boundary').hidden,type+' start-of-file boundary visible');}});
 await test('binary, empty rename and no-change views are safe',()=>{for(const file of [{path:'image.png',binary:true,hunks:[]},{path:'new',oldPath:'old',hunks:[],change:'modified'},{path:'empty',change:'added',hunks:[]}]){files=[file];render();assert(!host.querySelector('.pw-diff-documents'),'non-text');assert(observers===0,'cleanup');}files=[];render();assert(host.textContent==='No changes.','no changes');});
 await test('show more disposes old observers before rebuilding and reveals remaining changes',async()=>{files=fixture();render(8);await settle();const before=observers;host.querySelector('button').click();await settle();assert(observers===before,'observer leak after pagination');assert(host.querySelectorAll('[data-diff-change]').length===3,'complete after pagination');});
 await test('collapsed context retains source line numbers and expands from either side',async()=>{options.collapse=true;render();await settle();assert(host.querySelectorAll('.pw-diff-expand').length>0,'fold control');const before=rows('right').length;host.querySelector('.pw-diff-document-right .pw-diff-expand').click();await settle();assert(rows('right').length>before,'expanded');assert(rows('right').at(-1).dataset.lineNumber===String(files[0].hunks[0].lines.at(-1).newLineNo),'last source line');});
 await test('both document context menus and keyboard menus preserve original hunk indices',async()=>{menus=[];options.collapse=false;render();await settle();host.querySelector('.pw-diff-document-left .pw-diff-cell').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));host.querySelector('.pw-diff-document-right .pw-diff-cell').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));host.querySelector('.pw-diff-document-right .pw-diff-block-modify').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));assert(JSON.stringify(menus)==='[[0,0],[0,0],[0,0]]','menu identity');});
 await test('multi-file, multi-hunk navigation includes omitted-context separators',async()=>{const first=fixture()[0],second=fixture()[0];second.path='second.ts';first.hunks.push({...second.hunks[0],oldStart:300,newStart:400});files=[first,second];render();await settle();assert(host.querySelectorAll('.pw-diff-documents').length===2,'two file views');assert(host.querySelectorAll('[data-diff-change]').length===9,'all change blocks');assert(host.querySelectorAll('.pw-diff-expand').length===2,'paired gap marker');const result=navigateDifference(host,5,1);assert(result.fileIndex===1,'navigate second file');});
 await test('navigation moves both documents when synchronization is disabled',async()=>{files=fixture();options={align:false,sync:false};render();await settle();const result=navigateDifference(host,0,1);await settle();assert(result.index===1,'next change');assert(host.querySelector('.pw-diff-document-right').scrollTop>0,'right navigation');});
 await test('modal CSS, light scheme and non-monospace host do not break alignment',async()=>{host.classList.add('modal','pw-git-diff-modal');document.body.classList.replace('theme-dark','theme-light');files=fixture();options={align:true,wrap:true};host.style.width='720px';render();await settle();const a=rows('left'),b=rows('right');a.forEach((el,i)=>assert(Math.abs(el.getBoundingClientRect().height-b[i].getBoundingClientRect().height)<1,'modal row height'));assert(getComputedStyle(host.querySelector('.pw-diff-modify')).backgroundColor==='rgb(223, 235, 248)','light colors');host.classList.remove('modal','pw-git-diff-modal');document.body.classList.replace('theme-light','theme-dark');});
 await test('large files paginate without losing changes and collapsed context bypasses hidden-line limits',async()=>{const lines=Array.from({length:3500},(_,i)=>({type:'context',content:`unchanged ${i}`,oldLineNo:i+1,newLineNo:i+1}));lines.push({type:'del',content:'old tail',oldLineNo:3501},{type:'add',content:'new tail',newLineNo:3501});files=[{path:'large.txt',change:'modified',hunks:[{oldStart:1,newStart:1,oldLines:3501,newLines:3501,lines}]}];options={align:true};render();await settle();assert(host.querySelector('button'),'pagination button');const activeObservers=observers;host.querySelector('button').click();await settle();assert(host.querySelectorAll('[data-diff-change]').length===1,'tail change reached');assert(observers===activeObservers,'pagination cleanup');options.collapse=true;render();await settle();assert(rows('left').length<12,'context collapsed before pagination');assert(host.querySelectorAll('[data-diff-change]').length===1,'collapsed tail change');});
 await test('repeated split/unified/render/dispose has no active observer leak',async()=>{for(let i=0;i<12;i++){mode=i%2?'split':'unified';render();await settle();}dispose();assert(observers===0,'observers after dispose');});
 mode='split';files=fixture();options={align:true,sync:true,wrap:false};host.style.width='1000px';render();await settle();
 window.regressionResults=results;document.querySelector('#results').textContent=results.map(r=>(r.pass?'PASS ':'FAIL ')+r.name+(r.error?' — '+r.error:'')).join('\n');return results;
};
document.querySelector('#run').onclick=()=>window.runRegression();render();

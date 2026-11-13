(() => {
 window.__pwDiffValidation.cancelScrollSample?.();
 let frame;

 const modal=window.__pwDiffValidation.modal,host=modal.contentEl;
 const left=host.querySelector('.pw-diff-document-left'),right=host.querySelector('.pw-diff-document-right');
 const center=host.querySelector('.pw-diff-center-space');
 const result={frames:0,movingFrames:0,trustedWheels:0,errors:[]};
 window.__pwDiffValidation.scrollSample=result;
 let previous=left.scrollTop;
 const started=performance.now();
 const wheel=event=>{
  if(!event.isTrusted||event.ctrlKey||event.metaKey)return;
  result.trustedWheels++;
  if(!event.defaultPrevented)result.errors.push('native single-surface wheel not prevented');
  if(left.scrollTop!==right.scrollTop)result.errors.push('mixed positions during wheel input');
 };
 host.addEventListener('wheel',wheel);
 window.__pwDiffValidation.cancelScrollSample=()=>{cancelAnimationFrame(frame);host.removeEventListener('wheel',wheel);};
 const sample=()=>{
  result.frames++;
  if(left.scrollTop!==previous)result.movingFrames++;
  previous=left.scrollTop;
  if(Math.abs(left.scrollTop-right.scrollTop)>1)result.errors.push('mixed document positions');
  for(const side of ['left','right']){
   const surface=side==='left'?left:right;
   if(Math.abs(host.querySelector('.pw-diff-numbers-'+side).scrollTop-surface.scrollTop)>1)result.errors.push('stale gutter');
  }
  for(const marker of host.querySelectorAll('.pw-diff-boundary')){
   if(marker.hidden)continue;
   const side=marker.dataset.side,view=side==='left'?left:right,type=side==='left'?'add':'del';
   const group=view.querySelector(`[data-diff-type="${type}"]`);
   if(Math.abs(marker.getBoundingClientRect().top-group.getBoundingClientRect().top)>1)result.errors.push('stale boundary');
  }
  const groups=[...left.querySelectorAll('[data-diff-change]')],paths=[...host.querySelectorAll('.pw-diff-connector')];
  const centerRect=center.getBoundingClientRect();
  groups.forEach((group,index)=>{
   const d=paths[index].getAttribute('d'),r=group.getBoundingClientRect();
   if(r.bottom>centerRect.top&&r.top<centerRect.bottom&&!d)result.errors.push('missing visible connector');
   if(d){const y=Number(d.match(/^M0,(-?[\d.]+)/)[1]);if(Math.abs(y-(r.top-centerRect.top))>2)result.errors.push('stale connector');}
  });
  if(performance.now()-started<15000)frame=requestAnimationFrame(sample);
  else host.removeEventListener('wheel',wheel);
 };
 frame=requestAnimationFrame(sample);
 return [left,right].map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};});
})()

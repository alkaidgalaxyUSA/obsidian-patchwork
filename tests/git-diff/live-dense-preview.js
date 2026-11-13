(async () => {
 const plugin=app.plugins.plugins['patchwork-git'];
 if(!plugin||plugin.controller.busy)throw Error('Git is unavailable or busy');
 const lines=[];
 for(let i=1;i<=220;i++){
  if(i%4===0)lines.push(`- old entry ${i}`,`+ revised entry ${i}`);
  else lines.push(` context ${i}${i===30?' long content'.repeat(80):''}`);
 }
 const raw='diff --git a/__pw_dense_fixture__.txt b/__pw_dense_fixture__.txt\n--- a/__pw_dense_fixture__.txt\n+++ b/__pw_dense_fixture__.txt\n@@ -1,220 +1,220 @@\n'+lines.join('\n')+'\n';
 const title='Dense scrolling regression - disposable preview';
 await plugin.controller.openDiffText(raw,title,document,{historical:true,revision:'12345678',baseRevisions:['87654321']});
 const modal=[...plugin.controller.dialogs].find(item=>item.title===title);
 window.__pwDiffValidation={modal,raw};
 modal.collapse=false;
 await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,100)));
 return {changes:modal.contentEl.querySelectorAll('[data-diff-change]').length};
})()

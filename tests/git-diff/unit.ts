import assert from "node:assert/strict";
import { diffBlocks, transferScroll } from "../../plugins/git/src/history/utils/diff-blocks";
import { pairLines, wordDiff } from "../../plugins/git/src/history/utils/word-diff";
import { differenceCount } from "../../plugins/git/src/utils/difference-count";
import { hunkPatch } from "../../plugins/git/src/history/utils/diff-patch";
let count = 0;
const test = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };
const hunk = { oldStart: 40, newStart: 90, oldLines: 4, newLines: 5, lines: [
 {type:'context',content:'start',oldLineNo:40,newLineNo:90},
 {type:'del',content:'old',oldLineNo:41}, {type:'add',content:'new',newLineNo:91}, {type:'add',content:'extra',newLineNo:92},
 {type:'context',content:'middle',oldLineNo:42,newLineNo:93}, {type:'del',content:'gone',oldLineNo:43},
 {type:'context',content:'end',oldLineNo:44,newLineNo:94},
] };
test('multiple display changes retain original hunk identity and exact ranges', () => {
 const blocks = diffBlocks(hunk, 2, 5).filter(b => b.type !== 'context');
 assert.deepEqual(blocks.map(b => [b.type,b.oldStart,b.oldEnd,b.newStart,b.newEnd,b.fileIndex,b.hunkIndex]), [['modify',41,42,91,93,2,5],['del',43,44,94,94,2,5]]);
 assert.equal(differenceCount({hunks:[hunk]}),2);
});
test('zero-length patch ranges anchor additions at the following line', () => {
 assert.equal(diffBlocks({oldStart:0,oldLines:0,newStart:1,newLines:1,lines:[{type:'add',content:'a'}]})[0].oldStart,1);
 assert.equal(diffBlocks({oldStart:8,oldLines:0,newStart:9,newLines:1,lines:[{type:'add',content:'a'}]})[0].oldStart,9);
});
test('line matching preserves an inserted line before a matching replacement', () => {
 const pairs=pairLines([{type:'del',content:'const alpha = 1;'},{type:'del',content:'return alpha;'},{type:'add',content:'// inserted comment'},{type:'add',content:'const alpha = 2;'},{type:'add',content:'return alpha;'}]);
 assert.equal(pairs[0].type,'add'); assert.equal(pairs[1].left.content,'const alpha = 1;'); assert.equal(pairs[1].right.content,'const alpha = 2;');
});
test('all input lines survive repeated, unrelated, empty and Unicode comparisons', () => {
 for(const old of [['',''],['same','same'],['旧值','尾部'],['aaa','bbb']]) for(const next of [['x'],['same','same','same'],['新值','尾部'],[]]) {
  const left=old.map(content=>({type:'del',content})),right=next.map(content=>({type:'add',content})); const pairs=pairLines([...left,...right]);
  assert.deepEqual(pairs.flatMap(p=>p.left?[p.left]:[]),left);assert.deepEqual(pairs.flatMap(p=>p.right?[p.right]:[]),right);
 }
});
test('word ranges preserve exact Unicode, whitespace and HTML text', () => {
 for(const [a,b] of [['const value = 1;','const value = 2;'],['你好 world <tag>','你好 new world <tag>'],['foo  bar','foo bar'],['hello🙂 world','hello🙂 earth']]) {
  const diff=wordDiff(a,b); assert.ok(diff);assert.equal(diff.old.map(x=>x.value).join(''),a);assert.equal(diff.new.map(x=>x.value).join(''),b);
 }
});
test('inline insertion and replacement have distinct semantic colors', () => {
 assert.equal(wordDiff('const foo = bar;', 'const foo = new bar;').new.find(s=>s.changed).type,'add');
 assert.equal(wordDiff('const foo = 1;', 'const foo = 2;').old.find(s=>s.changed).type,'modify');
});
test('unrelated words and expensive comparisons degrade without losing source', () => {
 assert.equal(wordDiff('completely unrelated','别的内容'),null);
 assert.equal(wordDiff('x '.repeat(1000),'y '.repeat(1000)),null);
});
test('scroll mapping handles shifted ranges, insertions and EOF', () => {
 assert.equal(transferScroll(50,[[0,0],[100,200],[200,300]]),100);
 assert.equal(transferScroll(100,[[0,0],[100,100],[100,180],[200,280]]),180);
 assert.equal(transferScroll(250,[[0,0],[200,280]]),330);
});
test('display blocks do not alter patch hunk identity or no-newline markers', () => {
 const raw='diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n@@ -9 +9 @@\n-end\n+tail\n\\ No newline at end of file\n';
 const {patch}=hunkPatch(raw,0,1);assert.ok(patch.includes('@@ -9'));assert.ok(!patch.includes('@@ -1 '));assert.ok(patch.includes('\\ No newline'));assert.throws(()=>hunkPatch(raw,0,2));
});
console.log(`${count} unit regression groups passed`);
import { GitService } from '../../plugins/git/src/history/git/git-service';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export const integration = (async () => {
 const directory=await mkdtemp(join(tmpdir(),'patchwork-diff-repository-'));
 const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
 const service=new GitService(directory);
 try {
  git('init','--quiet');git('config','user.email','diff-test@example.invalid');git('config','user.name','Diff regression');git('config','core.autocrlf','false');
  const base=Array.from({length:80},(_,i)=>`line ${i}`).join('\n')+'\n';
  await writeFile(join(directory,'fixture.txt'),base);git('add','fixture.txt');git('-c','commit.gpgsign=false','commit','--quiet','-m','Fixture baseline');
  const changed=base.replace('line 3\n','changed 3\n').replace('line 6\n','changed 6\n').replace('line 65\n','changed 65\n');
  await writeFile(join(directory,'fixture.txt'),changed);
  let raw=await service.diff(['fixture.txt']);const files=await service.parseDiff(raw);
  assert.equal(files[0].hunks.length,2);assert.equal(differenceCount(files[0]),3);
  const {patch,section}=hunkPatch(raw,0,0);await service.applyHunk(patch,'stage','fixture.txt',section);
  const staged=git('show',':fixture.txt');assert.ok(staged.includes('changed 3'));assert.ok(staged.includes('changed 6'));assert.ok(!staged.includes('changed 65'));
  console.log('PASS actual Git staging preserves the original hunk, not the display block');
  raw=await service.diff(['fixture.txt'],true);const undo=hunkPatch(raw,0,0);await service.applyHunk(undo.patch,'unstage','fixture.txt',undo.section);
  assert.equal(git('show',':fixture.txt'),base);assert.equal(await readFile(join(directory,'fixture.txt'),'utf8'),changed);
  console.log('PASS actual Git unstage leaves working text unchanged');
  raw=await service.diff(['fixture.txt']);const revert=hunkPatch(raw,0,1);await service.applyHunk(revert.patch,'revert','fixture.txt',revert.section);
  const remaining=await readFile(join(directory,'fixture.txt'),'utf8');assert.ok(remaining.includes('changed 3'));assert.ok(remaining.includes('line 65'));assert.ok(!remaining.includes('changed 65'));
  await assert.rejects(service.applyHunk(revert.patch,'revert','fixture.txt',revert.section),/changed since/);
  console.log('PASS actual Git revert isolates the selected hunk and rejects stale patches');
  await writeFile(join(directory,'new.txt'),'new\n');const added=await service.parseDiff(await service.diffUntracked('new.txt'));assert.equal(added[0].change,'added');assert.equal(diffBlocks(added[0].hunks[0])[0].type,'add');
  git('rm','--quiet','--force','fixture.txt');const deleted=await service.parseDiff(await service.diff(['fixture.txt'],true));assert.equal(deleted[0].change,'deleted');
  console.log('PASS actual Git untracked additions and staged full-file deletions');
 } finally {
  service.dispose();
  if(dirname(resolve(directory))!==resolve(tmpdir()) || !basename(directory).startsWith('patchwork-diff-repository-')) throw Error('Unsafe temporary repository cleanup');
  await rm(directory,{recursive:true,force:true});
 }
})();

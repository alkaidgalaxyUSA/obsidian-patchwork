(async () => {
    const plugin = app.plugins.plugins['patchwork-git'];
    if (!plugin || plugin.controller.busy) throw Error('Git is unavailable or busy');
    const context = Array.from({length: 120}, (_, i) => ` unchanged ${i}`).join('\n');
    const raw = 'diff --git a/__pw_diff_fixture__.ts b/__pw_diff_fixture__.ts\n--- a/__pw_diff_fixture__.ts\n+++ b/__pw_diff_fixture__.ts\n@@ -40,125 +90,126 @@\n function sample() {\n- const value = 1;\n+ const value = 2;\n+ // new explanation\n' + context + '\n- removed line\n unchanged boundary\n+ inserted line\n }\n';
    await plugin.controller.openDiffText(raw, 'Diff regression — disposable preview', document, {historical:true, revision:'12345678',baseRevisions:['87654321']});
    const modal = [...plugin.controller.dialogs].find(item => item.title === 'Diff regression — disposable preview');
    window.__pwDiffValidation = {modal, raw};
    await new Promise(resolve => setTimeout(resolve, 250));
    const host = modal.contentEl;
    const result = {changes:host.querySelectorAll('[data-diff-change]').length,connectors:host.querySelectorAll('.pw-diff-connector').length, leftNumbers:[...host.querySelectorAll('.pw-diff-numbers-left .pw-diff-number')].map(el=>el.textContent),rightNumbers:[...host.querySelectorAll('.pw-diff-numbers-right .pw-diff-number')].map(el=>el.textContent), folded:host.querySelectorAll('.pw-diff-expand').length};
    return JSON.stringify(result);
})()

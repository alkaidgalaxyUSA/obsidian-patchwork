import { WidgetType } from "@codemirror/view";
import { MarkdownRenderChild } from "obsidian";

class CodeHeaderWidget extends WidgetType {
    constructor(controller, block, collapsed, headerHidden) {
        super();
        this.controller = controller;
        this.block = block;
        this.collapsed = collapsed;
        this.headerHidden = headerHidden;
    }

    eq(other) {
        return this.block.from === other.block.from && this.block.opening === other.block.opening
            && this.collapsed === other.collapsed && this.headerHidden === other.headerHidden;
    }

    toDOM(view) { return this.controller.createEditorHeader(view, this.block, this.collapsed, this.headerHidden); }
    updateDOM(dom, view) { return this.controller.updateEditorHeader(dom, view, this.block, this.collapsed, this.headerHidden); }
    get estimatedHeight() { return this.headerHidden && !this.collapsed ? 1 : 39.6; }
    ignoreEvent() { return true; }
    destroy(dom) { this.controller.menus.closeForHeader(dom); }
}

class CodeReadingChild extends MarkdownRenderChild {
    constructor(element, cleanup) {
        super(element);
        this.cleanup = cleanup;
    }

    onunload() {
        this.cleanup?.();
        this.cleanup = undefined;
    }
}

class CodeBodyWidget extends WidgetType {
    constructor(controller, block, state) {
        super();
        this.controller = controller;
        this.block = block;
        this.content = state.doc.sliceString(block.contentFrom, block.contentTo);
        this.readOnly = state.readOnly;
    }

    eq(other) {
        return this.block.from === other.block.from && this.block.opening === other.block.opening
            && this.content === other.content && this.readOnly === other.readOnly;
    }

    toDOM(view) { return this.controller.createEditorBody(view, this.block); }
    updateDOM(dom) { return this.controller.updateEditorBody(dom, this.block); }
    get estimatedHeight() { return this.block.options.height || this.content.split("\n").length * this.block.options.font * 1.65 + 21; }
    ignoreEvent() { return true; }
    destroy(dom) { this.controller.bodies.get(dom)?.destroy(); }
}


export { CodeHeaderWidget, CodeBodyWidget, CodeReadingChild };

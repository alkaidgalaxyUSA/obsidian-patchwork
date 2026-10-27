import type { Text } from "@codemirror/state";

export interface SqlSection {
	name: string;
	from: number;
	headerTo: number;
	bodyFrom: number;
	to: number;
}

interface SqlScanState {
	quote: string;
	blockDepth: number;
	dollarQuote: string;
}

// This scans lexical boundaries, not SQL statements: semicolons never split a group.
function scanSqlLine(text: string, state: SqlScanState): void {
	for (let i = 0; i < text.length;) {
		if (state.dollarQuote) {
			const end = text.indexOf(state.dollarQuote, i);
			if (end < 0) return;
			i = end + state.dollarQuote.length;
			state.dollarQuote = "";
			continue;
		}
		if (state.blockDepth) {
			const pair = text.slice(i, i + 2);
			if (pair === "/*") state.blockDepth++;
			if (pair === "*/") state.blockDepth--;
			i += pair === "/*" || pair === "*/" ? 2 : 1;
			continue;
		}
		if (state.quote) {
			if (text[i] === "\\" && state.quote !== "]") {
				i += 2;
				continue;
			}
			if (text[i] !== state.quote) {
				i++;
				continue;
			}
			if (text[i + 1] === state.quote) {
				i += 2;
				continue;
			}
			state.quote = "";
			i++;
			continue;
		}
		if (text.startsWith("--", i)) return;
		if (text.startsWith("/*", i)) {
			state.blockDepth = 1;
			i += 2;
			continue;
		}
		if (text[i] === "$" && (i === 0 || !/[\w$]/.test(text[i - 1]))) {
			const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
			if (delimiter) {
				state.dollarQuote = delimiter[0];
				i += delimiter[0].length;
				continue;
			}
		}
		if (text[i] === "'" || text[i] === '"' || text[i] === "`") state.quote = text[i];
		if (text[i] === "[") state.quote = "]";
		i++;
	}
}

export function parseSqlSections(doc: Text): SqlSection[] {
	const sections: SqlSection[] = [];
	const scan: SqlScanState = { quote: "", blockDepth: 0, dollarQuote: "" };
	let from = 0;
	for (const text of doc.iterLines()) {
		const marker = !scan.quote && !scan.blockDepth && !scan.dollarQuote
			? /^[ \t]*--[ \t]*@section(?:[ \t]+(.*?))?[ \t]*$/i.exec(text)
			: undefined;
		if (marker) {
			const previous = sections[sections.length - 1];
			if (previous) previous.to = from;
			sections.push({
				name: marker[1]?.trim() || "Untitled section",
				from,
				headerTo: from + text.length,
				bodyFrom: Math.min(from + text.length + 1, doc.length),
				to: doc.length,
			});
		} else {
			scanSqlLine(text, scan);
		}
		from += text.length + 1;
	}
	return sections;
}

export function findSqlSection(sections: readonly SqlSection[], position: number, docLength: number): SqlSection | undefined {
	return sections.find(section => position >= section.from &&
		(position < section.to || (position === docLength && section.to === docLength)));
}

export function sqlSectionText(doc: Text, section: SqlSection): string {
	// Remove only blank edge lines, never indentation or comments within the group.
	return doc.sliceString(section.bodyFrom, section.to)
		.replace(/^(?:[ \t]*\r?\n)+/, "")
		.replace(/(?:\r?\n[ \t]*)+$/, "");
}

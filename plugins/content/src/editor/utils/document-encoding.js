import iconv from "iconv-lite";

export const DOCUMENT_ENCODINGS = ["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE", "GBK", "GB2312", "ASCII"];

function validateLegacyBytes(bytes, encoding) {
    if (encoding === "ASCII" && bytes.some(value => value > 0x7f)) throw new Error("The file contains non-ASCII bytes.");
    if (encoding !== "GB2312") return;
    for (let index = 0; index < bytes.length; index++) {
        if (bytes[index] < 0x80) continue;
        const lead = bytes[index], trail = bytes[++index];
        if (lead < 0xa1 || lead > 0xf7 || trail === undefined || trail < 0xa1 || trail > 0xfe) throw new Error("The text contains characters outside GB2312.");
    }
}

export function decodeDocument(bytes, encoding) {
    if (["GBK", "GB2312", "ASCII"].includes(encoding)) {
        validateLegacyBytes(bytes, encoding);
        const decoded = iconv.decode(bytes, encoding);
        const encoded = iconv.encode(decoded, encoding);
        if (encoded.length !== bytes.length || encoded.some((value, index) => value !== bytes[index])) throw new Error("The file cannot be decoded losslessly in this encoding.");
        return decoded;
    }
    const label = encoding === "UTF-16 LE" ? "utf-16le" : encoding === "UTF-16 BE" ? "utf-16be" : "utf-8";
    return new TextDecoder(label, { fatal: true }).decode(bytes);
}

export function encodeDocument(text, encoding) {
    if (!DOCUMENT_ENCODINGS.includes(encoding)) throw new Error("Unsupported file encoding.");
    let bytes;
    if (["GBK", "GB2312", "ASCII"].includes(encoding)) {
        const encoded = iconv.encode(text, encoding);
        bytes = new Uint8Array(encoded);
        validateLegacyBytes(bytes, encoding);
    } else if (encoding.startsWith("UTF-16")) {
        bytes = new Uint8Array(2 + text.length * 2);
        const littleEndian = encoding === "UTF-16 LE";
        const view = new DataView(bytes.buffer);
        view.setUint16(0, 0xfeff, littleEndian);
        for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), littleEndian);
    } else {
        const body = new TextEncoder().encode(text);
        bytes = encoding === "UTF-8 BOM" ? new Uint8Array(body.length + 3) : body;
        if (encoding === "UTF-8 BOM") { bytes.set([0xef, 0xbb, 0xbf]); bytes.set(body, 3); }
    }
    if (decodeDocument(bytes, encoding) !== text) throw new Error("The text cannot be represented losslessly in this encoding.");
    return bytes.buffer;
}

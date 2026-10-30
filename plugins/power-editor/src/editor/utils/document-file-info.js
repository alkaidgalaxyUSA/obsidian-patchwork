import { promises as fs } from "fs";

/** Read the filesystem flag and identify Unicode text without changing the file. */
export async function documentFileInfo(path, previous) {
    const stat = await fs.stat(path);
    const signature = `${stat.mtimeMs}:${stat.size}`;
    const readOnly = (stat.mode & 0o200) === 0;
    if (previous?.signature === signature) return { ...previous, readOnly, mode: stat.mode };
    const handle = await fs.open(path, "r");
    try {
        const bytes = new Uint8Array(Math.min(stat.size, 65536));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const data = bytes.subarray(0, bytesRead);
        return { signature, readOnly, mode: stat.mode, encoding: documentEncoding(data, stat.size > bytesRead) };
    } finally { await handle.close(); }
}

export function documentEncoding(bytes, partial = false) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) return "UTF-32 LE";
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) return "UTF-32 BE";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "UTF-16 LE";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "UTF-16 BE";
    if (bytes.includes(0)) return "Binary";
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: partial });
        return "UTF-8";
    } catch { return "Unknown"; }
}

export async function setDocumentReadOnly(path, readOnly) {
    const stat = await fs.stat(path);
    await fs.chmod(path, readOnly ? stat.mode & ~0o222 : stat.mode | 0o200);
    const updated = await fs.stat(path);
    if (((updated.mode & 0o200) === 0) !== readOnly) throw new Error("The file attribute could not be changed.");
}

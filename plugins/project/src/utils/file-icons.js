import { fileTypeIcon } from "../../../utils/file-icons";

/** Explorer file icons depend on file type, never on note contents. */
export function explorerFileIcon(path) {
    const typeIcon = fileTypeIcon(path);
    if (typeIcon) return typeIcon;
    const extension = path.split(".").pop().toLowerCase();
    if (["mdenc", "encrypted"].includes(extension)) return "file-lock";
    if (["md", "mdx", "markdown", "txt"].includes(extension)) return "file-text";
    if (["js", "jsx", "ts", "tsx", "java", "py", "rs", "go", "html", "css", "scss", "vue", "svelte", "sh", "ps1"].includes(extension)) return "file-code";
    if (["json", "yaml", "yml", "toml", "xml", "ini"].includes(extension)) return "file-json";
    if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(extension)) return "file-image";
    if (["mp3", "wav", "ogg", "flac"].includes(extension)) return "file-audio";
    if (["mp4", "mov", "webm"].includes(extension)) return "file-video";
    if (["zip", "gz", "7z", "tar"].includes(extension)) return "file-archive";
    if (extension === "pdf") return "file-type";
    return "file";
}

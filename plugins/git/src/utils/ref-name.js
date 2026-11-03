/** UI validation for literal names under refs/heads or refs/tags; Git rechecks on execution. */
export function refNameError(name) {
    if (!name) return "Enter a name.";
    if (name.startsWith("-") || name.endsWith(".") || name.includes("..") || name.includes("@{")
        || /[\x00-\x20\x7f~^:?*\[\\]/.test(name)
        || name.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".lock"))) return "Enter a valid Git reference name.";
    return "";
}

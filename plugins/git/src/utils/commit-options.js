/** Git flags shared by staged and private-index commits. No shell interpolation. */
export function commitArguments(message, amend, options = {}) {
    const author = typeof options.author === "string" ? options.author.trim() : "";
    if (author && (!/^[^<>\r\n\x00]+ <[^<>\s\x00]+>$/.test(author))) {
        throw new Error("Enter the author as Name <email>.");
    }
    return ["commit", ...(amend ? ["--amend"] : []), ...(options.signOff ? ["--signoff"] : []),
        ...(options.runHooks === false ? ["--no-verify"] : []), ...(author ? [`--author=${author}`] : []), "-m", message];
}

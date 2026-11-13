import { diffBlocks } from "../history/utils/diff-blocks";

export function differenceCount(file) {
    return (file?.hunks ?? []).reduce((total, hunk) => total + diffBlocks(hunk).filter(block => block.type !== "context").length, 0);
}

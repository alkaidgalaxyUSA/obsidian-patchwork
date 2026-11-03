import { computeGraphLayout, topologicalCommits } from "./graph-layout";
import type { CommitInfo, GraphEdge } from "../types";

const HEIGHT = 30;
const CHUNK = 64;

/** Slice upstream topology into Patchwork's log row cells. */
export function createGraphRows(commits: CommitInfo[]) {
    const ordered = topologicalCommits(commits);
    const graph = computeGraphLayout(ordered);
    const positions = new Map(commits.map((commit, index) => [commit.hash, index]));
    graph.edges = graph.edges.map(edge => ({ ...edge, fromRow: positions.get(ordered[edge.fromRow].hash)!, toRow: positions.get(ordered[edge.toRow].hash)! }));
    graph.nodes.sort((left, right) => positions.get(left.commit.hash)! - positions.get(right.commit.hash)!);
    const buckets = new Map<number, GraphEdge[]>();
    for (const edge of graph.edges) {
        for (let chunk = Math.floor(Math.min(edge.fromRow, edge.toRow) / CHUNK); chunk <= Math.floor(Math.max(edge.fromRow, edge.toRow) / CHUNK); chunk++) {
            let entries = buckets.get(chunk);
            if (!entries) { entries = []; buckets.set(chunk, entries); }
            entries.push(edge);
        }
    }
    const width = Math.max(28, graph.maxColumns * 14 + 12);
    const x = (column: number) => 12 + column * 14;
    return {
        width,
        height: HEIGHT,
        row(index: number) {
            const node = graph.nodes[index];
            const paths = (buckets.get(Math.floor(index / CHUNK)) ?? [])
                .filter(edge => Math.min(edge.fromRow, edge.toRow) <= index && Math.max(edge.fromRow, edge.toRow) >= index)
                .map(edge => {
                    const x1 = x(edge.fromCol), x2 = x(edge.toCol);
                    const y1 = edge.fromRow * HEIGHT + HEIGHT / 2, y2 = edge.toRow * HEIGHT + HEIGHT / 2;
                    const bend = Math.min(HEIGHT * 1.5, Math.abs(y2 - y1) * 0.4);
                    return { color: edge.color, d: x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${y1 + Math.sign(y2 - y1) * bend} ${x2} ${y2 - Math.sign(y2 - y1) * bend} ${x2} ${y2}` };
                });
            return { column: node.column, color: node.color, paths, y: index * HEIGHT + HEIGHT / 2, offset: index * HEIGHT };
        },
    };
}

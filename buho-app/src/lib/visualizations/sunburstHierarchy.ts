import type { ArtistSunburstRow } from '#lib/data/queries/artistQueries.ts';

export interface SunburstNode {
    /**
     * Identity AND cross-filter value: the sunburst sets `filterKey = name`, so
     * this must be the value the data actually carries, never a prettified one.
     * Use `label` for display.
     */
    name: string;
    /** What to show instead of `name`, when the stored value isn't presentable. */
    label?: string;
    /** Rebuilt from a public identifier; lets a leaf be opened externally. */
    href?: string | null;
    isOther?: boolean;
    playCount?: number;
    value?: number;
    trackUri?: string | null; // carried by the "track" leaves to open on Spotify
    filterKey?: string; // explicit cross-filter dimension (geo: levels can be skipped, so depth ≠ key)
    children?: SunburstNode[];
}

/** What an arc's angle counts: listening time, or number of plays. */
export type PlayMeasure = 'minutes' | 'plays';

const OTHER_NAMES = ['Other artists', 'Other albums', 'Other tracks'];
const THRESHOLD_DEGREES = 0.5; // Bucketing threshold in degrees (share of parent < ½/360 ⇒ "Other")
/**
 * Transforms the flat artist/album/track rows (un-bucketed) into a full tree for
 * d3.hierarchy. The "Other" grouping is done afterwards by bucketByDegree.
 *
 * `measure` decides what a leaf weighs, and so what the whole ring ranks by: a
 * long track played twice outweighs a short one played often by time, and loses
 * by plays. `playCount` rides along either way so a tooltip can show both — and
 * so a play whose duration was never recorded still counts in "plays" mode.
 */
export function buildSunburstHierarchy(
    data: ArtistSunburstRow[],
    measure: PlayMeasure = 'minutes'
): SunburstNode {
    const root: SunburstNode = { name: 'All artists', children: [] };
    const artists = new Map<string, SunburstNode>();
    const albums = new Map<string, SunburstNode>();

    for (const row of data) {
        let artistNode = artists.get(row.artist);
        if (!artistNode) {
            artistNode = { name: row.artist, children: [] };
            artists.set(row.artist, artistNode);
            root.children!.push(artistNode);
        }
        const albumKey = JSON.stringify([row.artist, row.album]);
        let albumNode = albums.get(albumKey);
        if (!albumNode) {
            albumNode = { name: row.album, children: [] };
            albums.set(albumKey, albumNode);
            artistNode.children!.push(albumNode);
        }
        albumNode.children!.push({
            name: row.track,
            value: measure === 'plays' ? row.playCount : row.minutes,
            playCount: row.playCount,
            trackUri: row.trackUri,
        });
    }
    return root;
}

/** Total minutes of a subtree (values are carried only by the leaves). */
export function nodeTotal(node: SunburstNode): number {
    if (!node.children) return node.value ?? 0;
    return node.children.reduce((sum, child) => sum + nodeTotal(child), 0);
}

function nodePlays(node: SunburstNode): number {
    if (!node.children) return node.playCount ?? 0;
    return node.children.reduce((sum, child) => sum + nodePlays(child), 0);
}

/**
 * Folds, at each level, the children that weigh less than 1° of their parent's
 * circle (share < total(parent) / 360) into an "Other …" leaf. The threshold is
 * therefore relative to the parent: since a zoomed node fills the whole circle,
 * "share of parent < 1/360" is equivalent to "less than 1° of the displayed view"
 * once zoomed.
 *
 * The bucketing is static (computed once), which lets us keep ONE fixed partition
 * and thus the classic d3 zoom transition (current → target interpolation),
 * instead of rebuilding the tree on every click.
 *
 * `level` is the depth of the processed children (0 = artists, 1 = albums, …),
 * used to name the bucket.
 */
export function bucketByDegree(
    node: SunburstNode,
    level = 0,
    otherNames: string[] = OTHER_NAMES
): SunburstNode {
    if (!node.children) return { ...node };

    const threshold = (nodeTotal(node) / 360) * THRESHOLD_DEGREES;
    const kept: SunburstNode[] = [];
    let otherMinutes = 0;
    let otherPlays = 0;
    for (const child of node.children) {
        const childTotal = nodeTotal(child);
        if (childTotal < threshold) {
            otherMinutes += childTotal;
            otherPlays += nodePlays(child);
        } else {
            kept.push(bucketByDegree(child, level + 1, otherNames));
        }
    }
    if (otherMinutes > 0) {
        kept.push({
            name: otherNames[Math.min(level, otherNames.length - 1)] ?? 'Other',
            isOther: true,
            value: otherMinutes,
            playCount: otherPlays,
        });
    }
    return { ...node, children: kept };
}

/**
 * Build a hierarchy from rows that carry an ordered list of `levels`, each a
 * `{ name, key }` pair, plus a `value`. The caller passes only the levels it
 * wants (skipping absent ones), so a foreign point can be
 * country → region → city even though it has no department in between — the
 * level's `key` (not its depth) drives cross-filtering. A node that is BOTH a
 * destination (rows end there) and a parent (deeper rows exist) gets a
 * placeholder "—" leaf for its direct value, so d3.sum (leaves only) doesn't
 * drop it. Generic counterpart of buildSunburstHierarchy, used by the Google
 * Maps geo sunburst.
 */
export interface PathLevel {
    name: string;
    /** Display text; `name` stays the filter value. */
    label?: string;
    key?: string; // the cross-filter dimension this level belongs to
}
export interface PathRow {
    levels: PathLevel[];
    value: number;
    /** Optional external link for the destination node, surfaced via onLeafOpen. */
    href?: string | null;
}

export function buildPathHierarchy(rows: PathRow[], rootName: string): SunburstNode {
    const root: SunburstNode = { name: rootName, children: [] };
    const nodeByKey = new Map<string, SunburstNode>([['', root]]);

    for (const row of rows) {
        const levels = row.levels.filter((l) => l && l.name != null && l.name !== '');
        if (levels.length === 0) continue;

        let parent = root;
        // The key grows one segment at a time rather than being re-serialised at
        // every level: a large hierarchy walks hundreds of thousands of levels,
        // and JSON.stringify over a growing array dominated the build. NUL can't
        // appear in a level name, so it can't collide.
        let prefix = '';
        for (const level of levels) {
            prefix += '\u0000' + level.name;
            let node = nodeByKey.get(prefix);
            if (!node) {
                node = {
                    name: level.name,
                    label: level.label,
                    filterKey: level.key,
                    children: [],
                };
                nodeByKey.set(prefix, node);
                parent.children!.push(node);
            }
            parent = node;
        }
        parent.value = (parent.value ?? 0) + row.value;
        // First one wins: rows sharing a destination are the same subject seen
        // several times, so any of their links points at it.
        if (row.href && !parent.href) parent.href = row.href;
    }

    normalizePathNode(root);
    // The root stays a container even when empty (normalize would otherwise turn
    // a childless node into a leaf).
    if (!root.children) root.children = [];
    return root;
}

/** Turn empty-children nodes into leaves; split mixed nodes via a "—" leaf. */
function normalizePathNode(node: SunburstNode): void {
    if (!node.children || node.children.length === 0) {
        node.children = undefined;
        return;
    }
    if (node.value && node.value > 0) {
        node.children.push({ name: '—', value: node.value });
        node.value = undefined;
    }
    for (const child of node.children) normalizePathNode(child);
}

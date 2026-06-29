import type { ArtistSunburstRow } from '$lib/data/queries/artistQueries';

export interface SunburstNode {
    name: string;
    isOther?: boolean;
    playCount?: number;
    value?: number;
    trackUri?: string | null; // carried by the "track" leaves to open on Spotify
    children?: SunburstNode[];
}

const OTHER_NAMES = ['Other artists', 'Other albums', 'Other tracks'];
const THRESHOLD_DEGREES = 0.5; // Bucketing threshold in degrees (share of parent < ½/360 ⇒ "Other")
/**
 * Transforms the flat artist/album/track rows (un-bucketed) into a full tree for
 * d3.hierarchy. The "Other" grouping is done afterwards by bucketByDegree.
 */
export function buildSunburstHierarchy(data: ArtistSunburstRow[]): SunburstNode {
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
            value: row.minutes,
            playCount: row.playCount,
            trackUri: row.trackUri
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

    const threshold = nodeTotal(node) / 360 * THRESHOLD_DEGREES;
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
            playCount: otherPlays
        });
    }
    return { ...node, children: kept };
}

/**
 * Build a hierarchy from rows that carry an ordered `path` of level values plus
 * a `value`. Levels may be null (e.g. a foreign point has a country but no
 * region): the path is followed only up to the first null, and the value lands
 * on the deepest known node. A node that is BOTH a destination (rows end there)
 * and a parent (deeper rows exist) gets a placeholder "—" leaf for its direct
 * value, so d3.sum (leaves only) doesn't drop it. Generic counterpart of
 * buildSunburstHierarchy, used by the Google Maps geo sunburst.
 */
export interface PathRow {
    path: (string | null | undefined)[];
    value: number;
}

export function buildPathHierarchy(rows: PathRow[], rootName: string): SunburstNode {
    const root: SunburstNode = { name: rootName, children: [] };
    const nodeByKey = new Map<string, SunburstNode>([['', root]]);

    for (const row of rows) {
        const known: string[] = [];
        for (const level of row.path) {
            if (level === null || level === undefined || level === '') break;
            known.push(level);
        }
        if (known.length === 0) continue;

        let parent = root;
        const prefix: string[] = [];
        for (const name of known) {
            prefix.push(name);
            const key = JSON.stringify(prefix);
            let node = nodeByKey.get(key);
            if (!node) {
                node = { name, children: [] };
                nodeByKey.set(key, node);
                parent.children!.push(node);
            }
            parent = node;
        }
        parent.value = (parent.value ?? 0) + row.value;
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

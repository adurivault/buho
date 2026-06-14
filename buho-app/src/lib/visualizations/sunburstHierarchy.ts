import type { ArtistSunburstRow } from '$lib/data/queries/artistQueries';

export interface SunburstNode {
    name: string;
    isOther?: boolean;
    playCount?: number;
    value?: number;
    trackUri?: string | null; // porté par les feuilles "titre" pour ouvrir sur Spotify
    children?: SunburstNode[];
}

const OTHER_NAMES = ['Other artists', 'Other albums', 'Other tracks'];
const THRESHOLD_DEGREES = 0.5; // Seuil de bucketing en degrés (part du parent < ½/360 ⇒ "Other")
/**
 * Transforme les lignes plates artiste/album/titre (non bucketées) en arbre
 * complet pour d3.hierarchy. Le regroupement "Other" est fait ensuite par
 * bucketByDegree.
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

/** Total des minutes d'un sous-arbre (les valeurs ne sont portées que par les feuilles). */
export function nodeTotal(node: SunburstNode): number {
    if (!node.children) return node.value ?? 0;
    return node.children.reduce((sum, child) => sum + nodeTotal(child), 0);
}

function nodePlays(node: SunburstNode): number {
    if (!node.children) return node.playCount ?? 0;
    return node.children.reduce((sum, child) => sum + nodePlays(child), 0);
}

/**
 * Replie, à chaque niveau, les enfants qui pèsent moins d'1° du cercle de leur
 * parent (part < total(parent) / 360) dans une feuille "Other …". Le seuil est
 * donc relatif au parent : comme un nœud zoomé occupe tout le cercle, "part du
 * parent < 1/360" équivaut à "moins d'1° de la vue affichée" une fois zoomé.
 *
 * Le bucketing est statique (calculé une seule fois), ce qui permet de garder
 * UNE partition fixe et donc la transition de zoom d3 classique (interpolation
 * current → target), au lieu de reconstruire l'arbre à chaque clic.
 *
 * `level` est la profondeur des enfants traités (0 = artistes, 1 = albums, …),
 * utilisée pour nommer le bucket.
 */
export function bucketByDegree(node: SunburstNode, level = 0): SunburstNode {
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
            kept.push(bucketByDegree(child, level + 1));
        }
    }
    if (otherMinutes > 0) {
        kept.push({
            name: OTHER_NAMES[Math.min(level, OTHER_NAMES.length - 1)],
            isOther: true,
            value: otherMinutes,
            playCount: otherPlays
        });
    }
    return { ...node, children: kept };
}

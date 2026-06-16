import yaml from 'js-yaml';
import { MapMetadata, Waypoint, rectToPoints } from '../types';

interface ImportedConfig {
    map_metadata?: {
        image_path: string;
        resolution: number;
        width_pixels: number;
        height_pixels: number;
        origin_pixel: [number, number];
    };
    waypoints?: Array<{
        name: string;
        pixel: [number, number];
        world: [number, number];
    }>;
    decision_tree?: any;
    zones?: any[];
}

interface ImportResult {
    metadata: MapMetadata;
    waypoints: Waypoint[];
    zones: any[];
    decisionNodes: any[];
}

/**
 * Parse YAML config file and return structured data
 */
export function importFromYaml(yamlContent: string): ImportResult {
    const config = yaml.load(yamlContent) as ImportedConfig;

    if (!config) {
        throw new Error('YAML 文件为空');
    }

    // Parse map metadata
    const meta = config.map_metadata;
    const metadata: MapMetadata = {
        imagePath: meta?.image_path || '',
        resolution: meta?.resolution || 0.05,
        widthPixels: meta?.width_pixels || 0,
        heightPixels: meta?.height_pixels || 0,
        originPixel: meta?.origin_pixel
            ? { u: meta.origin_pixel[0], v: meta.origin_pixel[1] }
            : null
    };

    // Parse waypoints
    const waypoints: Waypoint[] = (config.waypoints || []).map(wp => ({
        name: wp.name,
        pixel: { u: wp.pixel[0], v: wp.pixel[1] },
        world: { x: wp.world[0], y: wp.world[1] }
    }));

    // Parse decision tree from behavior tree format into canvas nodes
    const decisionNodes: any[] = [];
    const tree = config.decision_tree;
    if (tree && Object.keys(tree).length > 0) {
        const root = tree.root || tree;  // handle both { root: {...} } and direct tree
        parseBehaviorTree(root, decisionNodes);
    }

    // Parse zones and recreate zone nodes if they have canvas positions or logic
    // Normalize zones: convert old rect-only format to polygon format
    const zones = (config.zones || []).map(normalizeZone);
    zones.forEach((z, idx) => {
        const hasLogic = z.action || (z.conditions && z.conditions.length > 0) || (z.params && z.params.length > 0);
        const hasPos = z.canvasX !== undefined && z.canvasY !== undefined;

        if (hasPos || hasLogic) {
            // Check if it's already there (rare if YAML is clean)
            const exists = decisionNodes.find(n => n.type === 'zone' && (n.data.zone_id === z.id || n.data.zone_name === z.name));
            if (!exists) {
                decisionNodes.push({
                    id: `zone-import-${z.id || idx}`,
                    type: 'zone',
                    x: z.canvasX ?? (100 + (idx * 250)),
                    y: z.canvasY ?? 50,
                    data: {
                        zone_id: z.id,
                        zone_name: z.name,
                        action: z.action || null,
                        conditions: z.conditions || [],
                        params: z.params || [],
                        priority: z.priority ?? 1
                    },
                    children: []
                });
            }
        }
    });

    return { metadata, waypoints, zones, decisionNodes };
}

// ─── Zone normalization (backward compat) ────────────────────────────────

/**
 * Normalize a zone: if it only has rect/worldRect (old format),
 * convert to polygon format by adding points/worldPoints.
 */
function normalizeZone(z: any): any {
    // If zone already has points, keep them
    if (z.points && z.points.length >= 6) {
        return z;
    }
    // Convert from rect (backward compat)
    if (z.rect) {
        return {
            ...z,
            points: rectToPoints(z.rect),
            worldPoints: z.worldRect ? rectToPoints(z.worldRect) : [],
        };
    }
    return z;
}

// ─── Trie-based node merging ───────────────────────────────────────────────

/**
 * A trie node representing one YAML tree node.
 * Children with the same "key" are merged into the same TrieNode,
 * thus preserving shared condition prefixes as a single canvas node.
 */
interface TrieNode {
    key: string;            // unique key for dedup (e.g. "Condition:game_progress:>=:4")
    treeNode: any;          // original YAML tree node data
    children: TrieNode[];   // ordered children (deduped by key)
    priority: number;       // min priority seen across all paths containing this node
}

/**
 * Compute a dedup key for a YAML tree node.
 * Nodes with the same key at the same position in the path will be merged.
 */
function getNodeKey(node: any): string {
    if (node.type === 'Condition') {
        return `Condition:${node.field}:${node.operator}:${node.threshold}:${node.value_type || 'uint16'}`;
    }
    if (node.type === 'Param') {
        return `Param:${node.node_name}:${node.param_name}:${node.param_value}:${node.param_type}`;
    }
    // Action – include action name, actions list, loop, exit_condition for uniqueness
    const actionsKey = node.actions ? node.actions.join(',') : '';
    const loopKey = node.loop ? '1' : '0';
    const exitKey = node.exit_condition
        ? `${node.exit_condition.field}:${node.exit_condition.operator}:${node.exit_condition.threshold}`
        : '';
    return `Action:${node.action}:${actionsKey}:${loopKey}:${exitKey}`;
}

function getZoneNodeKey(node: any): string {
    return `Zone:${node.zone_id}`;
}

/**
 * Insert a path (sequence of YAML tree nodes) into the trie.
 * Shared prefixes are merged by key.
 */
function insertPath(root: TrieNode, path: any[], priority: number): void {
    let current = root;
    for (const node of path) {
        let key = '';
        if (node.type === 'Zone') {
            key = getZoneNodeKey(node);
        } else {
            key = getNodeKey(node);
        }
        let child = current.children.find(c => c.key === key);
        if (!child) {
            child = {
                key,
                treeNode: node,
                children: [],
                priority
            };
            current.children.push(child);
        } else {
            // Update to the minimum priority seen
            child.priority = Math.min(child.priority, priority);
        }
        current = child;
    }
}

let nodeCounter = 0;

/**
 * Convert behavior tree (Selector/Sequence) back to editor canvas nodes.
 * Uses Trie merging to preserve shared condition nodes.
 */
function parseBehaviorTree(root: any, nodes: any[]): void {
    nodeCounter = 0;

    if (root.type === 'Selector' && root.children) {
        // Build a virtual trie root
        const trieRoot: TrieNode = {
            key: '__root__',
            treeNode: null,
            children: [],
            priority: 0
        };

        // Each child Sequence is a path to insert into the trie
        root.children.forEach((seq: any, seqIdx: number) => {
            if (seq.type === 'Sequence' && seq.children) {
                const priority = seq.priority !== undefined ? seq.priority : seqIdx + 1;
                insertPath(trieRoot, seq.children, priority);
            }
        });

        // Convert trie to canvas nodes with tree layout
        const layout = computeLayout(trieRoot);
        trieToCanvasNodes(trieRoot, nodes, null, layout);

    } else if (root.type === 'Sequence' && root.children) {
        // Single sequence – no merging needed, just create chain
        parseSequenceBranch(root.children, nodes, 0, null);
    } else if (root.type === 'Condition' || root.type === 'Action') {
        createCanvasNodeSimple(root, nodes, null, 0, 0);
    }
}

// ─── Tree layout computation ───────────────────────────────────────────────

interface LayoutInfo {
    /** Map from trie node (by reference) to { x, y } center position */
    positions: Map<TrieNode, { x: number; y: number }>;
}

const LAYOUT_X_GAP = 240;   // horizontal gap between siblings
const LAYOUT_Y_GAP = 130;   // vertical gap between depth levels
const LAYOUT_X_START = 100; // left offset
const LAYOUT_Y_START = 60;  // top offset

/**
 * Compute the width (number of leaf descendants) of each trie node.
 */
function subtreeWidth(node: TrieNode): number {
    if (node.children.length === 0) return 1;
    return node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
}

/**
 * Compute x,y positions for every trie node using a simple top-down layout.
 * The root's children are placed at depth 0, centered horizontally.
 */
function computeLayout(trieRoot: TrieNode): LayoutInfo {
    const positions = new Map<TrieNode, { x: number; y: number }>();

    // Total width in "leaf units" (computed for reference / future use)
    const _totalWidth = subtreeWidth(trieRoot); void _totalWidth;

    function layoutSubtree(node: TrieNode, depth: number, leftOffset: number) {
        const width = subtreeWidth(node);
        const centerX = LAYOUT_X_START + (leftOffset + width / 2) * LAYOUT_X_GAP;
        const y = LAYOUT_Y_START + depth * LAYOUT_Y_GAP;

        if (node.key !== '__root__') {
            positions.set(node, { x: centerX - 100, y }); // -100 to center the node (NODE_WIDTH/2)
        }

        let childLeft = leftOffset;
        for (const child of node.children) {
            const childWidth = subtreeWidth(child);
            layoutSubtree(child, node.key === '__root__' ? depth : depth + 1, childLeft);
            childLeft += childWidth;
        }
    }

    layoutSubtree(trieRoot, 0, 0);
    return { positions };
}

/**
 * Convert the merged trie into canvas nodes, using computed layout positions.
 */
function trieToCanvasNodes(
    trieNode: TrieNode,
    nodes: any[],
    parentId: string | null,
    layout: LayoutInfo
): void {
    for (const child of trieNode.children) {
        const nodeId = createCanvasNodeFromTrie(child, nodes, parentId, layout);
        // Recurse into children
        trieToCanvasNodes(child, nodes, nodeId, layout);
    }
}

/**
 * Create a single canvas node from a trie node.
 */
function createCanvasNodeFromTrie(
    trieNode: TrieNode,
    nodes: any[],
    parentId: string | null,
    layout: LayoutInfo
): string {
    const nodeId = `node-import-${++nodeCounter}`;
    const tn = trieNode.treeNode;
    const nodeType = tn.type;
    const isCondition = nodeType === 'Condition';
    const isParam = nodeType === 'Param';
    const isZone = nodeType === 'Zone';

    let data: any;
    if (isCondition) {
        data = {
            field: tn.field || 'own_robot_hp',
            value_type: tn.value_type || 'uint16',
            operator: tn.operator || '>',
            threshold: tn.threshold ?? 0,
            priority: trieNode.priority,
            loop: tn.loop || false
        };
    } else if (isParam) {
        data = {
            param_name: tn.param_name || '',
            param_value: tn.param_value || '',
            param_type: tn.param_type || '',
            node_name: tn.node_name || ''
        };
    } else if (isZone) {
        data = {
            zone_id: tn.zone_id,
            zone_name: tn.zone_name,
            action: tn.action || null,
            conditions: tn.conditions || [],
            params: tn.params || [],
            priority: tn.priority ?? 1
        };
    } else {
        // Default to Action
        // Only set `actions` field if the YAML actually has a non-empty actions array.
        // An empty `actions: []` would be truthy and trick the UI into multi-action-group mode.
        const primaryAction = (tn.actions && tn.actions.length > 0) ? tn.actions[0] : (tn.action || 'STOP');
        data = {
            action: primaryAction,
            loop: tn.loop || false,
            duration: tn.duration || 0,
            exit_condition: tn.exit_condition || null
        };
        if (tn.actions && tn.actions.length > 0) {
            data.actions = tn.actions;
        }
    }

    const pos = layout.positions.get(trieNode) || { x: 300, y: 100 };

    const node: any = {
        id: nodeId,
        type: isCondition ? 'condition' : isParam ? 'param' : isZone ? 'zone' : 'action',
        x: pos.x,
        y: pos.y,
        data,
        children: [] as string[]
    };

    nodes.push(node);

    // Link parent to this node
    if (parentId) {
        const parent = nodes.find((n: any) => n.id === parentId);
        if (parent) {
            parent.children.push(nodeId);
        }
    }

    return nodeId;
}

// ─── Fallback for single Sequence (no merging needed) ──────────────────────

function parseSequenceBranch(
    children: any[],
    nodes: any[],
    priority: number,
    parentId: string | null
): void {
    let currentParentId = parentId;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const nodeId = createCanvasNodeSimple(child, nodes, currentParentId, i, priority);
        currentParentId = nodeId;
    }
}

function createCanvasNodeSimple(
    treeNode: any,
    nodes: any[],
    parentId: string | null,
    depthOrIndex: number,
    priority: number
): string {
    const nodeId = `node-import-${++nodeCounter}`;
    const nodeType = treeNode.type;
    const isCondition = nodeType === 'Condition';
    const isParam = nodeType === 'Param';
    const isZone = nodeType === 'Zone';

    let data: any;
    if (isCondition) {
        data = {
            field: treeNode.field || 'own_robot_hp',
            value_type: treeNode.value_type || 'uint16',
            operator: treeNode.operator || '>',
            threshold: treeNode.threshold ?? 0,
            priority: priority,
            loop: treeNode.loop || false
        };
    } else if (isParam) {
        data = {
            param_name: treeNode.param_name || '',
            param_value: treeNode.param_value || '',
            param_type: treeNode.param_type || '',
            node_name: treeNode.node_name || ''
        };
    } else if (isZone) {
        data = {
            zone_id: treeNode.zone_id,
            zone_name: treeNode.zone_name,
            action: treeNode.action || null,
            conditions: treeNode.conditions || [],
            params: treeNode.params || [],
            priority: treeNode.priority ?? 1
        };
    } else {
        // Only set `actions` field if the YAML actually has a non-empty actions array.
        const primaryAction = (treeNode.actions && treeNode.actions.length > 0) ? treeNode.actions[0] : (treeNode.action || 'STOP');
        data = {
            action: primaryAction,
            loop: treeNode.loop || false,
            duration: treeNode.duration || 0,
            exit_condition: treeNode.exit_condition || null
        };
        if (treeNode.actions && treeNode.actions.length > 0) {
            data.actions = treeNode.actions;
        }
    }

    const node: any = {
        id: nodeId,
        type: isCondition ? 'condition' : isParam ? 'param' : isZone ? 'zone' : 'action',
        x: 200 + (priority * 280),
        y: 60 + depthOrIndex * 140,
        data,
        children: [] as string[]
    };

    nodes.push(node);

    if (parentId) {
        const parent = nodes.find((n: any) => n.id === parentId);
        if (parent) {
            parent.children.push(nodeId);
        }
    }

    if (treeNode.children && Array.isArray(treeNode.children)) {
        treeNode.children.forEach((child: any, idx: number) => {
            createCanvasNodeSimple(child, nodes, nodeId, depthOrIndex + 1, idx);
        });
    }

    return nodeId;
}

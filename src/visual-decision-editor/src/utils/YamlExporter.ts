import yaml from 'js-yaml';
import { MapMetadata, Waypoint } from '../types';

/**
 * Export complete configuration to YAML format
 */
export function exportToYaml(
    metadata: MapMetadata,
    waypoints: Waypoint[],
    nodes: any[],
    zones: ZoneRule[] = []
): string {
    if (!metadata.originPixel) {
        throw new Error('Origin must be set before exporting');
    }

    // Sync zone nodes data from canvas back to the zones definition list
    const updatedZones = zones.map(z => {
        const zoneNode = nodes.find(n => n.type === 'zone' && n.data.zone_id === z.id);
        if (zoneNode) {
            return {
                ...z,
                action: zoneNode.data.action || null,
                conditions: zoneNode.data.conditions || [],
                params: zoneNode.data.params || [],
                priority: zoneNode.data.priority ?? z.priority,
                canvasX: zoneNode.x,
                canvasY: zoneNode.y
            };
        }
        return z;
    });

    const config: any = {
        topic: {
            name: '/referee',
            type: 'sentry_msgs/msg/Referee'
        },
        map_metadata: {
            image_path: metadata.imagePath,
            resolution: metadata.resolution,
            width_pixels: metadata.widthPixels,
            height_pixels: metadata.heightPixels,
            origin_pixel: [metadata.originPixel.u, metadata.originPixel.v]
        },
        waypoints: waypoints.map(wp => ({
            name: wp.name,
            pixel: [wp.pixel.u, wp.pixel.v],
            world: [wp.world.x, wp.world.y]
        })),
        zones: updatedZones,
        decision_tree: nodes.length > 0 ? buildDecisionTree(nodes) : {}
    };

    return yaml.dump(config, {
        indent: 2,
        lineWidth: 100,
        noRefs: true
    });
}

/**
 * Build behavior tree structure from canvas nodes.
 * Converts the editor's condition→action tree into Selector/Sequence format
 * compatible with the C++ decision_executor.
 *
 * Output format:
 * root:
 *   type: Selector
 *   children:
 *     - type: Sequence
 *       children: [Condition, ..., Action]
 */
function buildDecisionTree(nodes: any[]): any {
    // Find root nodes (nodes that are not children of any other node)
    const allChildIds = new Set(nodes.flatMap((n: any) => n.children || []));
    const rootNodes = nodes.filter((n: any) => !allChildIds.has(n.id));

    if (rootNodes.length === 0) {
        return {};
    }

    // Collect all paths (each path is an ordered list of sequence items)
    const paths: {
        items: any[];   // ordered sequence children in actual tree order
        priority: number;
    }[] = [];
    for (const root of rootNodes) {
        collectPaths(root, nodes, [], paths);
    }

    // Sort paths by priority
    paths.sort((a, b) => a.priority - b.priority);

    // Build Selector with Sequence children
    return {
        root: {
            type: 'Selector',
            children: paths.map((path) => ({
                type: 'Sequence',
                priority: path.priority,
                children: path.items
            }))
        }
    };
}

/**
 * Recursively collect all paths from the tree in actual node order.
 * `currentItems` accumulates the sequence children in DFS order.
 */
function collectPaths(
    node: any,
    allNodes: any[],
    currentItems: any[],
    paths: { items: any[]; priority: number }[]
): void {
    if (node.type === 'action') {
        // In multi-action group mode `node.data.action` may be stale/undefined;
        // derive it from the first element of the `actions` array as a fallback.
        const primaryAction =
            (node.data.actions && node.data.actions.length > 0)
                ? node.data.actions[0]
                : (node.data.action || 'STOP');
        const actionEntry: any = { type: 'Action', action: primaryAction };
        if (node.data.actions && node.data.actions.length > 0) {
            actionEntry.actions = node.data.actions;
        }
        if (node.data.loop) {
            actionEntry.loop = true;
        }
        if (node.data.duration && node.data.duration > 0) {
            actionEntry.duration = node.data.duration;
        }
        if (node.data.exit_condition) {
            actionEntry.exit_condition = {
                field: node.data.exit_condition.field,
                value_type: node.data.exit_condition.value_type || 'uint16',
                operator: node.data.exit_condition.operator,
                threshold: node.data.exit_condition.threshold
            };
        }

        const newItems = [...currentItems, actionEntry];
        const childIds: string[] = node.children || [];

        if (childIds.length === 0) {
            // Leaf node – compute priority from last condition seen in the path
            const lastCond = [...newItems].reverse().find(i => i.type === 'Condition');
            const priority = lastCond ? (lastCond as any)._priority ?? 1 : 1;
            // Strip internal _priority helper before storing
            const cleanItems = newItems.map(({ _priority, ...rest }: any) => rest);
            paths.push({ items: cleanItems, priority });
            return;
        }
        for (const childId of childIds) {
            const childNode = allNodes.find((n: any) => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
        return;
    }

    if (node.type === 'param') {
        const paramEntry = {
            type: 'Param',
            node_name: node.data.node_name,
            param_name: node.data.param_name,
            param_value: node.data.param_value,
            param_type: node.data.param_type
        };
        const newItems = [...currentItems, paramEntry];
        const childIds: string[] = node.children || [];
        if (childIds.length === 0) {
            // Param is the last node in the chain – record the path
            const lastCond = [...newItems].reverse().find(i => i.type === 'Condition');
            const priority = lastCond ? (lastCond as any)._priority ?? 1 : 1;
            const cleanItems = newItems.map(({ _priority, ...rest }: any) => rest);
            paths.push({ items: cleanItems, priority });
            return;
        }
        for (const childId of childIds) {
            const childNode = allNodes.find((n: any) => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
        return;
    }

    if (node.type === 'condition') {
        const priority = node.data.priority ?? 1;
        // Store _priority as a temporary helper for leaf-node priority calculation
        const condEntry: any = {
            type: 'Condition',
            field: node.data.field,
            value_type: node.data.value_type || 'uint16',
            operator: node.data.operator,
            threshold: node.data.threshold,
            _priority: priority
        };
        const newItems = [...currentItems, condEntry];
        const childIds: string[] = node.children || [];
        for (const childId of childIds) {
            const childNode = allNodes.find((n: any) => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
        return;
    }

    if (node.type === 'zone') {
        const zoneEntry: any = {
            type: 'Zone',
            zone_id: node.data.zone_id,
            zone_name: node.data.zone_name,
            action: node.data.action,
            conditions: node.data.conditions || [],
            params: node.data.params || [],
            _priority: node.data.priority ?? 1
        };
        const newItems = [...currentItems, zoneEntry];
        const childIds: string[] = node.children || [];
        
        if (childIds.length === 0) {
            const priority = zoneEntry._priority;
            const cleanItems = newItems.map(({ _priority, ...rest }: any) => rest);
            paths.push({ items: cleanItems, priority });
            return;
        }

        for (const childId of childIds) {
            const childNode = allNodes.find((n: any) => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
    }
}

/**
 * Download YAML file
 */
export function downloadYaml(content: string, filename: string = 'decision_config.yaml') {
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

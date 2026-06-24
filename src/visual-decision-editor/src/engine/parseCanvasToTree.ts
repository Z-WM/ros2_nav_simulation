import { NodeStatus } from './Status';
import { getFieldValue } from './fieldMapper';
import {
    DecisionNode,
    ConditionNode,
    ActionNode,
    SelectorNode,
    SequenceNode,
    ParamNode,
    ZoneNode,
    ZoneDefinition,
    ExitCondition,
    ParamConfig,
} from './DecisionTreeTypes';
import { Referee } from '../ros/types';
import { ZoneRule, Waypoint, rectToPoints } from '../types';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}-${Date.now()}`;

function buildExitCondition(data: any): ExitCondition | undefined {
    const ec = data?.exit_condition;
    if (!ec || !ec.field) return undefined;
    return {
        field: ec.field,
        op: ec.operator,
        threshold: Number(ec.threshold),
    };
}

function makeCondition(sourceId: string, data: any): ConditionNode {
    const field: string = data.field;
    const op: string = data.operator;
    const threshold: number = Number(data.threshold);

    const evaluate = (msg: Referee): boolean => {
        const v = getFieldValue(field, msg);
        switch (op) {
            case '>': return v > threshold;
            case '<': return v < threshold;
            case '==': return v === threshold; // raw float equality, mirrors C++ ConditionNode::evaluateCondition
            case '!=': return v !== threshold;
            case '>=': return v >= threshold;
            case '<=': return v <= threshold;
            default: throw new Error(`Unknown operator: ${op}`);
        }
    };

    return {
        id: nextId('cond'),
        type: 'Condition',
        sourceId,
        priority: data.priority ?? 0,
        field,
        operator: op,
        threshold,
        evaluate,
        tick: (msg: Referee) => (evaluate(msg) ? NodeStatus.SUCCESS : NodeStatus.FAILURE),
    };
}

function makeAction(sourceId: string, data: any): ActionNode {
    const actions: string[] =
        data.actions && data.actions.length > 0
            ? data.actions
            : [data.action ?? 'STOP'];
    const loop = !!data.loop;
    const duration = Number(data.duration ?? 0);
    const exitCondition = buildExitCondition(data);

    return {
        id: nextId('act'),
        type: 'Action',
        sourceId,
        priority: 0,
        actions,
        loop,
        duration,
        exitCondition,
        hasExitCondition: () => exitCondition !== undefined,
        checkExitCondition: (msg: Referee): boolean => {
            if (!exitCondition) return true;
            const v = getFieldValue(exitCondition.field, msg);
            switch (exitCondition.op) {
                case '>': return v > exitCondition.threshold;
                case '<': return v < exitCondition.threshold;
                case '>=': return v >= exitCondition.threshold;
                case '<=': return v <= exitCondition.threshold;
                case '==': return Math.abs(v - exitCondition.threshold) < 1e-6; // epsilon, mirrors C++
                case '!=': return Math.abs(v - exitCondition.threshold) >= 1e-6;
                default: return true;
            }
        },
        getExitConditionField: () => exitCondition?.field,
        // ActionNode.tick self is always SUCCESS (mirrors C++); real logic in engine tickNode.
        tick: () => NodeStatus.SUCCESS,
    };
}

function makeParam(sourceId: string, data: any): ParamNode {
    const config: ParamConfig = {
        node_name: data.node_name,
        param_name: data.param_name,
        param_value: String(data.param_value),
        param_type: data.param_type ?? 'string',
    };
    return {
        id: nextId('param'),
        type: 'Param',
        sourceId,
        priority: 0,
        config,
        tick: () => NodeStatus.SUCCESS,
    };
}

function makeZone(sourceId: string, data: any, zoneRule?: ZoneRule): ZoneNode {
    const conditions: ConditionNode[] = (data.conditions || []).map((c: any) =>
        makeCondition('', c)
    );
    const params: ParamNode[] = (data.params || []).map((p: any) => makeParam('', p));
    const action = data.action ? makeAction('', data.action) : undefined;

    // Build world polygon from zone rule (matching C++ loadConfiguration polygon logic).
    let worldPolygon: Array<[number, number]> = [];
    if (zoneRule) {
        let pts = zoneRule.worldPoints && zoneRule.worldPoints.length >= 6
            ? zoneRule.worldPoints
            : (zoneRule.worldRect ? rectToPoints(zoneRule.worldRect) : []);
        for (let i = 0; i + 1 < pts.length; i += 2) {
            worldPolygon.push([Number(pts[i]), Number(pts[i + 1])]);
        }
    }

    return {
        id: nextId('zone'),
        type: 'Zone',
        sourceId,
        priority: data.priority ?? 0,
        zoneId: data.zone_id,
        zoneName: data.zone_name,
        action,
        conditions,
        params,
        children: [],
        tick: () => NodeStatus.FAILURE, // handled by engine tickZone
    };
}

interface Path {
    items: DecisionNode[];
    priority: number;
}

/**
 * Collect every root-to-leaf path through the canvas graph as an ordered list of
 * sequence items, mirroring YamlExporter's collectPaths. Each item carries the
 * sourceId of the canvas node it was built from, for highlight tracking.
 */
function collectPaths(
    node: any,
    allNodes: any[],
    currentItems: DecisionNode[],
    paths: Path[]
): void {
    if (node.type === 'action') {
        const actionNode = makeAction(node.id, node.data);
        const newItems = [...currentItems, actionNode];
        const childIds: string[] = node.children || [];
        if (childIds.length === 0) {
            const lastCond = [...newItems].reverse().find(i => i.type === 'Condition') as ConditionNode | undefined;
            const priority = lastCond ? lastCond.priority || 1 : 1;
            paths.push({ items: newItems, priority });
            return;
        }
        for (const childId of childIds) {
            const childNode = allNodes.find(n => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
        return;
    }

    if (node.type === 'param') {
        const paramNode = makeParam(node.id, node.data);
        const newItems = [...currentItems, paramNode];
        const childIds: string[] = node.children || [];
        if (childIds.length === 0) {
            const lastCond = [...newItems].reverse().find(i => i.type === 'Condition') as ConditionNode | undefined;
            const priority = lastCond ? lastCond.priority || 1 : 1;
            paths.push({ items: newItems, priority });
            return;
        }
        for (const childId of childIds) {
            const childNode = allNodes.find(n => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
        return;
    }

    if (node.type === 'condition') {
        const condNode = makeCondition(node.id, node.data);
        const newItems = [...currentItems, condNode];
        const childIds: string[] = node.children || [];
        for (const childId of childIds) {
            const childNode = allNodes.find(n => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
        return;
    }

    if (node.type === 'zone') {
        const zoneNode = makeZone(node.id, node.data);
        const newItems = [...currentItems, zoneNode];
        const childIds: string[] = node.children || [];
        if (childIds.length === 0) {
            paths.push({ items: newItems, priority: zoneNode.priority || 1 });
            return;
        }
        for (const childId of childIds) {
            const childNode = allNodes.find(n => n.id === childId);
            if (childNode) collectPaths(childNode, allNodes, newItems, paths);
        }
    }
}

export interface BuiltTree {
    root: SelectorNode;
    zones: Record<string, ZoneDefinition>;
    waypoints: Record<string, { x: number; y: number }>;
}

/**
 * Build a TS decision tree from the editor's canvas nodes + zones + waypoints.
 * Mirrors YamlExporter.buildDecisionTree (root Selector of prioritized Sequences)
 * so it stays structurally equivalent to the YAML the C++ decision_executor reads.
 */
export function parseCanvasToTree(
    canvasNodes: any[],
    zones: ZoneRule[],
    waypoints: Waypoint[]
): BuiltTree {
    idCounter = 0;

    const allChildIds = new Set(canvasNodes.flatMap(n => n.children || []));
    const rootNodes = canvasNodes.filter(n => !allChildIds.has(n.id));

    const paths: Path[] = [];
    for (const root of rootNodes) {
        collectPaths(root, canvasNodes, [], paths);
    }
    paths.sort((a, b) => a.priority - b.priority);

    const sequences: SequenceNode[] = paths.map(path => ({
        id: nextId('seq'),
        type: 'Sequence',
        sourceId: '', // synthetic wrapper, no canvas node
        priority: path.priority,
        children: path.items,
        tick: () => NodeStatus.FAILURE, // driven by engine tickSequence
    }));

    // stable_sort by priority asc (mirrors SelectorNode::addChild)
    sequences.sort((a, b) => a.priority - b.priority);

    const root: SelectorNode = {
        id: nextId('sel'),
        type: 'Selector',
        sourceId: '',
        priority: 0,
        children: sequences,
        tick: () => NodeStatus.FAILURE, // driven by engine tickSelector
    };

    // Zone definitions for point-in-polygon (mirrors C++ zones_ map)
    const zoneDefs: Record<string, ZoneDefinition> = {};
    for (const z of zones) {
        const zoneRule = z;
        let worldPolygon: Array<[number, number]> = [];
        const pts = zoneRule.worldPoints && zoneRule.worldPoints.length >= 6
            ? zoneRule.worldPoints
            : (zoneRule.worldRect ? rectToPoints(zoneRule.worldRect) : []);
        for (let i = 0; i + 1 < pts.length; i += 2) {
            worldPolygon.push([Number(pts[i]), Number(pts[i + 1])]);
        }
        zoneDefs[z.id] = { id: z.id, name: z.name, worldPolygon };
    }

    // Waypoints by name (mirrors C++ waypoints_ map). Store world coords only.
    const wpMap: Record<string, { x: number; y: number }> = {};
    for (const wp of waypoints) wpMap[wp.name] = { x: wp.world.x, y: wp.world.y };

    return { root, zones: zoneDefs, waypoints: wpMap };
}

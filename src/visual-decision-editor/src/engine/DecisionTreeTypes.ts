import { NodeStatus } from './Status';
import { Referee } from '../ros/types';

/**
 * TS mirror of decision_executor's DecisionNode hierarchy (DecisionNode.hpp).
 * Each node carries `sourceId` — the id of the editor canvas DecisionTreeNode it
 * was built from — so the visualizer can highlight it. The root Selector and the
 * auto-generated Sequence wrappers carry sourceId '' (no canvas counterpart).
 *
 * Node identity for ExecutionContext maps uses a stable `id` assigned at build
 * time (replaces the C++ raw-pointer key).
 */
export interface DecisionNode {
    id: string;
    type: 'Condition' | 'Action' | 'Selector' | 'Sequence' | 'Param' | 'Zone';
    sourceId: string; // canvas node id this tree node corresponds to ('' if synthetic)
    priority: number;
    tick: (msg: Referee) => NodeStatus; // leaf self-evaluation only; composites driven by engine
}

export interface ExitCondition {
    field: string;
    op: string;
    threshold: number;
}

export type Polygon = Array<[number, number]>;

export interface ConditionNode extends DecisionNode {
    type: 'Condition';
    field: string;
    operator: string;
    threshold: number;
    /** Evaluates the condition. Mirrors ConditionNode::evaluateCondition (raw float equality for ==/!=). */
    evaluate: (msg: Referee) => boolean;
}

export interface ActionNode extends DecisionNode {
    type: 'Action';
    actions: string[];
    loop: boolean;
    duration: number;
    exitCondition?: ExitCondition;
    hasExitCondition: () => boolean;
    /** Mirrors ActionNode::checkExitCondition (epsilon 1e-6 for ==/!=). */
    checkExitCondition: (msg: Referee) => boolean;
    getExitConditionField?: () => string | undefined;
}

export interface SelectorNode extends DecisionNode {
    type: 'Selector';
    children: DecisionNode[];
}

export interface SequenceNode extends DecisionNode {
    type: 'Sequence';
    children: DecisionNode[];
}

export interface ParamConfig {
    node_name: string;
    param_name: string;
    param_value: string;
    param_type: string;
}

export interface ParamNode extends DecisionNode {
    type: 'Param';
    config: ParamConfig;
}

export interface ZoneDefinition {
    id: string;
    name: string;
    worldPolygon: Polygon;
}

export interface ZoneNode extends DecisionNode {
    type: 'Zone';
    zoneId: string;
    zoneName: string;
    action?: ActionNode;
    conditions: ConditionNode[];
    params: ParamNode[];
    children: DecisionNode[];
}

export type AnyDecisionNode = DecisionNode;

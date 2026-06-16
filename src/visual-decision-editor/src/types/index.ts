// Type definitions for the decision system

export interface Point {
    x: number;
    y: number;
}

export interface PixelPoint {
    u: number;
    v: number;
}

export interface Waypoint {
    name: string;
    pixel: PixelPoint;
    world: Point;
}

export interface MapMetadata {
    imagePath: string;
    resolution: number; // meters per pixel
    widthPixels: number;
    heightPixels: number;
    originPixel: PixelPoint | null;
}

// Decision Tree Types
export type ComparisonOperator = '>' | '<' | '==' | '!=' | '>=' | '<=';

// All fields available in Referee.msg (sorted alphabetically)
export type RefereeMessageField =
    | 'armor_id'
    | 'attack_buff'
    | 'center_gain_status'
    | 'cmd_keyboard'
    | 'cmd_source'
    | 'cooling_buff'
    | 'current_hp'
    | 'defence_buff'
    | 'enemy_base_hp'
    | 'enemy_outpost_hp'
    | 'enemy_robot_hp'
    | 'event_data'
    | 'fortress_status'
    | 'game_progress'
    | 'hp_deduction_reason'
    | 'maximum_hp'
    | 'obtainable_shoot_num'
    | 'own_base_hp'
    | 'own_outpost_hp'
    | 'own_robot_hp'
    | 'remaining_energy'
    | 'rune_statues'
    | 'shoot_distance'
    | 'shoot_num'
    | 'stage_remain_time'
    | 'supply_zone_non_overlap'
    | 'supply_zone_overlap'
    | 'target_position_x'
    | 'target_position_y'
    | 'target_robot_id'
    | 'vision_status'
    | 'vulnerability_buff';

// Field name → ROS msg type, matching sentry_msgs/msg/Referee.msg (sorted alphabetically)
export const REFEREE_FIELD_TYPES: Record<RefereeMessageField, string> = {
    armor_id: 'uint8',
    attack_buff: 'uint16',
    center_gain_status: 'uint16',
    cmd_keyboard: 'uint8',
    cmd_source: 'uint16',
    cooling_buff: 'uint16',
    current_hp: 'uint16',
    defence_buff: 'uint8',
    enemy_base_hp: 'uint16',
    enemy_outpost_hp: 'uint16',
    enemy_robot_hp: 'uint16',
    event_data: 'uint16',
    fortress_status: 'uint16',
    game_progress: 'uint8',
    hp_deduction_reason: 'uint8',
    maximum_hp: 'uint16',
    obtainable_shoot_num: 'uint16',
    own_base_hp: 'uint16',
    own_outpost_hp: 'uint16',
    own_robot_hp: 'uint16',
    remaining_energy: 'uint16',
    rune_statues: 'uint16',
    shoot_distance: 'uint16',
    shoot_num: 'uint16',
    stage_remain_time: 'uint16',
    supply_zone_non_overlap: 'uint16',
    supply_zone_overlap: 'uint16',
    target_position_x: 'float32',
    target_position_y: 'float32',
    target_robot_id: 'uint8',
    vision_status: 'uint8',
    vulnerability_buff: 'uint8'
};

export const REFEREE_TARGET_ACTION = 'REFEREE_TARGET';
export const REFEREE_TARGET_ACTION_LABEL = '前往裁判系统目标点';

export interface ConditionNodeData {
    type: 'Condition';
    field: string;
    value_type: 'uint8' | 'uint16' | 'float';
    operator: '>' | '<' | '>=' | '<=' | '==';
    threshold: number;
}

export interface ActionNodeData {
    type: 'Action';
    action: string; // Legacy/Primary
    actions?: string[]; // Multi-step
    loop?: boolean;
}

export interface LogicNodeData {
    type: 'Selector' | 'Sequence';
}

export interface ParamNodeData {
    type: 'Param';
    node_name: string;
    param_name: string;
    param_value: string | number | boolean;
    param_type: 'string' | 'int' | 'double' | 'bool';
}

export type DecisionNodeData = ConditionNodeData | ActionNodeData | LogicNodeData | ParamNodeData;

export interface ZoneRect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface ZoneWorldRect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface ZoneRule {
    id: string;
    name: string;
    rect: ZoneRect;
    worldRect: ZoneWorldRect;
    points: number[];        // flat array of polygon pixel coords [x1,y1, x2,y2, ...]
    worldPoints: number[];   // flat array of polygon world coords
    priority: number;
    conditions: any[];
    action: any;
    params: any[];
    canvasX?: number; // Persistence for editor nodes
    canvasY?: number;
}

/** Convert a ZoneRect to a flat points array [x1,y1, x2,y1, x2,y2, x1,y2] */
export function rectToPoints(rect: { x1: number; y1: number; x2: number; y2: number }): number[] {
    return [rect.x1, rect.y1, rect.x2, rect.y1, rect.x2, rect.y2, rect.x1, rect.y2];
}

/** Compute bounding rect from a flat points array */
export function pointsToRect(points: number[]): ZoneRect {
    const xs = points.filter((_, i) => i % 2 === 0);
    const ys = points.filter((_, i) => i % 2 === 1);
    return {
        x1: Math.min(...xs),
        y1: Math.min(...ys),
        x2: Math.max(...xs),
        y2: Math.max(...ys),
    };
}

// Configuration export format
export interface DecisionConfig {
    map_metadata: {
        image_path: string;
        resolution: number;
        width_pixels: number;
        height_pixels: number;
        origin_pixel: [number, number];
    };
    waypoints: Array<{
        name: string;
        pixel: [number, number];
        world: [number, number];
    }>;
    zones: ZoneRule[];
    decision_tree: any; // Will be constructed from React Flow nodes
}

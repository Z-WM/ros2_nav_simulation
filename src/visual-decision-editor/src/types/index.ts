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

// All fields available in Referee.msg
export type RefereeMessageField =
    | 'game_progress'
    | 'stage_remain_time'
    | 'own_robot_hp'
    | 'own_outpost_hp'
    | 'own_base_hp'
    | 'enemy_robot_hp'
    | 'enemy_outpost_hp'
    | 'enemy_base_hp'
    | 'remaining_energy'
    | 'event_data'
    | 'current_hp'
    | 'vision_status'
    | 'maximum_hp'
    | 'defence_buff'
    | 'vulnerability_buff'
    | 'attack_buff'
    | 'shoot_distance'
    | 'armor_id'
    | 'hp_deduction_reason'
    | 'shoot_num'
    | 'rfid_status'
    | 'obtain_shoot_num';

// Field name → ROS msg type, matching sentry_msgs/msg/Referee.msg
export const REFEREE_FIELD_TYPES: Record<RefereeMessageField, string> = {
    game_progress: 'uint8',
    stage_remain_time: 'uint16',
    own_robot_hp: 'uint16',
    own_outpost_hp: 'uint16',
    own_base_hp: 'uint16',
    enemy_robot_hp: 'uint16',
    enemy_outpost_hp: 'uint16',
    enemy_base_hp: 'uint16',
    remaining_energy: 'uint16',
    event_data: 'uint32',
    current_hp: 'uint16',
    vision_status: 'uint8',
    maximum_hp: 'uint16',
    defence_buff: 'uint8',
    vulnerability_buff: 'uint8',
    attack_buff: 'uint16',
    shoot_distance: 'uint16',
    armor_id: 'uint8',
    hp_deduction_reason: 'uint8',
    shoot_num: 'uint16',
    rfid_status: 'uint32',
    obtain_shoot_num: 'uint16'
};

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
    priority: number;
    conditions: any[];
    action: any;
    params: any[];
    canvasX?: number; // Persistence for editor nodes
    canvasY?: number;
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

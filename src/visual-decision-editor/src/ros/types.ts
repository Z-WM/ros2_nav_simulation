// ROS message types used by the web decision executor.
// Mirrors sentry_msgs/msg/Referee.msg and nav_msgs/msg/Odometry.msg for rosbridge JSON.

export interface Header {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
}

/**
 * Full Referee message (sentry_msgs/msg/Referee). rosbridge delivers it as JSON
 * with primitive fields already coerced. Numeric fields are accessed via the
 * field name exactly as in the .msg definition.
 */
export interface Referee {
    header: Header;
    game_progress: number;
    stage_remain_time: number;
    current_hp: number;
    maximum_hp: number;
    remaining_energy: number;
    own_robot_hp: number;
    own_outpost_hp: number;
    own_base_hp: number;
    enemy_robot_hp: number;
    enemy_outpost_hp: number;
    enemy_base_hp: number;
    shoot_distance: number;
    shoot_num: number;
    obtainable_shoot_num: number;
    vision_status: number;
    cooling_buff: number;
    attack_buff: number;
    defence_buff: number;
    vulnerability_buff: number;
    armor_id: number;
    hp_deduction_reason: number;
    supply_zone_overlap: number;
    supply_zone_non_overlap: number;
    rune_statues: number;
    fortress_status: number;
    event_data: number;
    center_gain_status: number;
    target_position_x: number;
    target_position_y: number;
    cmd_keyboard: number;
    target_robot_id: number;
    cmd_source: number;
    [field: string]: number | Header;
}

export interface Odometry {
    header: Header;
    pose: {
        pose: {
            position: { x: number; y: number; z: number };
            orientation: { x: number; y: number; z: number; w: number };
        };
        covariance: number[];
    };
    twist: {
        twist: {
            linear: { x: number; y: number; z: number };
            angular: { x: number; y: number; z: number };
        };
        covariance: number[];
    };
}

export interface Twist {
    linear: { x: number; y: number; z: number };
    angular: { x: number; y: number; z: number };
}

export interface PoseStamped {
    header: Header;
    pose: {
        position: { x: number; y: number; z: number };
        orientation: { x: number; y: number; z: number; w: number };
    };
}

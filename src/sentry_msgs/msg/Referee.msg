std_msgs/Header header  #标准消息头，包含时间戳等信息

# === 比赛状态 (Game Status) ===
uint8  game_progress
uint16 stage_remain_time

# === 机器人自身状态 (Robot Status) ===
uint16 current_hp
uint16 maximum_hp
uint16 remaining_energy

# === 阵营建筑与单位血量 (Team & Building HP) ===
uint16 own_robot_hp
uint16 own_outpost_hp
uint16 own_base_hp
uint16 enemy_robot_hp
uint16 enemy_outpost_hp
uint16 enemy_base_hp

# === 武器与射击 (Weapon & Shooting) ===
uint16 shoot_distance
uint16 shoot_num
uint16 obtainable_shoot_num
uint8  vision_status


# === 增益与加成 (Buffs) ===
uint16 cooling_buff
uint16 attack_buff
uint8  defence_buff
uint8  vulnerability_buff

# === 伤害与交互事件 (Damage & Interactive Events) ===
uint8  armor_id
uint8  hp_deduction_reason
uint16 supply_zone_overlap
uint16 supply_zone_non_overlap
uint16 rune_statues
uint16 fortress_status
uint16 event_data
uint16 center_gain_status
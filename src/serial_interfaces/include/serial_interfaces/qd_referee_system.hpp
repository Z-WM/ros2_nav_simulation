#ifndef _QD_REFEREE_SYSTEM_HPP_
#define _QD_REFEREE_SYSTEM_HPP_
#include <iostream>
#include <stdbool.h>
#include <stdint.h>

typedef char Status; 
typedef uint8_t QElemType; 

/*------------------串口协议各个包详细说明------------------*/

/**
  * @brief  视觉状态
  */
typedef struct
{
    bool IS_Vision_Lost_Flag_Left;
		bool IS_Vision_Lost_Flag_Right;
    uint8_t shoot_distance;
}vision_status_t;

/**
  * @brief  比赛状态数据
  * cmd:0x0001
  */
typedef struct
{
  // uint8_t game_type : 4;
  uint8_t game_progress : 4;
  uint16_t stage_remain_time;
  uint8_t center_buff_status;
  // uint64_t SyncTimeStamp;
}game_status_t;

/**
  * @brief  机器人血量数据
  * cmd:0x0003
  */
typedef struct
{
  uint16_t own_robot_hp;      // 己方哨兵机器人血量 
	uint16_t own_outpost_hp;    // 己方前哨站血量
	uint16_t own_base_hp; 	    // 己方基地血量 
  uint16_t enemy_robot_hp;    // 敌方
	uint16_t enemy_outpost_hp;  
	uint16_t enemy_base_hp;
} game_robot_hp_t;

/**
  * @brief  场地事件数据
  * cmd: 0x0101
  * 字节偏移量: 0  |  大小: 4 (uint32_t)
  */
typedef struct
{
    /* bit 0-2: 己方补给区占领状态 */
    uint32_t supply_zone_status_0 : 1;      // bit 0: 己方补给区的占领状态，1为已占领
    uint32_t reserved_bit1 : 1;             // bit 1: 保留位
    uint32_t supply_zone_status_2 : 1;      // bit 2: 己方补给区的占领状态 (仅 RMUL 适用)

    /* bit 3-6: 己方能量机关状态 */
    uint32_t small_energy_status : 2;       // bit 3-4: 己方小能量机关状态 (0未激活, 1已激活, 2正在激活)
    uint32_t large_energy_status : 2;       // bit 5-6: 己方大能量机关状态 (0未激活, 1已激活, 2正在激活)

    /* bit 7-10: 高地占领状态 */
    uint32_t central_highland_status : 2;   // bit 7-8: 己方中央高地的占领状态 (1被己方占领, 2被对方占领)
    uint32_t trapezoid_highland_status : 2; // bit 9-10: 己方梯形高地的占领状态 (1为已占领)

    /* bit 11-19: 飞镖受击时间 */
    uint32_t last_dart_hit_time : 9;        // bit 11-19: 对方飞镖最后一次击中己方前哨站或基地的时间 (0-420)

    /* bit 20-22: 飞镖受击目标 */
    uint32_t last_dart_hit_target : 3;      // bit 20-22: 对方飞镖击中的具体目标 (1前哨站, 2基地固定, 3基地随机固定, 4基地随机移动, 5基地末端移动)

    /* bit 23-29: 增益点占领状态 */
    uint32_t center_gain_status : 2;        // bit 23-24: 中心增益点 (0未占, 1己方, 2对方, 3双方) (仅 RMUL 适用)
    uint32_t fortress_status : 2;      // bit 25-26: 己方堡垒增益点 (0未占, 1己方, 2对方, 3双方)
    uint32_t outpost_gain_status : 2;       // bit 27-28: 己方前哨站增益点 (0未占, 1己方, 2对方)
    uint32_t base_gain_status : 1;          // bit 29: 己方基地增益点 (1为已占领)

    /* bit 30-31: 保留位 */
    uint32_t reserved_30_31 : 2;            // bit 30-31: 保留位

} event_data_t;


/**
  * @brief 机器人性能体系数据
  * cmd:0x0201
  */
typedef struct 
{   
	// uint8_t robot_id;
    // uint8_t robot_level;
    uint16_t current_hp;
    uint16_t maximum_hp;
    // uint16_t shooter_barrel_cooling_value;
    // uint16_t shooter_barrel_heat_limit;
    // uint16_t chassis_power_limit;
} robot_status_t;

/**
  * @brief  机器人位置
  * cmd:0x0203
  */
typedef struct 
{ 
	float x;    //位置 x 坐标，单位 m
	float y;    //位置 y 坐标，单位 m 
  float angle;
} robot_pos_t;

/**
  * @brief  机器人增益
  * cmd:0x0204
  */
typedef struct
{
    // uint8_t recovery_buff;      // 机器人回血增益（百分比，值为 10 表示每秒恢复血量上限的 10%）
    // uint8_t cooling_buff;       // 机器人枪口冷却倍率（直接值，值为 5 表示 5 倍冷却）
    uint8_t defence_buff;       // 机器人防御增益（百分比，值为 50 表示 50%防御增益）
    uint8_t vulnerability_buff; // 机器人负防御增益（百分比，值为 30 表示-30%防御增益）
    uint16_t attack_buff;       // 机器人攻击增益（百分比，值为 50 表示 50%攻击增益）
}buff_t;

/**
  * @brief  伤害状态
  * cmd:0x0206
  */
typedef struct
{
	//bit 0-3：当血量变化类型为装甲伤害，代表装甲 ID，其中数值为 0-4 号代表机器人的五个装甲片，其他血量变化类型，该变量数值为 0。
	uint8_t armor_id : 4;
	//bit 4-7：血量变化类型
	//0x0 装甲伤害扣血；
	//0x1 模块掉线扣血；
	//0x2 超射速扣血；
	//0x3 超枪口热量扣血；
	//0x4 超底盘功率扣血；
	//0x5 装甲撞击扣血
	// uint8_t hurt_type : 4;
    uint8_t hp_deduction_reason : 4;
} hurt_data_t;

/**
  * @brief 子弹剩余发射数
  * cmd:0x0208
  */
typedef struct
{
	uint16_t projectile_allowance_17mm; // 17mm 弹丸允许发弹量
	// uint16_t remaining_gold_coin;       // 剩余金币数量
}projectile_allowance_t; 

/**
  * @brief 机器人 RFID 状态
  * cmd:0x0209
  */
typedef struct 
{ 
  // 暂时用不上，先注释了
  // bit 0-23: 增益点状态
    // uint32_t base_gain : 1;                     // bit 0: 己方基地增益点
    // uint32_t central_highland_gain_self : 1;    // bit 1: 己方中央高地增益点
    // uint32_t central_highland_gain_opponent : 1;// bit 2: 对方中央高地增益点
    // uint32_t trapezoid_highland_gain_self : 1;  // bit 3: 己方梯形高地增益点
    // uint32_t trapezoid_highland_gain_opponent : 1; // bit 4: 对方梯形高地增益点
    // uint32_t terrain_cross_gain_self_pre : 1;   // bit 5: 己方地形跨越增益点（飞坡前）
    // uint32_t terrain_cross_gain_self_post : 1;  // bit 6: 己方地形跨越增益点（飞坡后）
    // uint32_t terrain_cross_gain_opponent_pre : 1; // bit 7: 对方地形跨越增益点（飞坡前）
    // uint32_t terrain_cross_gain_opponent_post : 1; // bit 8: 对方地形跨越增益点（飞坡后）
    // uint32_t central_highland_below_self : 1;   // bit 9: 己方地形跨越增益点（中央高地下方）
    // uint32_t central_highland_above_self : 1;   // bit 10: 己方地形跨越增益点（中央高地上方）
    // uint32_t central_highland_below_opponent : 1; // bit 11: 对方地形跨越增益点（中央高地下方）
    // uint32_t central_highland_above_opponent : 1; // bit 12: 对方地形跨越增益点（中央高地上方）
    // uint32_t road_below_self : 1;               // bit 13: 己方地形跨越增益点（公路下方）
    // uint32_t road_above_self : 1;               // bit 14: 己方地形跨越增益点（公路上方）
    // uint32_t road_below_opponent : 1;           // bit 15: 对方地形跨越增益点（公路下方）
    // uint32_t road_above_opponent : 1;           // bit 16: 对方地形跨越增益点（公路上方）
    // uint32_t fortress_gain_self : 1;            // bit 17: 己方堡垒增益点
    // uint32_t outpost_gain_self : 1;             // bit 18: 己方前哨站增益点
    uint32_t supply_zone_non_overlap : 1;       // bit 19: 己方与兑换区不重叠的补给区
    uint32_t supply_zone_overlap : 1;           // bit 20: 己方与兑换区重叠的补给区
    // uint32_t large_island_gain_self : 1;        // bit 21: 己方大资源岛增益点
    // uint32_t large_island_gain_opponent : 1;    // bit 22: 对方大资源岛增益点
    // uint32_t center_gain : 1;                  // bit 23: 中心增益点（仅 RMUL 适用）
    // bit 24-31: 保留位
    // uint32_t reserved : 8;                      // bit 24-31: 保留位
    // 保存32位
    uint32_t rfid_status;
} rfid_status_t; 

typedef struct
{
 float target_position_x;
 float target_position_y;
 uint8_t cmd_keyboard;
 uint8_t target_robot_id;
 uint16_t cmd_source;
}map_command_t; 
/*
 * @brief 串口协议对应命令ID
*/
typedef enum
{ 
  CMD_game_status_t                     = 0x0001,
	CMD_game_robot_hp_t                   = 0x0003,
	CMD_event_data_t                      = 0x0101,
	CMD_robot_status_t                    = 0x0201,
	CMD_robot_pos_t                       = 0x0203,
	CMD_buff_t                            = 0x0204,
	CMD_hurt_data_t                       = 0x0206,
	CMD_projectile_allowance_t            = 0x0208,
	CMD_rfid_status_t                     = 0x0209,
  CMD_map_command_t                     = 0x0303,
  CMD_vision_status_t                   = 0x0401
} CmdID;



#endif

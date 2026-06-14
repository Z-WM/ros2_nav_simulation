#ifndef _QD_DRIVER_HPP_
#define _QD_DRIVER_HPP_

#include <memory>
#include <string>
#include <thread>
#include <boost/asio.hpp>

#include "rclcpp/rclcpp.hpp"
#include "geometry_msgs/msg/twist.hpp"
#include "sentry_msgs/msg/referee.hpp"

#include "qd_referee_system.hpp"

/*
    通信协议：双帧头 + 帧长度 + 帧号(状态码) + 数据段 + 校验和
            0xAA 0x55 0x0B 0x01 (传输的数据段，高八位低八位，长度自由变化) 0xF5（实际是多少就是多少）   
            目前数据段包含Vx,Vy,Wz,六位数据位  （三轴里程计）
            （注释掉的是ax,ay,az,gx,gy,gz 六轴imu数据 不需要的话就自己删改）
        双帧头：抗数据干扰性更强
        帧长度：传输一帧数据的长度
        帧号：功能识别代号，状态机
        数据：高位在前，地位在后，长度可变，(8位，16位，数据自由组合)
        校验和： 前面数据累加和的低八位 */
/*
 * @brief 与下位机（电控）通信双帧头
*/

#define FRAME_HEADER_ONE 0xAA
#define FRAME_HEADER_TWO 0x55

/*
 * @brief 是否RCLCPP_INFO测试信息
*/
#define DEBUG_VISION_STATUS                     0
#define DEBUG_RecvDataPacketHandle_STATUS       0
#define DEBUG_RecvDataPacketHandle_HP           0
#define DEBUG_RecvDataPacketHandle_EVENT        0
#define DEBUG_RecvDataPacketHandle_CurrentMaxHP 0
#define DEBUG_RecvDataPacketHandle_POSE         0
#define DEBUG_RecvDataPacketHandle_BUFF         0
#define DEBUG_RecvDataPacketHandle_HURT         0
#define DEBUG_RecvDataPacketHandle_ALLOWANCE    0
#define DEBUG_RecvDataPacketHandle_RFID         0
#define DEBUG_MSGS                              0
#define DEBUG_CmdVelCallback_Vel_Data           0
#define DEBUG_RecCallback                       0
#define DEBUG_SERIAL                            0

namespace qd_driver {

struct VelocityData {
    float linear_x;
    float linear_y;
    float angular_z;
};

class SerialCommunication {
public:
    SerialCommunication() = default;
    virtual ~SerialCommunication() = default;

    std::string serial_port_;
    int serial_port_baud_;
    std::shared_ptr<boost::asio::serial_port> serial_ptr_;
    boost::asio::io_service io_service_;
    boost::system::error_code error_code_;
};

class Driver : public rclcpp::Node, public SerialCommunication {
public:
    Driver();
    virtual ~Driver();

private:
    // 串口处理
    bool OpenSerialPort();
    void CloseSerialPort();
    void RecCallback(); 
    void RecvDataPacketHandle(uint8_t *buffer_data);
    void SendDataPacket(uint8_t *pbuf, uint8_t len);

    // 姿态切换逻辑变量
    int current_stance = -1; // -1: 未知, 1: 攻击, 2: 防御, 0: 移动
    int pending_stance = -1;
    rclcpp::Time pending_stance_start;

    // ROS2 回调
    void CmdVelCallback(const geometry_msgs::msg::Twist::SharedPtr msg);

    // --- referee结构体实例  ---
    game_status_t game_status;
    game_robot_hp_t game_robot_hp;
    event_data_t event_data;
    robot_status_t robot_status;
    robot_pos_t robot_pos;
    buff_t buff;
    hurt_data_t hurt_data;
    projectile_allowance_t projectile_allowance;
    rfid_status_t rfid_status;
    map_command_t map_command;
    vision_status_t vision_status;
    uint16_t obtainable_shoot_num = 0;//可获取发弹量
    int obtained_shoot_num = 0;//已获取发弹量

    rclcpp::Time last_hurt_time_ = rclcpp::Time(0, 0, RCL_ROS_TIME);
    uint16_t last_hp_ = 0;

    // ROS2 通信对象
    rclcpp::Publisher<sentry_msgs::msg::Referee>::SharedPtr referee_pub_;
    rclcpp::Publisher<geometry_msgs::msg::Twist>::SharedPtr cmd_vel_sim_pub_;
    rclcpp::Subscription<geometry_msgs::msg::Twist>::SharedPtr cmd_vel_sub_;

    bool simulation_mode_ = false;
    std::string cmd_vel_sim_topic_ = "/cmd_vel_sim";

    std::thread serial_thread_;
    uint8_t rx_con_ = 0;
    uint8_t rx_buf_[64];
    uint8_t rx_checksum_ = 0;

    // 话题定义
    std::string cmd_vel_topic_;
    std::string referee_topic_;
};

} // namespace qd_driver

#endif
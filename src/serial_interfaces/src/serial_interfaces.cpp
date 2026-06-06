#include "serial_interfaces/serial_interfaces.hpp"
#include <chrono>

using namespace std::chrono_literals;

namespace qd_driver {

Driver::Driver() : Node("serial_interfaces") {
    // 声明与获取参数
    this->declare_parameter("shaobing_port", "/dev/rm_usb0");
    this->declare_parameter("shaobing_port_baud", 115200);
    this->declare_parameter("vel_spin", 3.3);
    this->declare_parameter("kp_value", 7.0);
    this->declare_parameter("sentry_mode", 3.0);
    this->declare_parameter("condition", 0.0);
    
    this->get_parameter("shaobing_port", serial_port_);
    this->get_parameter("shaobing_port_baud", serial_port_baud_);


    // 初始化参数客户端
    parameters_client_ = std::make_shared<rclcpp::AsyncParametersClient>(this, "/controller_server");

    // 初始化发布者与订阅者
    referee_pub_ = this->create_publisher<sentry_msgs::msg::Referee>("referee", 10);
    
    // 订阅上游导航/遥控器下发的速度指令
    cmd_vel_sub_ = this->create_subscription<geometry_msgs::msg::Twist>(
        "/cmd_vel", 10, std::bind(&Driver::CmdVelCallback, this, std::placeholders::_1));

    // 初始化发给仿真环境的速度发布者，话题名可根据你的仿真环境自行修改
    sim_cmd_vel_pub_ = this->create_publisher<geometry_msgs::msg::Twist>("/cmd_vel_sim", 10);

    last_cmd_time = this->now();

    #if DEBUG_SERIAL
        RCLCPP_INFO(this->get_logger(), "Shaobing Set serial %s at %d baud", serial_port_.c_str(), serial_port_baud_);
    #endif
    // 启动串口 (保留读取裁判系统等数据的能力)
    if (!OpenSerialPort()) 
    {
        RCLCPP_WARN(this->get_logger(), "初始连接失败，等待自动重连...");
    } 
    else 
    {
        RCLCPP_INFO(this->get_logger(), "串口已打开: %s", serial_port_.c_str());
    }
    // 始终开启线程读取串口数据
    serial_thread_ = std::thread(&Driver::RecCallback, this);
    
    // 初始化姿态时间
    pending_stance_start = this->now();
}

Driver::~Driver() {
    // 析构时发送全 0 速度给仿真环境，确保安全停止
    if (sim_cmd_vel_pub_) {
        geometry_msgs::msg::Twist stop_msg;
        sim_cmd_vel_pub_->publish(stop_msg);
    }

    if (serial_thread_.joinable()) 
    {
        serial_thread_.join();
    }
    CloseSerialPort();
}

bool Driver::OpenSerialPort() {
    try {
        serial_ptr_ = std::make_shared<boost::asio::serial_port>(io_service_, serial_port_);
        serial_ptr_->set_option(boost::asio::serial_port_base::baud_rate(serial_port_baud_));
        serial_ptr_->set_option(boost::asio::serial_port_base::character_size(8));
        serial_ptr_->set_option(boost::asio::serial_port_base::stop_bits(boost::asio::serial_port_base::stop_bits::one));
        serial_ptr_->set_option(boost::asio::serial_port_base::parity(boost::asio::serial_port_base::parity::none));
        return true;
    } catch (std::exception &e) {
        // RCLCPP_ERROR(this->get_logger(), "串口打开失败: %s", e.what());
        return false;
    }
}

void Driver::CloseSerialPort() {
    if (serial_ptr_ && serial_ptr_->is_open()) 
    {
        try {
            serial_ptr_->cancel();
            serial_ptr_->close();
        } catch (...) {} // 忽略关闭时的异常
        serial_ptr_.reset();
    }
    io_service_.stop();
    io_service_.reset();
}


/**
  @brief 串口数据接收回调函数
 */ 
void Driver::RecCallback()
{
    uint8_t rec; // 接收数据变量
    
try{
    while (rclcpp::ok())
    {
        // 检查串口指针是否有效且已打开
        if (!serial_ptr_ || !serial_ptr_->is_open()) {
            if (OpenSerialPort()) {
                RCLCPP_INFO(this->get_logger(), "串口重连成功!");
            } else {
                std::this_thread::sleep_for(2s); // 重连间隔
                continue; 
            }
        }

        boost::system::error_code ec;
        boost::asio::read(*serial_ptr_.get(), boost::asio::buffer(&rec, 1), ec);

        if (ec) {
            RCLCPP_ERROR(this->get_logger(), "串口读取错误: %s，尝试关闭并重连...", ec.message().c_str());
            CloseSerialPort();
            std::this_thread::sleep_for(500ms);
            continue;
        }

        // 解析变帧长协议
        if (rx_con_ < 3) // 接收帧头 + 长度的数量
        {
            if (rx_con_ == 0) // 开始接收第一个帧头 0xAA
            {
                if(rec == FRAME_HEADER_ONE)
                {
                    rx_buf_[0] = rec; // 识别到第一个帧头便放入缓存数组内
                    rx_con_ = 1;      // 计数器指向下一位数据
                }
            }
            else if (rx_con_ == 1) // 接收第二个帧头 0x55
            {

                if (rec == FRAME_HEADER_TWO)
                {
                    rx_buf_[1] = rec; // 识别到第二个帧头
                    rx_con_ = 2;      // 计数器指向下一位数据
                }
                else
                    rx_con_ = 0;
            }
            else
            {
                // 接收数据包长度
                rx_buf_[2] = rec; // 数据长度位     
            #if DEBUG_RecCallback
                RCLCPP_INFO(this->get_logger(), "rx_buf_[2]:%d", rx_buf_[2]);    
            #endif
                rx_con_ = 3;      // 指向下一位数据
                rx_checksum_ = 0;
            }
        }
        else // 此时rx_con_接收计数器=3，表示已完成帧头1，2，数据长度三位的检阅
        {
            if (rx_con_ < (rx_buf_[2] - 1)) // 数据并未到达末尾校位前，均是检阅数据段内data，数组下标从0开始
            {   
                rx_buf_[rx_con_] = rec; // 以此开始存入数据段内的数据，直到遍历完成
                rx_con_++;
                rx_checksum_ += rec; // 累加前面所有数据，取该值低八位做校验和

            #if DEBUG_RecCallback
                RCLCPP_INFO(this->get_logger(), "%x", rx_buf_[4]);
                RCLCPP_INFO(this->get_logger(), "%x", rx_buf_[5]);

            #endif

            }
            else // 到达最后一位，其实最后一位是电控发来的数据校验和(八位)
            {
                // 本次接收数据包完成，恢复默认值0等待接收下一次数据包
                rx_con_ = 0;
                if (rec == rx_checksum_) // 校验正确
                {
                    // 对本次数据包进行处理
                    this->RecvDataPacketHandle(rx_buf_);
                }
            }
        }
    }
}
    catch (std::exception &e) {
            RCLCPP_ERROR(this->get_logger(), "串口读取异常: %s", e.what());
            CloseSerialPort(); // 关闭现有损坏的连接，等待下一轮循环重连
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
 }


/**
  @brief 处理接收到的数据的函数
*/
void Driver::RecvDataPacketHandle(uint8_t *buffer_data)
{
    static uint16_t judge_cmd;
    static uint8_t i = 4;

    sentry_msgs::msg::Referee msgs;

    judge_cmd = (buffer_data[3] << 8) | buffer_data[4];
    
    switch (judge_cmd)
    {
    case CMD_vision_status_t:{
        vision_status.IS_Vision_Lost_Flag_Left  = buffer_data[i+1];
        vision_status.IS_Vision_Lost_Flag_Right = buffer_data[i+2];
        vision_status.shoot_distance=buffer_data[i+3];
        break;
    }
    case CMD_game_status_t:{
        game_status.game_progress     =  buffer_data[i+1];
        game_status.stage_remain_time = (buffer_data[i+2]   << 8) | buffer_data[i+3];
        break;
    }
    case CMD_game_robot_hp_t:{
        game_robot_hp.own_robot_hp     = (buffer_data[i+1]   << 8) | buffer_data[i+2];
        game_robot_hp.enemy_robot_hp   = (buffer_data[i+3]   << 8) | buffer_data[i+4];
        game_robot_hp.enemy_base_hp    = (buffer_data[i+5]   << 8) | buffer_data[i+6];
        game_robot_hp.own_base_hp      = (buffer_data[i+7]   << 8) | buffer_data[i+8];
        break;
    }
    case CMD_event_data_t:{
        uint32_t event_data_value = (buffer_data[i+1] << 24) | 
                                (buffer_data[i+2] << 16) | 
                                (buffer_data[i+3] << 8)  | 
                                buffer_data[i+4];

        *(reinterpret_cast<uint32_t*>(&event_data)) = event_data_value;
        break;
    }
    case CMD_robot_status_t:{
        robot_status.current_hp = (buffer_data[i+1] << 8) | buffer_data[i+2];            
        robot_status.maximum_hp = (buffer_data[i+3] << 8) | buffer_data[i+4];
        break;            
    }
    case CMD_robot_pos_t:{
        robot_pos.x     = ((buffer_data[i+1]*1000) << 8) | (buffer_data[i+2]*1000);
        robot_pos.y     = ((buffer_data[i+3]*1000) << 8) | (buffer_data[i+4]*1000);
        robot_pos.angle = ((buffer_data[i+5]*1000) << 8) | (buffer_data[i+6]*1000);
        break;
    }
    case CMD_buff_t:{
        buff.defence_buff = buffer_data[i+1];
        buff.vulnerability_buff = buffer_data[i+2];
        buff.attack_buff = (buffer_data[i+3] << 8) | buffer_data[i+4];
        break;            
    }
    case CMD_hurt_data_t:{
        hurt_data.armor_id = buffer_data[i+1];
        hurt_data.hp_deduction_reason = buffer_data[i+2];
        break;            
    }
    case CMD_projectile_allowance_t:{
        projectile_allowance.projectile_allowance_17mm = (buffer_data[i+1] << 8) | buffer_data[i+2];
        break;            
    }
    case CMD_rfid_status_t:{
        rfid_status.rfid_status = (buffer_data[i+1] << 8) | buffer_data[i+2];
        break;            
    }

}
    if (vision_status.IS_Vision_Lost_Flag_Left ==  CONNECTION || vision_status.IS_Vision_Lost_Flag_Right == CONNECTION)
    {
        msgs.vision_status = CONNECTION;
    }
    else
    {
        msgs.vision_status = LOST;
    }
    msgs.header.stamp = this->now();
    msgs.shoot_distance = vision_status.shoot_distance;
    msgs.game_progress       = game_status.game_progress;
    msgs.stage_remain_time   = game_status.stage_remain_time;
    msgs.own_robot_hp        = game_robot_hp.own_robot_hp;
    msgs.own_base_hp         = game_robot_hp.own_base_hp;
    msgs.enemy_base_hp       = game_robot_hp.enemy_base_hp;
    msgs.event_data          = event_data.center_gain_status;
    msgs.current_hp          = robot_status.current_hp;
    msgs.armor_id            = hurt_data.armor_id;
    msgs.hp_deduction_reason = hurt_data.hp_deduction_reason;
    msgs.shoot_num           = projectile_allowance.projectile_allowance_17mm;

    
    
    referee_pub_->publish(msgs);
}

/**
    @brief 处理速度信息的回调函数（修改为直接发布话题给仿真）
*/
void Driver::CmdVelCallback(const geometry_msgs::msg::Twist::SharedPtr msg) {

    geometry_msgs::msg::Twist sim_msg;
    double vel_spin=1.0;
    this->get_parameter("vel_spin", vel_spin);
    RCLCPP_INFO_THROTTLE(this->get_logger(), *this->get_clock(), 1000, "vel_spin: %f", vel_spin);

    double sentry_mode=3.0;
    this->get_parameter("sentry_mode", sentry_mode);
    RCLCPP_INFO_THROTTLE(this->get_logger(), *this->get_clock(), 1000, "sentry_mode: %f", sentry_mode);

    // 填充速度
    sim_msg.linear.x = msg->linear.x;
    sim_msg.linear.y = msg->linear.y;
    sim_msg.linear.z = static_cast<double>(current_stance);  // 传递当前模式给下游
    sim_msg.angular.z = vel_spin; // 旋转速度乘以调节系数

    
    sim_cmd_vel_pub_->publish(sim_msg);
}

} // namespace qd_driver

int main(int argc, char **argv) {
    rclcpp::init(argc, argv);
    auto node = std::make_shared<qd_driver::Driver>();
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}
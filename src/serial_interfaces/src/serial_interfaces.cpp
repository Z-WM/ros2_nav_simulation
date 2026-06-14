#include "serial_interfaces/serial_interfaces.hpp"
#include <chrono>
#include <cstring>

using namespace std::chrono_literals;

namespace qd_driver {

Driver::Driver() : Node("serial_interfaces") {
    // 声明与获取参数
    this->declare_parameter("shaobing_port", "/dev/rm_usb0");
    this->declare_parameter("shaobing_port_baud", 115200);
    this->declare_parameter("sentry_mode", 3.0);
    this->declare_parameter("vel_spin", 3.3);
    this->declare_parameter("simulation_mode", false);
    this->declare_parameter("cmd_vel_sim_topic", "/cmd_vel_sim");

    this->get_parameter("shaobing_port", serial_port_);
    this->get_parameter("shaobing_port_baud", serial_port_baud_);
    this->get_parameter("simulation_mode", simulation_mode_);
    this->get_parameter("cmd_vel_sim_topic", cmd_vel_sim_topic_);

    // 初始化发布者与订阅者
    referee_pub_ = this->create_publisher<sentry_msgs::msg::Referee>("referee", 10);
    if (simulation_mode_) {
        cmd_vel_sim_pub_ = this->create_publisher<geometry_msgs::msg::Twist>(cmd_vel_sim_topic_, 10);
        RCLCPP_INFO(this->get_logger(), "仿真模式已启用，跳过串口连接，转发 /cmd_vel 到 %s", cmd_vel_sim_topic_.c_str());
    }
    cmd_vel_sub_ = this->create_subscription<geometry_msgs::msg::Twist>(
        "/cmd_vel", 10, std::bind(&Driver::CmdVelCallback, this, std::placeholders::_1));

    if (simulation_mode_) {
        return;
    }

    #if DEBUG_SERIAL
        RCLCPP_INFO(this->get_logger(), "Shaobing Set serial %s at %d baud", serial_port_.c_str(), serial_port_baud_);
    #endif
    // 启动串口
    if (!OpenSerialPort())
    {
        RCLCPP_WARN(this->get_logger(), "初始连接失败，等待自动重连...");
    }
    else
    {
        RCLCPP_INFO(this->get_logger(), "串口已打开: %s", serial_port_.c_str());
    }
    // 始终开启线程
    serial_thread_ = std::thread(&Driver::RecCallback, this);
}

Driver::~Driver() {
    if (!simulation_mode_) {
        static uint8_t vel_data[10];
        vel_data[0] = 0; // Vx
        vel_data[1] = 0;
        vel_data[2] = 0; // Vy
        vel_data[3] = 0;
        vel_data[4] = 0; // Wz
        vel_data[5] = 0;
        vel_data[6] = 3;
        vel_data[7] = 0;
        this->SendDataPacket(vel_data, 8);
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
        RCLCPP_ERROR(this->get_logger(), "串口打开失败: %s", e.what());
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
    static uint8_t vel_data[10];
    
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
                    // this->RecvDataPacketHandle_CmdVel(rx_buf_);
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
        // vision_status.shoot_distance= (buffer_data[i+3]   << 8) | buffer_data[i+4];
        vision_status.shoot_distance=buffer_data[i+3];
    #if DEBUG_VISION_STATUS
    RCLCPP_INFO(this->get_logger(), "IS_Vision_Lost_Flag_Left:%d\r\n", vision_status.IS_Vision_Lost_Flag_Left);
    RCLCPP_INFO(this->get_logger(), "IS_Vision_Lost_Flag_Right:%d\r\n", vision_status.IS_Vision_Lost_Flag_Right);
    RCLCPP_INFO(this->get_logger(), "shoot_distance:%d\r\n", vision_status.shoot_distance);
        
    #endif
        break;
    }
    case CMD_game_status_t:{
        game_status.game_progress     =  buffer_data[i+1];
        game_status.stage_remain_time = (buffer_data[i+2]   << 8) | buffer_data[i+3];


        #if DEBUG_RecvDataPacketHandle_STATUS
            RCLCPP_INFO(this->get_logger(), "game_progress:%d\r\n", game_status.game_progress);
            RCLCPP_INFO(this->get_logger(), "stage_remain_time:%d\r\n", game_status.stage_remain_time);
        #endif
            break;
    }
    case CMD_game_robot_hp_t:{
        game_robot_hp.own_robot_hp     = (buffer_data[i+1]   << 8) | buffer_data[i+2];
        game_robot_hp.enemy_robot_hp   = (buffer_data[i+3]   << 8) | buffer_data[i+4];
        game_robot_hp.enemy_base_hp    = (buffer_data[i+5]   << 8) | buffer_data[i+6];
        game_robot_hp.own_base_hp      = (buffer_data[i+7]   << 8) | buffer_data[i+8];

        #if DEBUG_RecvDataPacketHandle_hp
            RCLCPP_INFO(this->get_logger(), "own_base_hp:%d\r\n,enemy_base_hp:%d\r\n"
                        ,game_robot_hp.own_base_hp,
                        game_robot_hp.enemy_base_hp);

        #endif
            break;
    }
    case CMD_event_data_t:{
        //32位数据分布在buffer_data[i+1]到buffer_data[i+4]中，buffer_data为uint8_t数组
        uint32_t event_data_value = (buffer_data[i+1] << 24) | 
                                (buffer_data[i+2] << 16) | 
                                (buffer_data[i+3] << 8)  | 
                                buffer_data[i+4];


        *(reinterpret_cast<uint32_t*>(&event_data)) = event_data_value;

            #if DEBUG_RecvDataPacketHandle_EVENT
            // 输出解析结果
            // RCLCPP_INFO(this->get_logger(), "supply_zone_non_overlap: %d", event_data.supply_zone_non_overlap);
            // RCLCPP_INFO(this->get_logger(), "supply_zone_overlap: %d", event_data.supply_zone_overlap);
            // RCLCPP_INFO(this->get_logger(), "supply_zone_status: %d", event_data.supply_zone_status);
            RCLCPP_INFO(this->get_logger(), "small_energy_activated: %d", event_data.small_energy_status);
            RCLCPP_INFO(this->get_logger(), "large_energy_status: %d", event_data.large_energy_status);
            // RCLCPP_INFO(this->get_logger(), "central_highland_status: %d", event_data.central_highland_status);
            // RCLCPP_INFO(this->get_logger(), "trapezoid_highland_status: %d", event_data.trapezoid_highland_status);
            // RCLCPP_INFO(this->get_logger(), "last_dart_hit_time: %d", event_data.last_dart_hit_time);
            // RCLCPP_INFO(this->get_logger(), "last_dart_hit_target: %d", event_data.last_dart_hit_target);
            RCLCPP_INFO(this->get_logger(), "fortress_status: %d", event_data.fortress_status);
            // RCLCPP_INFO(this->get_logger(), "center_gain_status: %d", event_data.center_gain_status);
            #endif
                break;
    }
    case CMD_robot_status_t:{
        uint16_t new_hp = (buffer_data[i+1] << 8) | buffer_data[i+2];
        if (last_hp_ > 0 && last_hp_ > new_hp + 10) {
            last_hurt_time_ = this->now();
        }
        last_hp_ = new_hp;
        robot_status.current_hp = new_hp;            
        robot_status.maximum_hp = (buffer_data[i+3] << 8) | buffer_data[i+4];

        #if DEBUG_RecvDataPacketHandle_CurrentMaxhp
            RCLCPP_INFO(this->get_logger(), "current_hp:%d", robot_status.current_hp);
            RCLCPP_INFO(this->get_logger(), "maximum_hp:%d", robot_status.maximum_hp);

        #endif

            break;            
    }
    case CMD_robot_pos_t:{
        robot_pos.x     = ((buffer_data[i+1]*1000) << 8) | (buffer_data[i+2]*1000);
        robot_pos.y     = ((buffer_data[i+3]*1000) << 8) | (buffer_data[i+4]*1000);
        robot_pos.angle = ((buffer_data[i+5]*1000) << 8) | (buffer_data[i+6]*1000);

        #if DEBUG_RecvDataPacketHandle_POSE
            RCLCPP_INFO(this->get_logger(), "robot_pos.x:%f, robot_pos.y:%f, robot_pos.angle:%f",
                        robot_pos.x, robot_pos.y, robot_pos.angle);
        #endif

            break;
    }
    case CMD_buff_t:{
        buff.defence_buff = buffer_data[i+1];
        buff.vulnerability_buff = buffer_data[i+2];
        buff.attack_buff = (buffer_data[i+3] << 8) | buffer_data[i+4];

        #if DEBUG_RecvDataPacketHandle_BUFF
            RCLCPP_INFO(this->get_logger(),"defence_buff:%d\r\n,vulnerability_buff:%d\r\n,attack_buff:%d\r\n",
                        buff.defence_buff, buff.vulnerability_buff, buff.attack_buff);
            
        #endif
            break;            
    }
    case CMD_hurt_data_t:{
        hurt_data.armor_id = buffer_data[i+1];
        hurt_data.hp_deduction_reason = buffer_data[i+2];

        #if DEBUG_RecvDataPacketHandle_HURT
            RCLCPP_INFO(this->get_logger(), "armor_id:%d, hp_deduction_reason:%d",
                        hurt_data.armor_id, hurt_data.hp_deduction_reason);            
        #endif
            break;            
    }
    case CMD_projectile_allowance_t:{
        projectile_allowance.projectile_allowance_17mm = (buffer_data[i+1] << 8) | buffer_data[i+2];

        #if DEBUG_RecvDataPacketHandle_ALLOWANCE
                RCLCPP_INFO(this->get_logger(), "projectile_allowance_17mm:%d",
                        projectile_allowance.projectile_allowance_17mm);
        #endif
            break;            
    }
    case CMD_rfid_status_t:{
        //完整32位数据暂时用不上，先注释
        uint32_t rfid_status_value = (buffer_data[i+1] << 24) |
                            (buffer_data[i+2] << 16) |
                            (buffer_data[i+3] << 8)  |
                            buffer_data[i+4];
        // rfid_status.rfid_status = (buffer_data[i+1] << 8) | buffer_data[i+2];
        *(reinterpret_cast<uint32_t*>(&rfid_status)) = rfid_status_value;

            #if DEBUG_RecvDataPacketHandle_RFID
            #endif
                break;
    }
    case CMD_map_command_t:{
        std::memcpy(&map_command.target_position_x, &buffer_data[i+1], sizeof(map_command.target_position_x));
        std::memcpy(&map_command.target_position_y, &buffer_data[i+5], sizeof(map_command.target_position_y));
        map_command.cmd_keyboard = buffer_data[i+9];
        map_command.target_robot_id = buffer_data[i+10];
        map_command.cmd_source = (buffer_data[i+11] << 8) | buffer_data[i+12];

        break;
    }
}

    // obtain_shoot_num的数值逻辑：比赛开始后，每隔 1 分钟，哨兵机器人可以通过占领己方补给区增益点获取 100 发允许发弹量，未通过此方式获取的允许发弹量可以累积。
    if (game_status.game_progress == 4) { // 4: 对战中
        int current_minute = (420 - game_status.stage_remain_time) / 60;
        if (current_minute < 0) current_minute = 0;
        if (current_minute > 6) current_minute = 6;

        // 如果占领了己方补给区，更新已获取的包数
        if (rfid_status.supply_zone_non_overlap||rfid_status.supply_zone_overlap) {
            obtained_shoot_num = current_minute;
        }
        
        // 计算待获取的子弹量：(当前分钟数 - 已获取包数) * 100
        if (current_minute > obtained_shoot_num) {
            obtainable_shoot_num = (current_minute - obtained_shoot_num) * 100;
        } else {
            obtainable_shoot_num = 0;
        }
    } else {
        // 非对战状态，重置逻辑
        obtained_shoot_num = 0;
        obtainable_shoot_num = 0;
    }

    msgs.header.stamp            = this->now();
    msgs.shoot_distance          = vision_status.shoot_distance;
    msgs.vision_status           =(vision_status.IS_Vision_Lost_Flag_Left)||(vision_status.IS_Vision_Lost_Flag_Right);
    msgs.game_progress           = game_status.game_progress;
    msgs.stage_remain_time       = game_status.stage_remain_time;
    msgs.own_robot_hp            = game_robot_hp.own_robot_hp;
    msgs.own_base_hp             = game_robot_hp.own_base_hp;
    msgs.enemy_base_hp           = game_robot_hp.enemy_base_hp;
    msgs.current_hp              = robot_status.current_hp;
    msgs.fortress_status         = event_data.fortress_status;
    msgs.armor_id                = hurt_data.armor_id;
    msgs.hp_deduction_reason     = hurt_data.hp_deduction_reason;
    msgs.shoot_num               = projectile_allowance.projectile_allowance_17mm;
    msgs.obtainable_shoot_num    = obtainable_shoot_num;
    msgs.supply_zone_non_overlap = rfid_status.supply_zone_non_overlap;
    msgs.supply_zone_overlap     = rfid_status.supply_zone_overlap;
    msgs.rune_statues            = (event_data.small_energy_status)||(event_data.large_energy_status);
    msgs.target_position_x       = map_command.target_position_x;
    msgs.target_position_y       = map_command.target_position_y;
    msgs.cmd_keyboard            = map_command.cmd_keyboard;
    msgs.target_robot_id         = map_command.target_robot_id;
    msgs.cmd_source              = map_command.cmd_source;

    #if DEBUG_MSGS
    RCLCPP_INFO(this->get_logger(), "----/referee发布的信息-----");
    RCLCPP_INFO(this->get_logger(), "\033[2J\033[H");  // 这行代码会清除控制台，并将光标移至左上角
    RCLCPP_INFO(this->get_logger(), "msgs.game_progress:%d", msgs.game_progress);
    RCLCPP_INFO(this->get_logger(), "msgs.stage_remain_time:%d", msgs.stage_remain_time);
    RCLCPP_INFO(this->get_logger(), "msgs.own_robot_hp:%d", msgs.own_robot_hp);
    RCLCPP_INFO(this->get_logger(), "msgs.own_base_hp:%d", msgs.own_base_hp);
    RCLCPP_INFO(this->get_logger(), "msgs.vision_status:%d", msgs.vision_status);
    RCLCPP_INFO(this->get_logger(), "msgs.center_gain_status:%d", msgs.center_gain_status);
    RCLCPP_INFO(this->get_logger(), "msgs.current_hp:%d", msgs.current_hp);
    RCLCPP_INFO(this->get_logger(), "msgs.armor_id:%d", msgs.armor_id);
    RCLCPP_INFO(this->get_logger(), "msgs.hp_deduction_reason:%d", msgs.hp_deduction_reason);
    RCLCPP_INFO(this->get_logger(), "msgs.shoot_num:%d", msgs.shoot_num);
    RCLCPP_INFO(this->get_logger(), "msgs.obtainable_shoot_num:%d", msgs.obtainable_shoot_num);
    RCLCPP_INFO(this->get_logger(), "msgs.supply_zone_non_overlap:%d", msgs.supply_zone_non_overlap);
    RCLCPP_INFO(this->get_logger(), "msgs.supply_zone_overlap:%d", msgs.supply_zone_overlap);
    RCLCPP_INFO(this->get_logger(), "msgs.shoot_distance:%d", msgs.shoot_distance);

    #endif
    referee_pub_->publish(msgs);
}

/**
    @brief 处理速度信息的回调函数
*/
void Driver::CmdVelCallback(const geometry_msgs::msg::Twist::SharedPtr msg) {
    if (simulation_mode_) {
        if (cmd_vel_sim_pub_) {
            cmd_vel_sim_pub_->publish(*msg);
        }
        return;
    }

    double param_vel_spin = 5.0;
    double condition = 0.0; 
    this->get_parameter("vel_spin", param_vel_spin);
    this->get_parameter("condition", condition);

    uint8_t mode = 3; // 默认移动姿态
    if(robot_status.current_hp>150&&projectile_allowance.projectile_allowance_17mm>=30)
    {
        if (std::abs(msg->linear.x) < 0.01 && std::abs(msg->linear.y) < 0.01) {
            mode = 2; // 防御姿态
        }
        if (vision_status.IS_Vision_Lost_Flag_Left == 1 || vision_status.IS_Vision_Lost_Flag_Right == 1) {
            mode = 1; // 攻击姿态
        }
    }

    uint8_t vel_data[8];
    int16_t vel_x = static_cast<int16_t>(msg->linear.x * 1000);
    int16_t vel_y = static_cast<int16_t>(msg->linear.y * 1000);
    int16_t vel_spin = static_cast<int16_t>(param_vel_spin * 1000); 
    // int16_t vel_spin = static_cast<int16_t>(0 * 1000); 
    vel_data[0] = (vel_x >> 8) & 0xFF; vel_data[1] = vel_x & 0xFF;
    vel_data[2] = (vel_y >> 8) & 0xFF; vel_data[3] = vel_y & 0xFF;
    vel_data[4] = (vel_spin >> 8) & 0xFF; vel_data[5] = vel_spin & 0xFF;
    vel_data[6] = mode;
    vel_data[7] = static_cast<uint8_t>(condition);
    
    #if DEBUG_CmdVelCallback_Vel_Data
    RCLCPP_INFO(this->get_logger(), 
                "vel_x: %.2f, vel_y: %.2f, vel_spin: %.2f, mode: %d, condition: %.2f", 
                msg->linear.x, 
                msg->linear.y, 
                param_vel_spin,
                mode,
                condition);
    #endif
    SendDataPacket(vel_data, 8);
}

/**
    @brief 构建一个数据包并通过串口发送该数据包的函数
*/    
void Driver::SendDataPacket(uint8_t *pbuf, uint8_t len)
{
    if (!serial_ptr_ || !serial_ptr_->is_open()) return;

    uint8_t i, cnt;          // 发送计数器cnt
    uint8_t tx_checksum = 0; // 发送校验和
    uint8_t tx_buf[30];      // 发送缓冲

    if(len < 30) //判别是否超出长度
    {
        //取出数据
        tx_buf[0] = 0xAA; //帧头1
        tx_buf[1] = 0x55; //帧头2
        tx_buf[2] = len + 5; //根据输出的长度计算帧长度，len是数据位长度，5是双帧头+帧长度+帧识别码+校验和共5位
        tx_buf[3] = 0;

        for(i = 0; i < len; i++)
        {
            //帧第五位开始依次提取出，数据包位(一个数组)从下标0起始的数据
            tx_buf[4 + i] = *(pbuf + i);
        }
        //计算末尾位校验和
        cnt = 4 + len; //要累加多少位，这里除了末尾校验位是前四位+数据位
        for(i = 0; i < cnt; i++)
        {
            tx_checksum += tx_buf[i];
        }
        tx_buf[i] = tx_checksum; //赋值校验和结果到末位
        // ROS_INFO("%x",tx_checksum);
        cnt = len+5;
        //发送数据
        boost::asio::write(*serial_ptr_.get(),boost::asio::buffer(tx_buf,cnt),error_code_);
    }
}


} // namespace qd_driver

int main(int argc, char **argv) {
    rclcpp::init(argc, argv);
    auto node = std::make_shared<qd_driver::Driver>();
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}
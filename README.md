# ROS2 Navigation Simulation

面向 RoboMaster RMUC/RMUL 哨兵机器人的自主导航仿真系统。基于 ROS2 Humble，使用 Gazebo 仿真、Livox Mid-360 激光雷达、Nav2 全向底盘控制，并由裁判系统驱动的决策树实现自主巡逻与导航。

## 目录结构

```
src/
├── bringup/                      # 顶层启动、Nav2 参数、地图、RViz 配置
├── decision_executor/            # 裁判系统驱动的决策树执行节点
├── dynamic_message_dashboard_ros2/  # PyQt6 裁判消息模拟面板
├── livox_laser_simulation_RO2/   # Gazebo Livox 扫描模式仿真插件
├── livox_ros_driver2/            # Livox 雷达驱动
├── localization/                
│   ├── Super-LIO-ros2/           # ESKF 激光惯性里程计 + 重定位
│   ├── point_lio/                # Point-LIO
│   └── small_point_lio/          # small-Point-LIO
├── nav2_waypoint_panel/          # RViz 多航点导航面板与工具
├── pb_nav2_plugins/              # Nav2 扩展行为与代价地图插件
├── pb_omni_pid_pursuit_controller/  # 全向 PID 纯追踪控制器
├── sentry_msgs/                  # 裁判系统自定义消息定义
├── serial_interfaces/            # 裁判系统与底盘串口驱动
├── simulation/                   # Gazebo 仿真
└── visual-decision-editor/       # Web 端可视化决策树编辑器
```

## Quick Start

通过 Docker 一键启动（容器内已构建好工作空间）：

```bash
sudo docker run -dit \
  --name=ros2_nav_simulation \
  --privileged \
  -v /dev:/dev \
  -v /home/${SUDO_USER:-$USER}:/home/${SUDO_USER:-$USER} \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -e DISPLAY=$DISPLAY \
  -w /home/${SUDO_USER:-$USER} \
  --net=host \
  faise1/ros2_nav_simulation:v2.0
```

> 镜像基于 ROS2 Humble（Ubuntu 22.04），已预装工作空间与依赖。

## 启动

```bash
source install/setup.bash
ros2 launch bringup bringup.launch.py
```


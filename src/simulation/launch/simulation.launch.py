#!/usr/bin/env python3

import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.substitutions import LaunchConfiguration, Command
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node
from launch.conditions import IfCondition
from launch.actions.append_environment_variable import AppendEnvironmentVariable

def generate_launch_description():
    # 1. 路径设置
    bringup_dir = get_package_share_directory('simulation')
    pkg_gazebo_ros = get_package_share_directory('gazebo_ros')
    
    # --- 世界配置 ---
    world_path = os.path.join(bringup_dir, 'world', 'RMUC2025.world')
    spawn_x, spawn_y, spawn_z, spawn_yaw = '0.0', '0.0', '0.0', '0.0'
    # ------------------------------------

    # 2. Xacro / 机器人描述文件
    default_robot_description = Command(['xacro ', os.path.join(bringup_dir, 'urdf', 'simulation_waking_robot.xacro')])

    # 3. 启动配置变量
    use_sim_time = LaunchConfiguration('use_sim_time')
    use_rviz = LaunchConfiguration('rviz', default='false')
    robot_description = LaunchConfiguration('robot_description')

    # 4. 设置环境变量（Gazebo 插件路径）
    append_environment = AppendEnvironmentVariable(
        'GAZEBO_PLUGIN_PATH',
        os.path.join(bringup_dir, 'meshes', 'obstacles', 'obstacle_plugin', 'lib')
    )

    # 5. 声明启动参数
    declare_use_sim_time_cmd = DeclareLaunchArgument(
        'use_sim_time', default_value='True', description='Use simulation clock'
    )
    declare_robot_description_cmd = DeclareLaunchArgument(
        'robot_description', default_value=default_robot_description, description='Robot description'
    )

    # 6. 节点与动作定义
    
    # 启动 Gazebo 服务器 (加载固定世界文件)
    start_gzserver_cmd = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(pkg_gazebo_ros, 'launch', 'gzserver.launch.py')),
        launch_arguments={'world': world_path}.items(),
    )

    # 启动 Gazebo 客户端 (GUI界面)
    start_gzclient_cmd = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(pkg_gazebo_ros, 'launch', 'gzclient.launch.py')),
    )

    # 在 Gazebo 中生成机器人
    spawn_robot_cmd = Node(
        package='gazebo_ros',
        executable='spawn_entity.py',
        arguments=[
            '-entity', 'robot',
            '-topic', 'robot_description',
            '-x', spawn_x,
            '-y', spawn_y,
            '-z', spawn_z,
            '-Y', spawn_yaw
        ],
    )

    # 状态发布节点
    start_joint_state_publisher_cmd = Node(
        package='joint_state_publisher',
        executable='joint_state_publisher',
        parameters=[{'use_sim_time': use_sim_time, 'robot_description': robot_description}]
    )

    start_robot_state_publisher_cmd = Node(
        package='robot_state_publisher',
        executable='robot_state_publisher',
        parameters=[{'use_sim_time': use_sim_time, 'robot_description': robot_description}]
    )

    # RViz2 可选启动
    start_rviz_cmd = Node(
        condition=IfCondition(use_rviz),
        package='rviz2',
        executable='rviz2',
        arguments=['-d', os.path.join(bringup_dir, 'rviz', 'rviz2.rviz')]
    )

    # 7. 构建并返回启动描述
    ld = LaunchDescription()
    ld.add_action(append_environment)
    ld.add_action(declare_use_sim_time_cmd)
    ld.add_action(declare_robot_description_cmd)
    
    # 添加核心动作
    ld.add_action(start_gzserver_cmd)
    ld.add_action(start_gzclient_cmd)
    ld.add_action(spawn_robot_cmd)
    ld.add_action(start_joint_state_publisher_cmd)
    ld.add_action(start_robot_state_publisher_cmd)
    ld.add_action(start_rviz_cmd)

    return ld
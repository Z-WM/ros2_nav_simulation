import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    # 获取 lio_relocalization 包的 share 目录,据此定位配置文件、RViz 配置
    pkg = get_package_share_directory('lio_relocalization')
    config_yaml = os.path.join(pkg, 'config', 'relocation.yaml')
    rviz_config_file = os.path.join(pkg, 'rviz', 'relocation.rviz')

    # 是否启动 RViz2,默认不启动
    declare_rviz_arg = DeclareLaunchArgument(
        'rviz',
        default_value='false',
        description='Whether to start RVIZ2',
    )
    rviz_flag = LaunchConfiguration('rviz')

    # use_sim_time 默认为 true,使节点以 ROS 仿真时钟给 map->odom / pose /
    # global_map 打时间戳,与本栈其余部分(Nav2、仿真、LIO)对齐。
    # 否则 this->now() 返回墙钟时间,而 Nav2 的 TF 查询使用仿真时间,
    # 会报 "extrapolation into the past" 错误。
    declare_sim_time_arg = DeclareLaunchArgument(
        'use_sim_time',
        default_value='true',
        description='Use the ROS /clock (simulation) time if true',
    )
    use_sim_time = LaunchConfiguration('use_sim_time')

    # 重定位节点:加载 relocation.yaml 参数,并显式注入 use_sim_time
    relocalization_node = Node(
        package='lio_relocalization',
        executable='relocalization_node',
        name='relocalization_node',
        output='screen',
        parameters=[config_yaml, {'use_sim_time': use_sim_time}],
        arguments=['--ros-args', '--log-level', 'info'],
    )

    # RViz2 节点:仅在 rviz:=true 时启动,加载预置的 relocation.rviz
    rviz2_node = Node(
        package='rviz2',
        executable='rviz2',
        name='lio_relocalization_rviz2',
        arguments=['-d', rviz_config_file, '--ros-args', '--log-level', 'warn'],
        condition=IfCondition(rviz_flag),
    )

    ld = LaunchDescription()
    ld.add_action(declare_rviz_arg)
    ld.add_action(declare_sim_time_arg)
    ld.add_action(relocalization_node)
    ld.add_action(rviz2_node)
    return ld

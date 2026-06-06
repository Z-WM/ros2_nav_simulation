import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    pkg_name = 'dynamic_message_dashboard_ros2'
    
    # 启动 Dashboard 节点
    dashboard_node = Node(
        package=pkg_name,
        executable=pkg_name,
        name='dynamic_message_dashboard',
        output='screen'
    )

    return LaunchDescription([
        dashboard_node
    ])

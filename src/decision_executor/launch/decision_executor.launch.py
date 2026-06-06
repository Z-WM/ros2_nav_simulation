from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
import os
from ament_index_python.packages import get_package_share_directory


def generate_launch_description():
    # 获取包路径
    pkg_dir = get_package_share_directory('decision_executor')
    
    # 声明启动参数
    config_file_arg = DeclareLaunchArgument(
        'config_file',
        default_value=os.path.join(pkg_dir, 'config', 'decision_config.yaml'),
        description='决策配置文件路径'
    )
    
    # 决策执行器节点
    decision_executor_node = Node(
        package='decision_executor',
        executable='decision_executor',
        name='decision_executor',
        output='screen',
        parameters=[{
            'config_file': LaunchConfiguration('config_file')
        }]
    )
    
    return LaunchDescription([
        config_file_arg,
        decision_executor_node
    ])

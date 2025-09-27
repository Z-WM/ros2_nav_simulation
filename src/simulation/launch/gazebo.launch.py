import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.substitutions import LaunchConfiguration, Command
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node

def generate_launch_description():
    # 获取包的共享目录
    pkg_share = get_package_share_directory('simulation')

    # 启动参数
    use_sim_time = LaunchConfiguration('use_sim_time', default='true')
    
    # 指定xacro路径
    default_robot_description = Command(['xacro ', os.path.join(
    get_package_share_directory('simulation'), 'urdf', 'my_car.xacro')])

    robot_description = LaunchConfiguration('robot_description')

    declare_robot_description_cmd = DeclareLaunchArgument(
        'robot_description',
        default_value=default_robot_description,
        description='Robot description'
    )
    # 声明启动参数
    declare_use_sim_time_cmd = DeclareLaunchArgument(
        'use_sim_time',
        default_value='true',
        description='Use simulation (Gazebo) clock if true'
    )

    # Gazebo服务器启动
    gzserver_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(
                get_package_share_directory('gazebo_ros'),
                'launch',
                'gzserver.launch.py'
            )
        ),
        launch_arguments={
            'world': os.path.join(pkg_share, 'worlds', 'rmuc2025.world')  # 修正路径和文件名
        }.items()
    )
    # Gazebo客户端启动
    gzclient_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(
                get_package_share_directory('gazebo_ros'),
                'launch',
                'gzclient.launch.py'
            )
        )
    )

    start_joint_state_publisher_cmd = Node(
        package='joint_state_publisher',
        executable='joint_state_publisher',
        name='joint_state_publisher',
        parameters=[{
            'use_sim_time': use_sim_time,
            'robot_description': robot_description
        }],
        output='screen'
    )

    start_robot_state_publisher_cmd = Node(
        package='robot_state_publisher',
        executable='robot_state_publisher',
        name='robot_state_publisher',
        parameters=[{
            'use_sim_time': use_sim_time,
            'robot_description': robot_description
        }],
        output='screen'
    )

    # 在Gazebo中生成机器人
    spawn_robot_cmd = Node(
        package='gazebo_ros',
        executable='spawn_entity.py',
        arguments=[
            '-entity', 'robot',
            '-topic', 'robot_description',
            '-x', '0',
            '-y', '0',
            '-z', '0.3',  # 增加高度避免碰撞地面
            '-Y', '0'
        ],
        output='screen'
    )

    return LaunchDescription([
        declare_use_sim_time_cmd,
        declare_robot_description_cmd,

        gzserver_launch,
        gzclient_launch,
        start_robot_state_publisher_cmd,
        start_joint_state_publisher_cmd,
        spawn_robot_cmd,
    ])
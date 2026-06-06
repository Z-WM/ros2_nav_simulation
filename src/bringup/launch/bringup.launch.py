import os

from ament_index_python.packages import get_package_share_directory

from launch import LaunchDescription
from launch.actions import (DeclareLaunchArgument, GroupAction,
                            IncludeLaunchDescription, TimerAction,
                            LogInfo, ExecuteProcess, SetEnvironmentVariable)
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration ,TextSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare
from launch.substitutions import PathJoinSubstitution
from launch.conditions import IfCondition

def generate_launch_description():
   # 设置环境变量，确保日志输出是缓冲的
    # stdout_linebuf_envvar = SetEnvironmentVariable(
    #     'RCUTILS_LOGGING_BUFFERED_STREAM', '1'
    # )
    # 获取与拼接默认路径
    bringup_dir = get_package_share_directory(
        'bringup')

    # 创建启动配置变量
    use_sim_time = LaunchConfiguration('use_sim_time')

    # 声明启动参数
    declare_use_sim_time_cmd = DeclareLaunchArgument(
        'use_sim_time',
        default_value='true',
        description='Use simulation clock if true'
    )

    declare_map_yaml_cmd = DeclareLaunchArgument(
        "map",
        default_value=[
            TextSubstitution(text=os.path.join(bringup_dir, "map",  "test.yaml")),
        ],
        description="Full path to map file to load",
    )

    declare_params_file_cmd = DeclareLaunchArgument(
        "params_file",
        default_value=os.path.join(
            bringup_dir, "config", "nav2_params_pid.yaml"
        ),
    )

    declare_rviz_config_file_cmd = DeclareLaunchArgument(
        "rviz_config",
        default_value=os.path.join(bringup_dir, "rviz", "rviz2_waypoint_test.rviz"),
        description="Full path to the RViz config file to use",
    )

    rviz_config_file = LaunchConfiguration("rviz_config")

     # 指定动作组
    bringup_cmd_group = GroupAction([
    
        # 添加静态坐标发布,参数顺序：x y z roll pitch yaw frame_id child_frame_id
        Node(
            package='tf2_ros',
            executable='static_transform_publisher',
            name='map_to_odom',
            arguments=['0', '0', '0', '0', '0', '0', 'map', 'odom']
        ),

        Node(
            package='serial_interfaces',
            executable='serial_interfaces',
            name='serial_interfaces'
        ),

        IncludeLaunchDescription(
                launch_description_source=PythonLaunchDescriptionSource([
                    PathJoinSubstitution([
                        FindPackageShare('bringup'),
                        'launch',
                        'navigation_launch.py'
                    ])
                ]),
                launch_arguments={'use_sim_time': use_sim_time}.items()
            ),
        IncludeLaunchDescription(
                launch_description_source=PythonLaunchDescriptionSource([
                    PathJoinSubstitution([
                        FindPackageShare('simulation'),
                        'launch',
                        'simulation.launch.py'
                    ])
                ]),
                launch_arguments={'use_sim_time': use_sim_time}.items()
            ),

        # IncludeLaunchDescription(
        #         launch_description_source=PythonLaunchDescriptionSource([
        #             PathJoinSubstitution([
        #                 FindPackageShare('decision_executor'),
        #                 'launch',
        #                 'decision_executor.launch.py'
        #             ])
        #         ]),
        #     ),

        IncludeLaunchDescription(
                launch_description_source=PythonLaunchDescriptionSource([
                    PathJoinSubstitution([
                        FindPackageShare('dynamic_message_dashboard_ros2'),
                        'launch',
                        'dynamic_message_dashboard_ros2.launch.py'
                    ])
                ]),
            ),

    Node(
        package="rviz2",
        executable="rviz2",
        arguments=["-d", rviz_config_file],
        output="screen",
    )

     ])

    
    # 创建启动描述
    ld = LaunchDescription()
    

    # Declare the launch options
    ld.add_action(declare_map_yaml_cmd)
    ld.add_action(declare_use_sim_time_cmd)
    ld.add_action(declare_params_file_cmd)
    ld.add_action(declare_rviz_config_file_cmd)

    # 添加参数声明
    ld.add_action(declare_use_sim_time_cmd)
    
    # 添加启动所有节点的动作组
    ld.add_action(bringup_cmd_group)
    
    return ld
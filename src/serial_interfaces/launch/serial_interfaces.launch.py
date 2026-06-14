import os
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    # 定义驱动节点
    serial_interfaces_node = Node(
        package='serial_interfaces',
        executable='serial_interfaces', 
        name='serial_interfaces',
        output='screen',
        emulate_tty=True, 
        parameters=[
            {
                # 仿真模式：跳过串口连接，将 /cmd_vel 转发到 /cmd_vel_sim
                'simulation_mode': True,
                'cmd_vel_sim_topic': '/cmd_vel_sim',

                # 实车模式使用的串口配置
                'shaobing_port': '/dev/rm_usb0',
                'shaobing_port_baud': 115200,
            }
        ],
        remappings=[
            ('/cmd_vel', '/cmd_vel'),
            ('referee', 'referee')
        ]
    )

    return LaunchDescription([
        serial_interfaces_node
    ])
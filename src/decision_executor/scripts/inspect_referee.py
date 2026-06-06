#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from sentry_msgs.msg import Referee

class RefereeInspector(Node):
    def __init__(self):
        super().__init__('referee_inspector')
        self.subscription = self.create_subscription(
            Referee,
            '/referee',
            self.listener_callback,
            10)
        self.subscription  # prevent unused variable warning
        self.get_logger().info('Referee Inspector Started. Listening to /referee...')

    def listener_callback(self, msg):
        self.get_logger().info(f'Received Referee: center_occupy={msg.center_occupy}, game_progress={msg.game_progress}, stage_remainder={msg.stage_remain_time}')

def main(args=None):
    rclpy.init(args=args)
    inspector = RefereeInspector()
    rclpy.spin(inspector)
    inspector.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()

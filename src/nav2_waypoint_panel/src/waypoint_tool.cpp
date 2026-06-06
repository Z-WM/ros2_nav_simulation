#include "nav2_waypoint_panel/waypoint_tool.hpp"
#include "rviz_common/display_context.hpp"
#include <tf2/LinearMath/Quaternion.h>
#include <tf2_geometry_msgs/tf2_geometry_msgs.hpp>

namespace nav2_waypoint_panel
{

WaypointTool::WaypointTool()
{
  shortcut_key_ = 'w';
}

void WaypointTool::onInitialize()
{
  PoseTool::onInitialize();
  node_ = context_->getRosNodeAbstraction().lock()->get_raw_node();
  publisher_ = node_->create_publisher<geometry_msgs::msg::PoseStamped>("/waypoint", 10);
  setName("waypoint");
}

void WaypointTool::onPoseSet(double x, double y, double theta)
{
  geometry_msgs::msg::PoseStamped msg;
  msg.header.stamp = node_->now();
  msg.header.frame_id = context_->getFixedFrame().toStdString();
  msg.pose.position.x = x;
  msg.pose.position.y = y;
  msg.pose.position.z = 0;

  tf2::Quaternion q;
  q.setRPY(0, 0, theta);
  msg.pose.orientation = tf2::toMsg(q);

  publisher_->publish(msg);
}

}  // namespace nav2_waypoint_panel

#include <pluginlib/class_list_macros.hpp>
PLUGINLIB_EXPORT_CLASS(nav2_waypoint_panel::WaypointTool, rviz_common::Tool)

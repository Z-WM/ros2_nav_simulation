#ifndef NAV2_WAYPOINT_PANEL__WAYPOINT_TOOL_HPP_
#define NAV2_WAYPOINT_PANEL__WAYPOINT_TOOL_HPP_

#include "rviz_default_plugins/tools/pose/pose_tool.hpp"
#include "rclcpp/rclcpp.hpp"
#include "geometry_msgs/msg/pose_stamped.hpp"

namespace nav2_waypoint_panel
{

class WaypointTool : public rviz_default_plugins::tools::PoseTool
{
  Q_OBJECT
public:
  WaypointTool();
  virtual ~WaypointTool() = default;

  virtual void onInitialize() override;

protected:
  virtual void onPoseSet(double x, double y, double theta) override;

private:
  rclcpp::Publisher<geometry_msgs::msg::PoseStamped>::SharedPtr publisher_;
  rclcpp::Node::SharedPtr node_;
};

}  // namespace nav2_waypoint_panel

#endif  // NAV2_WAYPOINT_PANEL__WAYPOINT_TOOL_HPP_

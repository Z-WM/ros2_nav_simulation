#ifndef NAV2_WAYPOINT_PANEL__WAYPOINT_PANEL_HPP_
#define NAV2_WAYPOINT_PANEL__WAYPOINT_PANEL_HPP_

#include <QtWidgets>
#include <memory>
#include <vector>
#include <string>

#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "rviz_common/panel.hpp"
#include "geometry_msgs/msg/pose_stamped.hpp"
#include "nav2_msgs/action/follow_waypoints.hpp"
#include "nav2_msgs/action/navigate_to_pose.hpp"
#include "nav2_msgs/action/navigate_through_poses.hpp"
#include "visualization_msgs/msg/marker_array.hpp"
#include "nav2_lifecycle_manager/lifecycle_manager_client.hpp"

namespace nav2_waypoint_panel
{

class WaypointPanel : public rviz_common::Panel
{
  Q_OBJECT
public:
  explicit WaypointPanel(QWidget * parent = nullptr);
  virtual ~WaypointPanel();

  void onInitialize() override;
  void load(const rviz_common::Config & config) override;
  void save(rviz_common::Config config) const override;

protected Q_SLOTS:
  void onStartNavigation();
  void onRestartNavigation();
  void onClearWaypoints();
  void onCancelNavigation();
  void onExportWaypoints();
  void onLoadWaypoints();
  void onDeleteWaypoint();
  void onMoveWaypointUp();
  void onMoveWaypointDown();
  void onModeChanged(int index);
  void showContextMenu(const QPoint & pos);

protected:
  void sendWaypointGoal(const std::vector<geometry_msgs::msg::PoseStamped>& poses);
  void sendNavigateThroughPoses(const std::vector<geometry_msgs::msg::PoseStamped>& poses);
  void cancelActiveGoal();
  void updateMarkers();
  void goalResponseCallback(const rclcpp_action::ClientGoalHandle<nav2_msgs::action::FollowWaypoints>::SharedPtr & goal_handle);
  void resultCallback(const rclcpp_action::ClientGoalHandle<nav2_msgs::action::FollowWaypoints>::WrappedResult & result);
  void feedbackCallback(
    rclcpp_action::ClientGoalHandle<nav2_msgs::action::FollowWaypoints>::SharedPtr,
    const std::shared_ptr<const nav2_msgs::action::FollowWaypoints::Feedback> feedback);
  void ntpGoalResponseCallback(const rclcpp_action::ClientGoalHandle<nav2_msgs::action::NavigateThroughPoses>::SharedPtr & goal_handle);
  void ntpResultCallback(const rclcpp_action::ClientGoalHandle<nav2_msgs::action::NavigateThroughPoses>::WrappedResult & result);
  void ntpFeedbackCallback(
    rclcpp_action::ClientGoalHandle<nav2_msgs::action::NavigateThroughPoses>::SharedPtr,
    const std::shared_ptr<const nav2_msgs::action::NavigateThroughPoses::Feedback> feedback);

  // ROS2 elements
  rclcpp::Node::SharedPtr node_;
  rclcpp::Subscription<geometry_msgs::msg::PoseStamped>::SharedPtr goal_sub_;
  rclcpp::Publisher<visualization_msgs::msg::MarkerArray>::SharedPtr marker_pub_;
  rclcpp_action::Client<nav2_msgs::action::FollowWaypoints>::SharedPtr action_client_;
  rclcpp_action::ClientGoalHandle<nav2_msgs::action::FollowWaypoints>::SharedPtr current_goal_handle_;
  rclcpp_action::Client<nav2_msgs::action::NavigateThroughPoses>::SharedPtr ntp_action_client_;
  rclcpp_action::ClientGoalHandle<nav2_msgs::action::NavigateThroughPoses>::SharedPtr ntp_goal_handle_;
  
  // Feedback subscribers for the dashboard
  rclcpp::Subscription<nav2_msgs::action::NavigateToPose::Impl::FeedbackMessage>::SharedPtr nav_feedback_sub_;

  // UI elements
  QPushButton * start_button_;
  QPushButton * restart_button_;
  QPushButton * clear_button_;
  QPushButton * cancel_button_;
  QPushButton * export_button_;
  QPushButton * load_button_;
  QComboBox * mode_selector_;
  
  QListWidget * waypoint_list_;

  // Dashboard Labels
  QLabel * nav_status_val_;
  QLabel * loc_status_val_;
  QLabel * feedback_val_;
  QLabel * poses_rem_val_;
  QLabel * eta_val_;
  QLabel * dist_rem_val_;
  QLabel * time_taken_val_;
  QLabel * recoveries_val_;

  // Data
  std::vector<geometry_msgs::msg::PoseStamped> waypoints_;
  bool is_navigating_{false};
  uint32_t current_waypoint_index_{0};
  uint32_t nav_start_index_{0};
  // NTP has no per-waypoint index in feedback; track how many poses have been
  // passed (total - number_of_poses_remaining) so Start Nav can resume from the
  // last unpassed pose instead of re-sending the whole list.
  uint32_t ntp_passed_count_{0};

  enum class NavMode { FollowWaypoints = 0, NavigateThroughPoses = 1 };
  NavMode selected_mode_{NavMode::FollowWaypoints};
  NavMode active_mode_{NavMode::FollowWaypoints};

  // Helper
  void updateDashboard(const nav2_msgs::action::NavigateToPose::Feedback & feedback);
  void updateDashboard(const nav2_msgs::action::NavigateThroughPoses::Feedback & feedback);
  void checkSystemStatus();
  void updateWaypointList();
  QTimer * status_timer_;
};

}  // namespace nav2_waypoint_panel

#endif  // NAV2_WAYPOINT_PANEL__WAYPOINT_PANEL_HPP_

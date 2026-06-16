#ifndef DECISION_EXECUTOR__DECISION_EXECUTOR_HPP_
#define DECISION_EXECUTOR__DECISION_EXECUTOR_HPP_

#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <nav2_msgs/action/navigate_to_pose.hpp>
#include <geometry_msgs/msg/pose_stamped.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <geometry_msgs/msg/twist.hpp>
#include "sentry_msgs/msg/referee.hpp"
#include "decision_executor/DecisionNode.hpp"
#include "decision_executor/FieldMapper.hpp"
#include <yaml-cpp/yaml.h>
#include <map>
#include <set>
#include <memory>
#include <cmath>

namespace decision_executor
{

struct ZoneRect { double x1, y1, x2, y2; };
struct ZoneWorldRect { double x1, y1, x2, y2; };
using PolygonVertex = std::pair<double, double>;
using Polygon = std::vector<PolygonVertex>;
struct ZoneDefinition {
  std::string id;
  std::string name;
  ZoneWorldRect worldRect;     // bounding box (backward compat)
  Polygon worldPolygon;        // polygon vertices in world coords
};

// Execution context for behavior tree state tracking
struct ExecutionContext {
  std::shared_ptr<DecisionNode> current_sequence{nullptr};  // Currently executing sequence (for reference)
  
  // Persistent state maps (Node Pointer -> Index)
  std::map<const void*, size_t> sequence_indices;           // Current child index for each SequenceNode
  std::map<const void*, size_t> action_indices;             // Current action index for each ActionNode
  std::map<const void*, rclcpp::Time> action_start_times;   // Timestamp when an action started
  
  std::string target_waypoint;                              // Current target waypoint
  bool goal_sent{false};                                    // Whether nav goal has been sent
  std::map<std::string, rclcpp::Time> failure_timestamps;   // Track when actions failed
  std::set<std::shared_ptr<DecisionNode>> completed_sequences; // Track completed sequences to prevent auto-restart

  void reset() {
    current_sequence = nullptr;
    // We do NOT reset indices here anymore. State is persistent.
    // If we want to reset a specific sequence, we erase it from the map.
    target_waypoint.clear();
    goal_sent = false;
  }
};

class DecisionExecutor : public rclcpp::Node
{
public:
  using NavigateToPose = nav2_msgs::action::NavigateToPose;
  using GoalHandleNav = rclcpp_action::ClientGoalHandle<NavigateToPose>;
  using Referee = sentry_msgs::msg::Referee;

  DecisionExecutor();
  ~DecisionExecutor() override = default;

private:
  // Configuration
  void loadConfiguration(const std::string& config_path);
  
  // Message callback
  void refereeCallback(const Referee::SharedPtr msg);
  
  // Behavior tree execution
  void executeDecisionTree();
  NodeStatus tickNode(std::shared_ptr<DecisionNode> node, const Referee& msg);
  NodeStatus tickSequence(std::shared_ptr<DecisionNode> node, const Referee& msg);
  NodeStatus tickSelector(std::shared_ptr<DecisionNode> node, const Referee& msg);
  NodeStatus tickZone(std::shared_ptr<DecisionNode> node, const Referee& msg);
  std::shared_ptr<DecisionNode> parseDecisionNode(const YAML::Node& yaml_node);

  // Zone check
  bool isRobotInZone(const std::string& zone_id);

  // Point-in-polygon check using ray casting algorithm
  static bool isPointInPolygon(double x, double y, const Polygon& polygon);
  
  // Position and distance
  void odomCallback(const nav_msgs::msg::Odometry::SharedPtr msg);
  bool isCloseToWaypoint(const std::string& waypoint_name, double threshold = 0.3);
  
  // Parameter control
  void setRemoteParameter(const ParamConfig& config);
  
  // Navigation control
  bool hasValidRefereeTarget(const Referee& msg) const;
  bool isSameRefereeTarget(double x, double y) const;
  NodeStatus tickRefereeTargetAction(const Referee& msg, const void* node_ptr);
  void sendNavigationGoal(const std::string& waypoint_name);
  void sendNavigationGoalToPose(double x, double y, const std::string& label);
  void cancelCurrentGoal();
  void goalResponseCallback(GoalHandleNav::SharedPtr goal_handle);
  void feedbackCallback(
    GoalHandleNav::SharedPtr,
    const std::shared_ptr<const NavigateToPose::Feedback> feedback
  );
  void resultCallback(const GoalHandleNav::WrappedResult& result);

  // ROS2 components
  rclcpp::Subscription<Referee>::SharedPtr referee_sub_;
  rclcpp::Subscription<nav_msgs::msg::Odometry>::SharedPtr odom_sub_;
  rclcpp_action::Client<NavigateToPose>::SharedPtr nav_client_;
  rclcpp::TimerBase::SharedPtr decision_timer_;
  rclcpp::Publisher<geometry_msgs::msg::Twist>::SharedPtr cmd_vel_pub_;
  
  // Decision system
  std::shared_ptr<FieldMapper> field_mapper_;
  std::shared_ptr<DecisionNode> decision_tree_root_;
  std::map<std::string, geometry_msgs::msg::PoseStamped> waypoints_;
  std::map<std::string, ZoneDefinition> zones_;
  
  // State tracking
  Referee::SharedPtr latest_msg_;
  nav_msgs::msg::Odometry::SharedPtr current_odom_;
  ExecutionContext exec_context_;
  GoalHandleNav::SharedPtr current_goal_handle_;
  bool goal_in_progress_{false};
  bool last_nav_succeeded_{false}; // Trust Nav2 result over distance check
  bool referee_target_active_{false};
  double active_referee_target_x_{0.0};
  double active_referee_target_y_{0.0};

  // Parameter clients cache
  std::map<std::string, rclcpp::AsyncParametersClient::SharedPtr> param_clients_;
  std::map<std::string, std::string> current_param_values_; // cache to avoid redundant calls
};

} // namespace decision_executor

#endif // DECISION_EXECUTOR__DECISION_EXECUTOR_HPP_

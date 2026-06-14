#include "decision_executor/DecisionExecutor.hpp"
#include <yaml-cpp/yaml.h>
#include <fstream>
#include <limits>

namespace decision_executor
{

namespace
{
constexpr const char* kRefereeTargetAction = "REFEREE_TARGET";
constexpr double kRefereeTargetEpsilon = 0.05;
}

DecisionExecutor::DecisionExecutor()
  : Node("decision_executor"),
    goal_in_progress_(false)
{
  // Initialize field mapper
  field_mapper_ = std::make_shared<FieldMapper>();

  // Declare parameters
  this->declare_parameter<std::string>("config_file", "");
  std::string config_file;
  this->get_parameter("config_file", config_file);

  // Load configuration
  if (config_file.empty()) {
    RCLCPP_ERROR(this->get_logger(), "No config file specified!");
    throw std::runtime_error("No config file");
  }
  loadConfiguration(config_file);

  // Create subscription to referee
  referee_sub_ = this->create_subscription<Referee>(
    "/referee", 10,
    std::bind(&DecisionExecutor::refereeCallback, this, std::placeholders::_1)
  );

  // Create subscription to odometry for position tracking
  odom_sub_ = this->create_subscription<nav_msgs::msg::Odometry>(
    "/odom", 10,
    std::bind(&DecisionExecutor::odomCallback, this, std::placeholders::_1)
  );

  // Create Nav2 action client
  nav_client_ = rclcpp_action::create_client<NavigateToPose>(
    this, "navigate_to_pose"
  );

  // Create cmd_vel publisher
  cmd_vel_pub_ = this->create_publisher<geometry_msgs::msg::Twist>("cmd_vel", 10);

  // Create decision timer (10Hz)
  decision_timer_ = this->create_wall_timer(
    std::chrono::milliseconds(100),
    std::bind(&DecisionExecutor::executeDecisionTree, this)
  );

  RCLCPP_INFO(this->get_logger(), "Decision Executor initialized");
}

void DecisionExecutor::loadConfiguration(const std::string& config_path)
{
  RCLCPP_INFO(this->get_logger(), "Loading config from: %s", config_path.c_str());
  
  YAML::Node config = YAML::LoadFile(config_path);

  // Load waypoints
  const auto& waypoints_yaml = config["waypoints"];
  for (const auto& wp : waypoints_yaml) {
    std::string name = wp["name"].as<std::string>();
    auto world = wp["world"];
    
    geometry_msgs::msg::PoseStamped pose;
    pose.header.frame_id = "map";
    pose.pose.position.x = world[0].as<double>();
    pose.pose.position.y = world[1].as<double>();
    pose.pose.position.z = 0.0;
    pose.pose.orientation.w = 1.0;

    waypoints_[name] = pose;
    RCLCPP_INFO(this->get_logger(), "Loaded waypoint: %s at (%.2f, %.2f)", 
                name.c_str(), pose.pose.position.x, pose.pose.position.y);
  }

  // Load zones
  if (config["zones"]) {
    for (const auto& zone_yaml : config["zones"]) {
      ZoneDefinition zone;
      zone.id = zone_yaml["id"].as<std::string>();
      zone.name = zone_yaml["name"].as<std::string>();
      auto wr = zone_yaml["worldRect"];
      zone.worldRect = { wr["x1"].as<double>(), wr["y1"].as<double>(), wr["x2"].as<double>(), wr["y2"].as<double>() };
      zones_[zone.id] = zone;
      RCLCPP_INFO(this->get_logger(), "Loaded zone: %s (%s)", zone.name.c_str(), zone.id.c_str());
    }
  }

  // Load decision tree
  if (config["decision_tree"] && config["decision_tree"]["root"]) {
    decision_tree_root_ = parseDecisionNode(config["decision_tree"]["root"]);
    RCLCPP_INFO(this->get_logger(), "Decision tree loaded successfully (root type: %s)",
                decision_tree_root_->getType().c_str());
  } else {
    RCLCPP_WARN(this->get_logger(), "No decision tree found in config file");
  }
}

std::shared_ptr<DecisionNode> DecisionExecutor::parseDecisionNode(const YAML::Node& yaml_node)
{
  std::string type = yaml_node["type"].as<std::string>();
  std::shared_ptr<DecisionNode> result_node;

  if (type == "Condition") {
    std::string field = yaml_node["field"].as<std::string>();
    std::string op = yaml_node["operator"].as<std::string>();
    double threshold = yaml_node["threshold"].as<double>();

    result_node = std::make_shared<ConditionNode>(field, op, threshold, field_mapper_);
    RCLCPP_DEBUG(this->get_logger(), "  Parsed Condition: %s %s %.1f",
                 field.c_str(), op.c_str(), threshold);

  } else if (type == "Action") {
    // Check for multi-action list
    std::vector<std::string> actions;
    if (yaml_node["actions"]) {
      for (const auto& act : yaml_node["actions"]) {
        actions.push_back(act.as<std::string>());
      }
    } else {
      // Single action (backward compatibility)
      actions.push_back(yaml_node["action"].as<std::string>());
    }

    bool loop = false;
    if (yaml_node["loop"]) {
      loop = yaml_node["loop"].as<bool>();
    }

    double duration = 0.0;
    if (yaml_node["duration"]) {
      duration = yaml_node["duration"].as<double>();
    }

    auto node = std::make_shared<ActionNode>(actions, loop, duration);

    // Parse exit condition (hysteresis lock)
    if (yaml_node["exit_condition"]) {
      auto ec = yaml_node["exit_condition"];
      std::string ec_field = ec["field"].as<std::string>();
      std::string ec_op = ec["operator"].as<std::string>();
      double ec_threshold = ec["threshold"].as<double>();
      node->setExitCondition(ec_field, ec_op, ec_threshold, field_mapper_);
      RCLCPP_DEBUG(this->get_logger(), "  Action has exit condition: %s %s %.1f",
                   ec_field.c_str(), ec_op.c_str(), ec_threshold);
    }

    RCLCPP_DEBUG(this->get_logger(), "  Parsed Action (count: %zu, loop: %d)", actions.size(), loop);
    result_node = node;

  } else if (type == "Param") {
    ParamConfig config;
    config.node_name = yaml_node["node_name"].as<std::string>();
    config.param_name = yaml_node["param_name"].as<std::string>();
    config.param_value = yaml_node["param_value"].as<std::string>();
    config.param_type = yaml_node["param_type"].as<std::string>();
    
    RCLCPP_DEBUG(this->get_logger(), "  Parsed Param: %s.%s = %s (%s)", 
                 config.node_name.c_str(), config.param_name.c_str(), config.param_value.c_str(), config.param_type.c_str());
    result_node = std::make_shared<ParamNode>(config);

  } else if (type == "Selector") {
    auto node = std::make_shared<SelectorNode>();

    if (yaml_node["children"]) {
      for (const auto& child_yaml : yaml_node["children"]) {
        auto child = parseDecisionNode(child_yaml);
        node->addChild(child);
      }
    }
    RCLCPP_DEBUG(this->get_logger(), "  Parsed Selector node");
    result_node = node;

  } else if (type == "Sequence") {
    auto node = std::make_shared<SequenceNode>();

    if (yaml_node["children"]) {
      for (const auto& child_yaml : yaml_node["children"]) {
        auto child = parseDecisionNode(child_yaml);
        node->addChild(child);
      }
    }
    RCLCPP_DEBUG(this->get_logger(), "  Parsed Sequence node");
    result_node = node;
  } else if (type == "Zone") {
    std::string zone_id = yaml_node["zone_id"].as<std::string>();
    std::string zone_name = yaml_node["zone_name"].as<std::string>();
    auto node = std::make_shared<ZoneNode>(zone_id, zone_name);

    // Parse specific action for zone
    if (yaml_node["action"] && !yaml_node["action"].IsNull()) {
        auto action_yaml = yaml_node["action"];
        if (action_yaml.IsMap() && action_yaml["type"]) {
            auto action_node = std::dynamic_pointer_cast<ActionNode>(parseDecisionNode(action_yaml));
            node->setAction(action_node);
        }
    }

    // Parse conditions for zone
    if (yaml_node["conditions"]) {
        for (const auto& cond_yaml : yaml_node["conditions"]) {
             auto cond = std::dynamic_pointer_cast<ConditionNode>(parseDecisionNode(cond_yaml));
             if (cond) node->addCondition(cond);
        }
    }

    // Parse parameters for zone
    if (yaml_node["params"]) {
        for (const auto& param_yaml : yaml_node["params"]) {
             auto param = std::dynamic_pointer_cast<ParamNode>(parseDecisionNode(param_yaml));
             if (param) node->addParam(param);
        }
    }

    // Parse children
    if (yaml_node["children"]) {
        for (const auto& child_yaml : yaml_node["children"]) {
             node->addChild(parseDecisionNode(child_yaml));
        }
    }
    RCLCPP_DEBUG(this->get_logger(), "  Parsed Zone node: %s", zone_name.c_str());
    result_node = node;
  } else {
    throw std::runtime_error("Unknown node type: " + type);
  }

  // Common attribute: priority
  if (yaml_node["priority"]) {
    result_node->setPriority(yaml_node["priority"].as<int>());
    RCLCPP_DEBUG(this->get_logger(), "  Set Priority: %d", result_node->getPriority());
  }

  return result_node;
}

void DecisionExecutor::refereeCallback(const Referee::SharedPtr msg)
{
  latest_msg_ = msg;
}

// Odometry callback
void DecisionExecutor::odomCallback(const nav_msgs::msg::Odometry::SharedPtr msg)
{
  current_odom_ = msg;
}

// Check if robot is close to waypoint (distance-based)
bool DecisionExecutor::isCloseToWaypoint(const std::string& waypoint_name, double threshold)
{
  if (!current_odom_ || waypoint_name.empty()) {
    return false;  // No position data yet or invalid waypoint
  }

  auto it = waypoints_.find(waypoint_name);
  if (it == waypoints_.end()) {
    RCLCPP_WARN(this->get_logger(), "Waypoint '%s' not found", waypoint_name.c_str());
    return false;
  }

  const auto& target_pose = it->second;
  double dx = current_odom_->pose.pose.position.x - target_pose.pose.position.x;
  double dy = current_odom_->pose.pose.position.y - target_pose.pose.position.y;
  double distance = std::sqrt(dx*dx + dy*dy);

  return distance < threshold;
}

// Main behavior tree execution loop
void DecisionExecutor::executeDecisionTree()
{
  if (!latest_msg_ || !decision_tree_root_) {
    return;
  }

  // Tick the root selector
  NodeStatus status = tickSelector(decision_tree_root_, *latest_msg_);

  // If entire tree returns SUCCESS/FAILURE, reset context for next iteration
  if (status != NodeStatus::RUNNING) {
    exec_context_.reset();
  }
}

// Tick selector node (root): try children left-to-right
NodeStatus DecisionExecutor::tickSelector(std::shared_ptr<DecisionNode> node, const Referee& msg)
{
  auto selector = std::dynamic_pointer_cast<SelectorNode>(node);
  if (!selector) {
    RCLCPP_ERROR(this->get_logger(), "tickSelector called on non-Selector node");
    return NodeStatus::FAILURE;
  }

  // Reactive Selector: Always check children from left to right (High to Low priority)
  const auto& children = selector->getChildren();
  for (size_t i = 0; i < children.size(); ++i) {
    auto child = children[i];
    
    // Check if we can run this child
    NodeStatus status;
    
    if (auto seq = std::dynamic_pointer_cast<SequenceNode>(child)) {
      // Just tick it. The sequence manages its own state in the map.
      status = tickSequence(seq, msg);
      
      if (status == NodeStatus::SUCCESS || status == NodeStatus::RUNNING) {
        // We found our winner.
        if (exec_context_.current_sequence != seq) {
           // New Sequence Chosen! Reset all old state so we don't skip nodes upon re-entry
           if (exec_context_.current_sequence) {
             cancelCurrentGoal();
           }
           exec_context_.sequence_indices.clear();
           exec_context_.action_indices.clear();
           exec_context_.action_start_times.clear();
           exec_context_.goal_sent = false;
           exec_context_.target_waypoint.clear();
           exec_context_.current_sequence = seq;
        }
        return status;
      }
      // If FAILURE, we just move to the next child. The failed sequence 
      // might have reset its own state internally if needed.
      
    } else {
      // Direct action/condition
       status = tickNode(child, msg);
       if (status == NodeStatus::SUCCESS || status == NodeStatus::RUNNING) {
         if (exec_context_.current_sequence != nullptr) {
           cancelCurrentGoal();
           exec_context_.sequence_indices.clear();
           exec_context_.action_indices.clear();
           exec_context_.action_start_times.clear();
           exec_context_.goal_sent = false;
           exec_context_.target_waypoint.clear();
         }
         exec_context_.current_sequence = nullptr; // Not a sequence
         return status;
       }
    }
  }

  // All children failed
  if (exec_context_.goal_sent || goal_in_progress_) {
    cancelCurrentGoal();
  }
  exec_context_.reset();
  return NodeStatus::FAILURE;
}

// Tick sequence node: execute children left-to-right
NodeStatus DecisionExecutor::tickSequence(std::shared_ptr<DecisionNode> node, const Referee& msg)
{
  auto sequence = std::dynamic_pointer_cast<SequenceNode>(node);
  if (!sequence) {
    RCLCPP_ERROR(this->get_logger(), "tickSequence called on non-Sequence node");
    return NodeStatus::FAILURE;
  }

  // Get current index for THIS sequence from map
  const void* node_ptr = node.get();
  
  // Smart Latch Logic:
  // Check if we are currently running an Action in this sequence (persisted index)
  size_t running_child_index = 0;
  if (exec_context_.sequence_indices.count(node_ptr)) {
    running_child_index = exec_context_.sequence_indices[node_ptr];
  }

  const auto& children = sequence->getChildren();
  
  // Identify Latch Field if running child is Action with Exit Condition
  std::string latch_field = "";
  bool is_duration_locked = false;
  if (running_child_index < children.size()) {
    if (auto running_action = std::dynamic_pointer_cast<ActionNode>(children[running_child_index])) {
      if (running_action->hasExitCondition()) {
        auto field_opt = running_action->getExitConditionField();
        if (field_opt) {
          latch_field = *field_opt;
        }
      }
      double duration = running_action->getDuration();
      if (duration > 0.0) {
        if (exec_context_.action_start_times.count(running_action.get())) {
          auto elapsed = (this->now() - exec_context_.action_start_times[running_action.get()]).seconds();
          if (elapsed < duration) {
            is_duration_locked = true;
          }
        } else {
          is_duration_locked = true;
        }
      }
    }
  }

  // Re-check all condition nodes before the currently running action.
  // If any condition fails, the sequence should fail so the selector can try other branches.
  if (running_child_index > 0) {
    std::map<std::string, ParamConfig> latest_params;
    for (size_t j = 0; j < running_child_index; ++j) {
      if (auto cond = std::dynamic_pointer_cast<ConditionNode>(children[j])) {
        NodeStatus cond_status = cond->tick(msg);
        if (cond_status == NodeStatus::FAILURE) {
          // Latch/Hysteresis Logic:
          // If the failing condition is on the SAME field as the current action's latch_field,
          // we ignore this failure to let the action finish its own exit condition.
          if (!latch_field.empty() && cond->getField() == latch_field) {
            continue; 
          }
          if (is_duration_locked) {
            continue;
          }

          RCLCPP_INFO(this->get_logger(), "Branch condition no longer met (field %s), releasing branch", cond->getField().c_str());
          exec_context_.sequence_indices.erase(node_ptr);
          if (running_child_index < children.size()) {
            exec_context_.action_start_times.erase(children[running_child_index].get());
          }
          if (exec_context_.current_sequence.get() == node_ptr) {
            cancelCurrentGoal();
            exec_context_.sequence_indices.clear();
            exec_context_.action_indices.clear();
            exec_context_.action_start_times.clear();
            exec_context_.goal_sent = false;
            exec_context_.target_waypoint.clear();
            exec_context_.current_sequence = nullptr;
          }
          return NodeStatus::FAILURE;
        }
      }
      // Collect Param nodes so that parameter values are restored after preemption
      // by a higher-priority branch that may have set different values.
      if (auto param = std::dynamic_pointer_cast<ParamNode>(children[j])) {
        std::string key = param->getConfig().node_name + "/" + param->getConfig().param_name;
        latest_params[key] = param->getConfig();
      }
    }
    
    // Apply only the final state of each parameter
    for (const auto& [key, config] : latest_params) {
      setRemoteParameter(config);
    }
  }

  // Execute children from the saved running_child_index
  for (size_t i = running_child_index; i < children.size(); ++i) {
    NodeStatus status;
    
    // Directly tick each child from the saved index. No need for latch skip logic because we start at running_child_index.
    status = tickNode(children[i], msg);
    
    if (status == NodeStatus::FAILURE) {
      // Sequence fails (e.g. condition no longer met) -> Reset state
      exec_context_.sequence_indices.erase(node_ptr); // Reset progress
      exec_context_.action_start_times.erase(children[i].get());
      if (exec_context_.current_sequence.get() == node_ptr) {
        cancelCurrentGoal();
        exec_context_.goal_sent = false;
        exec_context_.target_waypoint.clear();
        exec_context_.current_sequence = nullptr;
      }
      return NodeStatus::FAILURE;
    }
    
    if (status == NodeStatus::RUNNING) {
      // Child is running (e.g. Action). Sequence remains RUNNING.
      // Save state so we know where to resume/latch check next time
      exec_context_.sequence_indices[node_ptr] = i; 
      return NodeStatus::RUNNING;
    }
    
    // SUCCESS: continue to next child
  }
  
  // All children succeeded (or all remaining children succeeded from running_child_index)
  exec_context_.sequence_indices.erase(node_ptr); // Done, reset
  return NodeStatus::SUCCESS;
}

bool DecisionExecutor::hasValidRefereeTarget(const Referee& msg) const
{
  return msg.target_position_x != 0.0 && msg.target_position_y != 0.0;
}

bool DecisionExecutor::isSameRefereeTarget(double x, double y) const
{
  return referee_target_active_ &&
         std::abs(active_referee_target_x_ - x) < kRefereeTargetEpsilon &&
         std::abs(active_referee_target_y_ - y) < kRefereeTargetEpsilon;
}

NodeStatus DecisionExecutor::tickRefereeTargetAction(const Referee& msg, const void* node_ptr)
{
  const double x = msg.target_position_x;
  const double y = msg.target_position_y;

  if (!hasValidRefereeTarget(msg)) {
    if (referee_target_active_ || exec_context_.target_waypoint == kRefereeTargetAction) {
      RCLCPP_INFO(this->get_logger(), "Referee target cleared or invalid, canceling referee navigation");
      cancelCurrentGoal();
    }
    referee_target_active_ = false;
    active_referee_target_x_ = 0.0;
    active_referee_target_y_ = 0.0;
    exec_context_.goal_sent = false;
    exec_context_.target_waypoint.clear();
    last_nav_succeeded_ = false;
    return NodeStatus::FAILURE;
  }

  const bool target_changed = !isSameRefereeTarget(x, y);
  const bool action_changed = exec_context_.target_waypoint != kRefereeTargetAction;

  if (!exec_context_.goal_sent || action_changed || target_changed) {
    if (exec_context_.goal_sent || goal_in_progress_) {
      if (action_changed || target_changed) {
        RCLCPP_INFO(this->get_logger(), "Referee target changed, canceling previous navigation goal");
      }
      cancelCurrentGoal();
    }

    active_referee_target_x_ = x;
    active_referee_target_y_ = y;
    referee_target_active_ = true;
    exec_context_.target_waypoint = kRefereeTargetAction;
    exec_context_.goal_sent = true;
    sendNavigationGoalToPose(x, y, "referee target");
    return NodeStatus::RUNNING;
  }

  if (!goal_in_progress_) {
    if (last_nav_succeeded_) {
      RCLCPP_INFO(this->get_logger(), "Reached referee target based on Nav2 result: (%.2f, %.2f)", x, y);
      exec_context_.action_start_times.erase(node_ptr);
      exec_context_.goal_sent = false;
      exec_context_.target_waypoint.clear();
      referee_target_active_ = false;
      active_referee_target_x_ = 0.0;
      active_referee_target_y_ = 0.0;
      return NodeStatus::SUCCESS;
    }

    RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 2000,
      "Navigation stopped but referee target was not reached. Retrying...");
    exec_context_.goal_sent = false;
    return NodeStatus::RUNNING;
  }

  return NodeStatus::RUNNING;
}

// Tick individual node
NodeStatus DecisionExecutor::tickNode(std::shared_ptr<DecisionNode> node, const Referee& msg)
{
  if (!node) {
    return NodeStatus::FAILURE;
  }

  // Condition: immediate evaluation
  if (auto cond = std::dynamic_pointer_cast<ConditionNode>(node)) {
    return cond->tick(msg);
  }

  // Param: apply parameter and return SUCCESS
  if (auto param = std::dynamic_pointer_cast<ParamNode>(node)) {
    setRemoteParameter(param->getConfig());
    return NodeStatus::SUCCESS;
  }

  // Composite: recursive tick
  if (auto seq = std::dynamic_pointer_cast<SequenceNode>(node)) {
    return tickSequence(seq, msg);
  }
  if (auto sel = std::dynamic_pointer_cast<SelectorNode>(node)) {
    return tickSelector(sel, msg);
  }
  if (auto zone = std::dynamic_pointer_cast<ZoneNode>(node)) {
    return tickZone(zone, msg);
  }

  // Action: send goal and check completion
  if (auto action = std::dynamic_pointer_cast<ActionNode>(node)) {
    // Get current action index for THIS action node
    const void* node_ptr = node.get();
    size_t current_act_idx = exec_context_.action_indices[node_ptr]; // Default 0

    // Get current waypoint from list
    std::string waypoint = action->getAction(current_act_idx);

    // If no more waypoints (index out of bounds)
    if (waypoint.empty()) {
      exec_context_.action_start_times.erase(node_ptr);
      if (action->isLoop()) {
        // Loop back to start
        current_act_idx = 0;
        exec_context_.action_indices[node_ptr] = 0;
        waypoint = action->getAction(0);
        // Fall through to process first waypoint
      } else {
        // All actions done
        exec_context_.action_indices[node_ptr] = 0; // Reset for next time this node is entered
        exec_context_.target_waypoint.clear();
        return NodeStatus::SUCCESS;
      }
    }

    // Special case: STOP
    if (waypoint == "STOP") {
      if (goal_in_progress_) {
        RCLCPP_INFO(this->get_logger(), "STOP action - canceling navigation");
        cancelCurrentGoal();
      }
      
      // 持续发送全 0 cmd_vel 以保持车辆静止
      geometry_msgs::msg::Twist stop_msg;
      stop_msg.linear.x = 0.0;
      stop_msg.linear.y = 0.0;
      stop_msg.linear.z = 0.0;
      stop_msg.angular.x = 0.0;
      stop_msg.angular.y = 0.0;
      stop_msg.angular.z = 0.0;
      cmd_vel_pub_->publish(stop_msg);

      if (action->getDuration() > 0.0 && !exec_context_.action_start_times.count(node_ptr)) {
        exec_context_.action_start_times[node_ptr] = this->now();
      }

      // Check exit condition if exists
      if (action->hasExitCondition()) {
        if (!action->checkExitCondition(msg)) {
          return NodeStatus::RUNNING; // Wait for condition
        } else {
          // Condition met, advance to next action if any
          exec_context_.action_start_times.erase(node_ptr);
          exec_context_.action_indices[node_ptr] = current_act_idx + 1;
          return NodeStatus::RUNNING;
        }
      }

      // Check duration
      if (action->getDuration() > 0.0) {
        auto elapsed = (this->now() - exec_context_.action_start_times[node_ptr]).seconds();
        if (elapsed >= action->getDuration()) {
          exec_context_.action_start_times.erase(node_ptr);
          exec_context_.action_indices[node_ptr] = current_act_idx + 1;
          return NodeStatus::RUNNING;
        } else {
          return NodeStatus::RUNNING;
        }
      }

      // Keep returning RUNNING to halt execution here indefinitely (until preempted)
      return NodeStatus::RUNNING;
    }

    // Special case: referee-provided small-map target
    if (waypoint == kRefereeTargetAction) {
      NodeStatus status = tickRefereeTargetAction(msg, node_ptr);
      if (status == NodeStatus::SUCCESS) {
        exec_context_.action_indices[node_ptr] = current_act_idx + 1;
        return NodeStatus::RUNNING;
      }
      return status;
    }

    // Check failure cooldown (5 seconds)
    auto& failures = exec_context_.failure_timestamps;
    if (failures.count(waypoint)) {
      auto elapsed = (this->now() - failures[waypoint]).seconds();
      if (elapsed < 5.0) {
        return NodeStatus::FAILURE;
      } else {
        failures.erase(waypoint);
      }
    }

    // First tick or target mismatch: send/resend navigation goal
    if (!exec_context_.goal_sent || exec_context_.target_waypoint != waypoint) {
      if (exec_context_.goal_sent) {
          RCLCPP_INFO(this->get_logger(), "Goal mismatch (preempted?). Canceling %s", exec_context_.target_waypoint.c_str());
          cancelCurrentGoal();
      }

      if (action->getActionCount() > 1) {
        RCLCPP_INFO(this->get_logger(), "Starting action %zu/%zu: %s", 
                    current_act_idx + 1, action->getActionCount(), waypoint.c_str());
      } else {
        RCLCPP_INFO(this->get_logger(), "Starting action: %s", waypoint.c_str());
      }
      
      sendNavigationGoal(waypoint);
      exec_context_.goal_sent = true;
      exec_context_.target_waypoint = waypoint;
      return NodeStatus::RUNNING;
    }

    // Check if navigation failed/stopped (e.g. aborted by server)
    if (!goal_in_progress_) {
       // If Nav2 says we SUCCEEDED, trust it
       if (last_nav_succeeded_) {
          RCLCPP_INFO(this->get_logger(), "Reached waypoint based on Nav2 result: %s", waypoint.c_str());
          
          if (action->getDuration() > 0.0 && !exec_context_.action_start_times.count(node_ptr)) {
            exec_context_.action_start_times[node_ptr] = this->now();
          }

          // Check exit condition if exists
          if (action->hasExitCondition()) {
            if (!action->checkExitCondition(msg)) {
              exec_context_.goal_sent = false; 
              return NodeStatus::RUNNING; 
            }
          }
          
          if (action->getDuration() > 0.0) {
            auto elapsed = (this->now() - exec_context_.action_start_times[node_ptr]).seconds();
            if (elapsed < action->getDuration()) {
              exec_context_.goal_sent = false; // Stay/hold
              return NodeStatus::RUNNING;
            }
          }

          // Move to next action
          exec_context_.action_start_times.erase(node_ptr);
          exec_context_.action_indices[node_ptr] = current_act_idx + 1;
          exec_context_.goal_sent = false;
          exec_context_.target_waypoint.clear();
          return NodeStatus::RUNNING;
       }
    
       // Loop/Patrol robustness: If we stopped but didn't reach (and NOT success), maybe preempted?
       // Log warning but DO NOT FAIL immediately. Retry.
       RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 2000,
         "Navigation stopped but target %s not reached (Tolerance issue? Preempted?). Retrying...", waypoint.c_str());
         
       exec_context_.goal_sent = false; // Force resend on next tick
       return NodeStatus::RUNNING;      // Keep the node active
    }
    // Check exit condition while moving
    if (goal_in_progress_) {
      if (action->hasExitCondition() && action->checkExitCondition(msg)) {
          RCLCPP_INFO(this->get_logger(), "Exit condition met while moving - canceling navigation to %s", waypoint.c_str());
          cancelCurrentGoal();
          exec_context_.action_start_times.erase(node_ptr);
          exec_context_.action_indices[node_ptr] = current_act_idx + 1;
          exec_context_.goal_sent = false;
          exec_context_.target_waypoint.clear();
          return NodeStatus::RUNNING;
      }
      return NodeStatus::RUNNING;
    }
  }

  // Unknown node type
  RCLCPP_WARN(this->get_logger(), "Unknown node type in tickNode");
  return NodeStatus::FAILURE;
}

NodeStatus DecisionExecutor::tickZone(std::shared_ptr<DecisionNode> node, const Referee& msg)
{
  auto zone_node = std::dynamic_pointer_cast<ZoneNode>(node);
  if (!zone_node) return NodeStatus::FAILURE;

  // 1. Check if robot is in zone
  if (!isRobotInZone(zone_node->getZoneId())) {
    return NodeStatus::FAILURE;
  }

  // 2. Check zone conditions
  for (auto& cond : zone_node->getConditions()) {
    if (cond->tick(msg) == NodeStatus::FAILURE) {
      return NodeStatus::FAILURE;
    }
  }

  // 3. Apply zone parameters
  for (auto& param : zone_node->getParams()) {
    tickNode(param, msg); // Use tickNode to call setRemoteParameter
  }

  if (!zone_node->getAction() && zone_node->getChildren().empty()) {
    RCLCPP_DEBUG(
      this->get_logger(),
      "Zone %s matched with params only; keeping current action",
      zone_node->getZoneName().c_str());
    return NodeStatus::FAILURE;
  }

  // 4. Execute zone action if any
  if (zone_node->getAction()) {
    NodeStatus status = tickNode(zone_node->getAction(), msg);
    if (status == NodeStatus::RUNNING) {
      return NodeStatus::RUNNING;
    }
  }

  // 4. Continue to children
  for (auto& child : zone_node->getChildren()) {
     NodeStatus status = tickNode(child, msg);
     if (status == NodeStatus::RUNNING) return NodeStatus::RUNNING;
     // If success or fail, continue next child (or logic decided by designer)
     // Usually zones are like Sequences or parallel. Here we treat children like a sequence.
     if (status == NodeStatus::FAILURE) return NodeStatus::FAILURE;
  }

  return NodeStatus::SUCCESS;
}

bool DecisionExecutor::isRobotInZone(const std::string& zone_id)
{
  if (!current_odom_ || zones_.find(zone_id) == zones_.end()) {
    return false;
  }

  const auto& zone = zones_[zone_id];
  double x = current_odom_->pose.pose.position.x;
  double y = current_odom_->pose.pose.position.y;

  double x_min = std::min(zone.worldRect.x1, zone.worldRect.x2);
  double x_max = std::max(zone.worldRect.x1, zone.worldRect.x2);
  double y_min = std::min(zone.worldRect.y1, zone.worldRect.y2);
  double y_max = std::max(zone.worldRect.y1, zone.worldRect.y2);

  return (x >= x_min && x <= x_max && y >= y_min && y <= y_max);
}



void DecisionExecutor::setRemoteParameter(const ParamConfig& config)
{
  // Check cache
  std::string key = config.node_name + "/" + config.param_name;
  if (current_param_values_.count(key) && current_param_values_[key] == config.param_value) {
    return; // Already set
  }

  // Get or create client
  if (!param_clients_.count(config.node_name)) {
    param_clients_[config.node_name] = std::make_shared<rclcpp::AsyncParametersClient>(this, config.node_name);
  }
  auto client = param_clients_[config.node_name];

  if (!client->service_is_ready()) {
    // Attempt to wait briefly? No, async check.
    // If not ready, we can't do much without blocking. Just warn.
    // RCLCPP_WARN(this->get_logger(), "Param service not ready for %s", config.node_name.c_str());
    // Continue anyway, maybe it connects?
  }

  // Convert value
  rclcpp::Parameter param;
  try {
    if (config.param_type == "int") {
      param = rclcpp::Parameter(config.param_name, std::stoi(config.param_value));
    } else if (config.param_type == "double") {
      param = rclcpp::Parameter(config.param_name, std::stod(config.param_value));
    } else if (config.param_type == "bool") {
      bool b = (config.param_value == "true" || config.param_value == "1");
      param = rclcpp::Parameter(config.param_name, b);
    } else {
      param = rclcpp::Parameter(config.param_name, config.param_value);
    }
  } catch (const std::exception& e) {
    RCLCPP_ERROR(this->get_logger(), "Invalid param value %s for type %s", config.param_value.c_str(), config.param_type.c_str());
    return;
  }

  // Optimistic update
  current_param_values_[key] = config.param_value;
  RCLCPP_INFO(this->get_logger(), "Setting param %s = %s", key.c_str(), config.param_value.c_str());

  // Send request
  client->set_parameters({param});
}

void DecisionExecutor::sendNavigationGoal(const std::string& waypoint_name)
{
  if (!nav_client_->wait_for_action_server(std::chrono::seconds(5))) {
    RCLCPP_ERROR(this->get_logger(), "Navigation action server not available!");
    return;
  }

  auto it = waypoints_.find(waypoint_name);
  if (it == waypoints_.end()) {
    RCLCPP_ERROR(this->get_logger(), "Unknown waypoint: %s", waypoint_name.c_str());
    return;
  }

  auto goal_msg = NavigateToPose::Goal();
  goal_msg.pose = it->second;
  goal_msg.pose.header.stamp = this->now();

  RCLCPP_INFO(this->get_logger(), "Sending goal to: %s", waypoint_name.c_str());

  auto send_goal_options = rclcpp_action::Client<NavigateToPose>::SendGoalOptions();
  send_goal_options.goal_response_callback =
    std::bind(&DecisionExecutor::goalResponseCallback, this, std::placeholders::_1);
  send_goal_options.feedback_callback =
    std::bind(&DecisionExecutor::feedbackCallback, this, std::placeholders::_1, std::placeholders::_2);
  send_goal_options.result_callback =
    std::bind(&DecisionExecutor::resultCallback, this, std::placeholders::_1);

  nav_client_->async_send_goal(goal_msg, send_goal_options);
  goal_in_progress_ = true; // Mark as started
  last_nav_succeeded_ = false; // Reset status
}

void DecisionExecutor::sendNavigationGoalToPose(double x, double y, const std::string& label)
{
  if (!nav_client_->wait_for_action_server(std::chrono::seconds(5))) {
    RCLCPP_ERROR(this->get_logger(), "Navigation action server not available!");
    return;
  }

  auto goal_msg = NavigateToPose::Goal();
  goal_msg.pose.header.frame_id = "map";
  goal_msg.pose.header.stamp = this->now();
  goal_msg.pose.pose.position.x = x;
  goal_msg.pose.pose.position.y = y;
  goal_msg.pose.pose.position.z = 0.0;
  goal_msg.pose.pose.orientation.w = 1.0;

  RCLCPP_INFO(this->get_logger(), "Sending goal to %s: (%.2f, %.2f)", label.c_str(), x, y);

  auto send_goal_options = rclcpp_action::Client<NavigateToPose>::SendGoalOptions();
  send_goal_options.goal_response_callback =
    std::bind(&DecisionExecutor::goalResponseCallback, this, std::placeholders::_1);
  send_goal_options.feedback_callback =
    std::bind(&DecisionExecutor::feedbackCallback, this, std::placeholders::_1, std::placeholders::_2);
  send_goal_options.result_callback =
    std::bind(&DecisionExecutor::resultCallback, this, std::placeholders::_1);

  nav_client_->async_send_goal(goal_msg, send_goal_options);
  goal_in_progress_ = true;
  last_nav_succeeded_ = false;
}

void DecisionExecutor::cancelCurrentGoal()
{
  if (current_goal_handle_) {
    RCLCPP_INFO(this->get_logger(), "Canceling current navigation goal in Nav2");
    nav_client_->async_cancel_goal(current_goal_handle_);
    current_goal_handle_.reset();
  }

  goal_in_progress_ = false;
}

void DecisionExecutor::goalResponseCallback(GoalHandleNav::SharedPtr goal_handle)
{
  if (!goal_handle) {
    RCLCPP_ERROR(this->get_logger(), "Goal was rejected by server");
    goal_in_progress_ = false;
  } else {
    RCLCPP_INFO(this->get_logger(), "Goal accepted by server");
    current_goal_handle_ = goal_handle;
  }
}

void DecisionExecutor::feedbackCallback(
  GoalHandleNav::SharedPtr,
  const std::shared_ptr<const NavigateToPose::Feedback> feedback)
{
  // Log navigation progress
  (void)feedback;
}

void DecisionExecutor::resultCallback(const GoalHandleNav::WrappedResult& result)
{
  // If the result belongs to an old goal or we cleared the handle, do not touch the state
  if (!current_goal_handle_ || result.goal_id != current_goal_handle_->get_goal_id()) {
    RCLCPP_DEBUG(this->get_logger(), "Ignoring result from old or cancelled goal");
    return;
  }

  goal_in_progress_ = false;
  current_goal_handle_.reset();
  
  // Important: Sync goal_sent state
  // If we finished (success or fail), we are no longer "sending/running" a goal from the perspective of the tickNode
  // However, tickNode needs to know if it succeeded or failed to decide whether to advance.
  // We'll leave goal_sent = true so tickNode can check the result, UNLESS it was a success?
  // Actually, if we set goal_sent = false here, tickNode might immediately resend.
  // Let's NOT clear goal_sent here, but let tickNode handle it.
  // BUT we must ensure tickNode doesn't think it's still running.
  // goal_in_progress_ = false does that.

  last_nav_succeeded_ = (result.code == rclcpp_action::ResultCode::SUCCEEDED);

  switch (result.code) {
    case rclcpp_action::ResultCode::SUCCEEDED:
      RCLCPP_INFO(this->get_logger(), "Navigation succeeded!");
      break;
    case rclcpp_action::ResultCode::ABORTED:
      RCLCPP_ERROR(this->get_logger(), "Navigation was aborted");
      break;
    case rclcpp_action::ResultCode::CANCELED:
      RCLCPP_INFO(this->get_logger(), "Navigation was canceled");
      break;
    default:
      RCLCPP_ERROR(this->get_logger(), "Unknown result code");
      break;
  }
}

} // namespace decision_executor

int main(int argc, char** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<decision_executor::DecisionExecutor>();
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}

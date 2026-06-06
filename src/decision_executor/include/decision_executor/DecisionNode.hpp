#ifndef DECISION_EXECUTOR__DECISION_NODE_HPP_
#define DECISION_EXECUTOR__DECISION_NODE_HPP_

#include <memory>
#include <optional>
#include <string>
#include <vector>
#include "sentry_msgs/msg/referee.hpp"
#include "decision_executor/FieldMapper.hpp"

namespace decision_executor
{

enum class NodeStatus {
  SUCCESS,
  FAILURE,
  RUNNING
};

/**
 * @brief Base class for all decision tree nodes
 */
class DecisionNode
{
public:
  virtual ~DecisionNode() = default;
  virtual NodeStatus tick(const sentry_msgs::msg::Referee& msg) = 0;
  virtual std::string getType() const = 0;

  void setPriority(int p) { priority_ = p; }
  int getPriority() const { return priority_; }

protected:
  int priority_{0};
};

/**
 * @brief Condition Node - Evaluates a condition based on message field
 */
class ConditionNode : public DecisionNode
{
public:
  ConditionNode(
    const std::string& field,
    const std::string& op,
    double threshold,
    std::shared_ptr<FieldMapper> mapper
  );

  NodeStatus tick(const sentry_msgs::msg::Referee& msg) override;
  std::string getType() const override { return "Condition"; }
  
  std::string getField() const { return field_; }

private:
  std::string field_;
  std::string operator_;
  double threshold_;
  std::shared_ptr<FieldMapper> field_mapper_;

  bool evaluateCondition(double field_value) const;
};

/**
 * @brief Exit condition for action nodes (hysteresis)
 * Action stays locked until this condition is met
 */
struct ExitCondition {
  std::string field;
  std::string op;
  double threshold;
  std::shared_ptr<FieldMapper> field_mapper;
};

/**
 * @brief Action Node - Returns target waypoint or STOP command
 */
class ActionNode : public DecisionNode
{
public:
  // Constructor for single action (backward compatibility)
  explicit ActionNode(const std::string& action, double duration = 0.0);
  
  // Constructor for multi-step action
  explicit ActionNode(const std::vector<std::string>& actions, bool loop = false, double duration = 0.0);

  NodeStatus tick(const sentry_msgs::msg::Referee& msg) override;
  std::string getType() const override { return "Action"; }
  
  // Get current action based on index
  std::string getAction(size_t index = 0) const {
    if (index < actions_.size()) return actions_[index];
    return "";
  }
  
  size_t getActionCount() const { return actions_.size(); }
  bool isLoop() const { return loop_; }
  double getDuration() const { return duration_; }

  void setExitCondition(const std::string& field, const std::string& op,
                        double threshold, std::shared_ptr<FieldMapper> mapper);
  bool hasExitCondition() const { return exit_condition_.has_value(); }
  bool checkExitCondition(const sentry_msgs::msg::Referee& msg) const;
  
  std::optional<std::string> getExitConditionField() const {
    if (exit_condition_) return exit_condition_->field;
    return std::nullopt;
  }

private:
  std::vector<std::string> actions_;
  bool loop_;
  double duration_;
  std::optional<ExitCondition> exit_condition_;
};

/**
 * @brief Selector Node - Returns SUCCESS on first successful child
 * Similar to "OR" logic
 */
class SelectorNode : public DecisionNode
{
public:
  SelectorNode() = default;

  void addChild(std::shared_ptr<DecisionNode> child);
  NodeStatus tick(const sentry_msgs::msg::Referee& msg) override;
  std::string getType() const override { return "Selector"; }
  const std::vector<std::shared_ptr<DecisionNode>>& getChildren() const { return children_; }

private:
  std::vector<std::shared_ptr<DecisionNode>> children_;
};

/**
 * @brief Sequence Node - Returns SUCCESS only if ALL children succeed
 * Similar to "AND" logic
 */
class SequenceNode : public DecisionNode
{
public:
  SequenceNode() = default;

  void addChild(std::shared_ptr<DecisionNode> child);
  NodeStatus tick(const sentry_msgs::msg::Referee& msg) override;
  std::string getType() const override { return "Sequence"; }
  const std::vector<std::shared_ptr<DecisionNode>>& getChildren() const { return children_; }

private:
  std::vector<std::shared_ptr<DecisionNode>> children_;
};

/**
 * @brief Param Node - Sets a ROS parameter
 */
struct ParamConfig {
  std::string node_name;
  std::string param_name;
  std::string param_value; // stored as string, parsed at runtime
  std::string param_type;
};

class ParamNode : public DecisionNode
{
public:
  explicit ParamNode(const ParamConfig& config) : config_(config) {}

  NodeStatus tick(const sentry_msgs::msg::Referee& msg) override {
    (void)msg;
    return NodeStatus::SUCCESS;
  }
  
  std::string getType() const override { return "Param"; }
  const ParamConfig& getConfig() const { return config_; }

private:
  ParamConfig config_;
};

/**
 * @brief Zone Node - Checks if robot is in zone and executes logic
 */
class ZoneNode : public DecisionNode
{
public:
  ZoneNode(const std::string& zone_id, const std::string& zone_name)
    : zone_id_(zone_id), zone_name_(zone_name) {}

  NodeStatus tick(const sentry_msgs::msg::Referee& msg) override {
    (void)msg;
    return NodeStatus::FAILURE; // Handled by DecisionExecutor traversal
  }

  std::string getType() const override { return "Zone"; }
  std::string getZoneId() const { return zone_id_; }
  std::string getZoneName() const { return zone_name_; }

  void setAction(std::shared_ptr<ActionNode> action) { action_ = action; }
  void addCondition(std::shared_ptr<ConditionNode> cond) { conditions_.push_back(cond); }
  void addParam(std::shared_ptr<ParamNode> param) { params_.push_back(param); }
  void addChild(std::shared_ptr<DecisionNode> child) { children_.push_back(child); }

  std::shared_ptr<ActionNode> getAction() const { return action_; }
  const std::vector<std::shared_ptr<ConditionNode>>& getConditions() const { return conditions_; }
  const std::vector<std::shared_ptr<ParamNode>>& getParams() const { return params_; }
  const std::vector<std::shared_ptr<DecisionNode>>& getChildren() const { return children_; }

private:
  std::string zone_id_;
  std::string zone_name_;
  std::shared_ptr<ActionNode> action_;
  std::vector<std::shared_ptr<ConditionNode>> conditions_;
  std::vector<std::shared_ptr<ParamNode>> params_;
  std::vector<std::shared_ptr<DecisionNode>> children_;
};

} // namespace decision_executor

#endif // DECISION_EXECUTOR__DECISION_NODE_HPP_
